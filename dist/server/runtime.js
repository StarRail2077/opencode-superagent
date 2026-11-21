import { PLUGIN_ID, PLUGIN_VERSION, SUPERAGENT_AGENT_ID, isActive, modelKey, normalizeSettings, truncate, } from "../shared.js";
import { asMessages, lastAssistantText, lastMessageTime, messageError, recentAssistant, recentToolNames, unwrapList } from "./messages.js";
import { buildNudgeMessage, buildRecoveryMessage, buildWatchdogPrompt, buildWorkerPrompt, extractDecision, SUPERAGENT_SYSTEM, WATCHDOG_SYSTEM, WORKER_SYSTEM } from "./prompt.js";
const SETTINGS_KEY = "settings.v1";
const TICKETS_KEY = "tickets.v1";
const ATTENTION_KEY = "attention.v1";
export class SuperagentRuntime {
    ctx;
    settings;
    tickets = new Map();
    attention = [];
    watchdogState = {
        enabled: false,
        running: false,
        lastRunAt: null,
        lastError: null,
        nextRunAt: null,
        sessionID: null,
        lastDecision: null,
    };
    workerSessions = new Set();
    watchdogSessions = new Set();
    hooks = [];
    eventAbort = new AbortController();
    timer = null;
    persistTimer = null;
    emitTimer = null;
    disposed = false;
    persistence = Promise.resolve();
    emitState = () => { };
    emitAttention = () => { };
    emitNotice = () => { };
    modelsCache = [];
    agentsCache = [];
    optionsAt = 0;
    optionsLoading = null;
    constructor(ctx, initial = {}) {
        this.ctx = ctx;
        this.settings = normalizeSettings(initial.settings);
        if (Array.isArray(initial.tickets)) {
            for (const value of initial.tickets) {
                const ticket = value;
                if (ticket && typeof ticket.id === "string") {
                    this.tickets.set(ticket.id, {
                        ...ticket,
                        nudges: Number.isFinite(ticket.nudges) ? ticket.nudges : 0,
                        checks: Number.isFinite(ticket.checks) ? ticket.checks : 0,
                        createdAt: Number.isFinite(ticket.createdAt) ? ticket.createdAt : Date.now(),
                        updatedAt: Number.isFinite(ticket.updatedAt) ? ticket.updatedAt : Date.now(),
                        lastActivityAt: Number.isFinite(ticket.lastActivityAt) ? ticket.lastActivityAt : Date.now(),
                    });
                    if (ticket.sessionID)
                        this.workerSessions.add(ticket.sessionID);
                }
            }
        }
        if (Array.isArray(initial.attention)) {
            this.attention = initial.attention.filter((item) => {
                return Boolean(item && typeof item === "object" && typeof item.id === "string");
            });
        }
        this.watchdogState.enabled = this.settings.watchdogEnabled;
    }
    attachEmitters(input) {
        this.emitState = input.state;
        this.emitAttention = input.attention;
        this.emitNotice = input.notice;
    }
    async start() {
        await this.loadOptions();
        const hook = await this.ctx.session.hook("context", (event) => {
            if (this.watchdogSessions.has(event.sessionID)) {
                event.system.push({ type: "text", text: WATCHDOG_SYSTEM });
                event.options.temperature = 0.1;
                // The watchdog only observes. Removing tools also prevents accidental edits.
                for (const name of Object.keys(event.tools))
                    delete event.tools[name];
                return;
            }
            const agent = String(event.agent ?? "");
            const worker = this.workerSessions.has(event.sessionID);
            const isSuperagentTool = (name) => name === PLUGIN_ID || name.startsWith(`${PLUGIN_ID}_`) || name.startsWith(`${PLUGIN_ID}.`);
            if (worker) {
                event.system.push({ type: "text", text: WORKER_SYSTEM });
                // Worker sessions never get the router tools; only the Superagent mode can
                // dispatch new workers. Nested native subagents follow the explicit setting.
                for (const name of Object.keys(event.tools)) {
                    if (isSuperagentTool(name))
                        delete event.tools[name];
                    if (!this.settings.allowNestedSubagents && (name === "subagent" || name === "task")) {
                        delete event.tools[name];
                    }
                }
                return;
            }
            if (agent !== SUPERAGENT_AGENT_ID) {
                // Every other primary agent stays a normal OpenCode agent. It cannot see
                // or call the Superagent router tools.
                for (const name of Object.keys(event.tools)) {
                    if (isSuperagentTool(name))
                        delete event.tools[name];
                }
                return;
            }
            event.system.push({ type: "text", text: SUPERAGENT_SYSTEM });
        });
        this.hooks.push(hook);
        void this.consumeEvents();
        this.restartTimer();
        this.persistSoon();
    }
    async dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.eventAbort.abort();
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
        if (this.persistTimer)
            clearTimeout(this.persistTimer);
        this.persistTimer = null;
        if (this.emitTimer)
            clearTimeout(this.emitTimer);
        this.emitTimer = null;
        for (const hook of this.hooks.splice(0)) {
            try {
                await hook.dispose();
            }
            catch {
                // The plugin is going away; a hook that already disposed is harmless.
            }
        }
        await this.persistNow();
    }
    getSettings() {
        return { ...this.settings };
    }
    async state() {
        await this.loadOptions();
        const now = Date.now();
        const tickets = Array.from(this.tickets.values())
            .sort((a, b) => b.createdAt - a.createdAt)
            .map((ticket) => ({
            ...ticket,
            ageMs: Math.max(0, now - ticket.createdAt),
            idleMs: Math.max(0, now - ticket.lastActivityAt),
        }));
        return {
            pluginVersion: PLUGIN_VERSION,
            settings: this.getSettings(),
            models: this.modelsCache.slice(),
            agents: this.agentsCache.slice(),
            tickets,
            watchdog: { ...this.watchdogState, enabled: this.settings.watchdogEnabled },
            attention: this.attention.slice(),
            serverDirectory: this.ctx.location.directory,
        };
    }
    async updateSettings(patch) {
        const previous = this.settings;
        this.settings = normalizeSettings({ ...this.settings, ...patch }, this.settings);
        this.watchdogState.enabled = this.settings.watchdogEnabled;
        if (previous.watchdogEnabled !== this.settings.watchdogEnabled || previous.watchdogIntervalSec !== this.settings.watchdogIntervalSec) {
            this.restartTimer();
        }
        if (previous.allowNestedSubagents !== this.settings.allowNestedSubagents) {
            await this.applyNestedPolicyToWorkers().catch(() => { });
        }
        if (patch.watchdogModel === null || patch.watchdogAgent === null) {
            // Clearing a selection means "use the default", which an existing session
            // cannot do in place. The next check creates a fresh watchdog session.
            if (this.watchdogState.sessionID) {
                this.watchdogSessions.delete(this.watchdogState.sessionID);
                this.watchdogState.sessionID = null;
            }
        }
        else if (previous.watchdogAgent !== this.settings.watchdogAgent ||
            modelKey(previous.watchdogModel) !== modelKey(this.settings.watchdogModel)) {
            await this.applyWatchdogSessionSettings().catch((error) => {
                this.watchdogState.lastError = errorText(error);
            });
        }
        this.persistSoon();
        this.emitSoon(true);
        return this.state();
    }
    setEmitters(emitters) {
        this.attachEmitters(emitters);
    }
    async dispatch(input) {
        const task = String(input.task ?? "").trim();
        if (!task)
            throw new Error("A Superagent dispatch needs a task");
        const active = this.activeTickets();
        if (active.length >= this.settings.maxWorkers) {
            throw new Error(`Superagent is at its worker limit (${this.settings.maxWorkers}). Collect or cancel a worker first.`);
        }
        const id = newTicketID();
        const title = ticketTitle(input.title, task);
        const model = input.model ?? this.settings.workerModel ?? undefined;
        const agent = input.agent ?? this.settings.workerAgent ?? undefined;
        const directory = input.directory?.trim() || this.ctx.location.directory;
        const now = Date.now();
        const ticket = {
            id,
            title,
            task,
            status: "queued",
            createdAt: now,
            updatedAt: now,
            lastActivityAt: now,
            ...(model ? { model } : {}),
            ...(agent ? { agent } : {}),
            directory,
            nudges: 0,
            checks: 0,
            source: input.source ?? "tool",
        };
        let created;
        try {
            created = await this.createSession({
                title: `Superagent · ${title}`,
                agent,
                model,
                directory,
                role: "worker",
                ticketID: id,
            });
        }
        catch (error) {
            // A model or agent imported from another machine may not exist here. Retry with defaults.
            if (model || agent) {
                created = await this.createSession({
                    title: `Superagent · ${title}`,
                    agent: undefined,
                    model: undefined,
                    directory,
                    role: "worker",
                    ticketID: id,
                });
                ticket.lastError = `Selected model/agent was unavailable; used the default. ${errorText(error)}`;
            }
            else {
                throw error;
            }
        }
        ticket.sessionID = created.id;
        ticket.directory = created.directory ?? ticket.directory;
        this.tickets.set(id, ticket);
        this.workerSessions.add(created.id);
        await this.applyNestedPolicy(created.id).catch((error) => {
            ticket.lastError = `Could not apply the nested-subagent policy: ${errorText(error)}`;
        });
        this.persistSoon();
        this.emitSoon(true);
        try {
            await this.ctx.session.prompt({
                sessionID: created.id,
                text: buildWorkerPrompt({
                    ticketID: id,
                    title,
                    task,
                }),
                delivery: "steer",
            });
            ticket.status = "running";
            ticket.updatedAt = Date.now();
            ticket.lastActivityAt = Date.now();
        }
        catch (error) {
            ticket.status = "failed";
            ticket.lastError = errorText(error);
            ticket.updatedAt = Date.now();
            this.addAttention(ticket, "Worker failed to start", ticket.lastError, "worker-start-failed");
        }
        this.persistSoon();
        this.emitSoon(true);
        return {
            ticketID: id,
            sessionID: created.id,
            title,
            status: ticket.status,
            ...(ticket.model ? { model: ticket.model } : {}),
            ...(ticket.agent ? { agent: ticket.agent } : {}),
        };
    }
    async collect(ticketID, timeoutMs = 120_000) {
        const ticket = this.requireTicket(ticketID);
        if (!ticket.sessionID)
            throw new Error(`Ticket ${ticketID} has no session yet`);
        if (isActive(ticket.status) && timeoutMs > 0) {
            await withTimeout(this.ctx.session.wait({ sessionID: ticket.sessionID }), Math.min(10 * 60_000, timeoutMs));
        }
        await this.refreshTicket(ticket);
        if (ticket.status === "running") {
            // `wait` resolves at a step boundary; if the worker is still active, report what we have.
        }
        const text = ticket.lastText ?? "";
        return {
            ticketID: ticket.id,
            sessionID: ticket.sessionID,
            status: ticket.status,
            text,
            idleMs: Math.max(0, Date.now() - ticket.lastActivityAt),
        };
    }
    async cancel(ticketID) {
        const ticket = this.requireTicket(ticketID);
        if (ticket.sessionID) {
            try {
                await this.ctx.session.interrupt({ sessionID: ticket.sessionID, resume: false });
            }
            catch {
                // The session may already be gone; the ticket is still cancelled.
            }
        }
        ticket.status = "cancelled";
        ticket.updatedAt = Date.now();
        ticket.lastActivityAt = Date.now();
        this.persistSoon();
        this.emitSoon(true);
        return true;
    }
    removeTicket(ticketID) {
        const ticket = this.tickets.get(ticketID);
        if (!ticket)
            return;
        if (ticket.sessionID && isActive(ticket.status)) {
            void this.ctx.session.interrupt({ sessionID: ticket.sessionID, resume: false }).catch(() => { });
        }
        if (ticket.sessionID)
            this.workerSessions.delete(ticket.sessionID);
        this.tickets.delete(ticketID);
        this.attention = this.attention.filter((item) => item.ticketID !== ticketID);
        this.persistSoon();
        this.emitSoon(true);
    }
    async runWatchdog(force = false) {
        if (!this.settings.watchdogEnabled) {
            return { ran: false, reason: "watchdog-disabled", applied: 0 };
        }
        if (this.watchdogState.running) {
            return { ran: false, reason: "already-running", applied: 0 };
        }
        const tickets = this.activeTickets();
        if (tickets.length === 0) {
            return { ran: false, reason: "no-active-tickets", applied: 0 };
        }
        this.watchdogState.running = true;
        this.watchdogState.lastError = null;
        this.emitSoon(true);
        try {
            const sessionID = await this.ensureWatchdogSession(tickets[0]?.directory ?? this.ctx.location.directory);
            const snapshots = [];
            for (const ticket of tickets) {
                await this.refreshTicket(ticket);
                snapshots.push(await this.snapshot(ticket));
            }
            if (snapshots.length === 0) {
                this.watchdogState.lastRunAt = Date.now();
                return { ran: true, applied: 0 };
            }
            const prompt = buildWatchdogPrompt({
                settings: { stallAfterSec: this.settings.stallAfterSec, watchdogInstructions: this.settings.watchdogInstructions },
                snapshots,
                now: Date.now(),
            });
            await this.ctx.session.prompt({ sessionID, text: prompt, delivery: "steer" });
            await withTimeout(this.ctx.session.wait({ sessionID }), 180_000);
            const messages = asMessages(await this.ctx.session.context({ sessionID }));
            const text = lastAssistantText(messages);
            if (!text.trim()) {
                const failure = messageError(messages);
                throw new Error(failure ? `Watchdog request failed: ${failure}` : "Watchdog returned no assistant text");
            }
            const decision = extractDecision(text);
            const applied = await this.applyDecision(decision);
            this.watchdogState.lastDecision = decision;
            this.watchdogState.lastRunAt = Date.now();
            this.watchdogState.lastError = null;
            this.emitNotice({
                level: "info",
                title: "Watchdog check complete",
                code: "watchdog-complete",
                message: decision.summary ?? `${decision.workers.length} worker(s) assessed`,
            });
            this.persistSoon();
            this.emitSoon(true);
            return { ran: true, decision, applied };
        }
        catch (error) {
            const message = errorText(error);
            this.watchdogState.lastError = message;
            this.watchdogState.lastRunAt = Date.now();
            this.watchdogState.lastDecision = null;
            this.addAttention(undefined, "Watchdog check failed", message, "watchdog-failed");
            this.emitNotice({ level: "error", title: "Watchdog check failed", code: "watchdog-failed", message });
            this.persistSoon();
            this.emitSoon(true);
            return { ran: true, applied: 0, error: message };
        }
        finally {
            this.watchdogState.running = false;
            this.emitSoon(true);
        }
    }
    async openWatchdogSession() {
        return this.ensureWatchdogSession();
    }
    clearAttention(id, all = false) {
        if (all)
            this.attention = [];
        else if (id)
            this.attention = this.attention.filter((item) => item.id !== id);
        this.persistSoon();
        this.emitSoon(true);
    }
    /** Export only portable settings. Sessions, tickets, credentials, and paths stay on this machine. */
    exportProfile() {
        const content = JSON.stringify({
            kind: "opencode-superagent-profile",
            version: 1,
            exportedAt: new Date().toISOString(),
            plugin: { package: "opencode-superagent", version: PLUGIN_VERSION },
            settings: this.settings,
        }, null, 2);
        return { filename: "superagent-profile.json", content };
    }
    async importProfile(input) {
        const raw = input.content;
        if (!raw)
            throw new Error("Profile content is required; choose the file from the desktop window");
        const parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
        if (parsed.kind !== "opencode-superagent-profile") {
            throw new Error("This is not an opencode-superagent profile");
        }
        if (parsed.version !== 1)
            throw new Error(`Unsupported profile version: ${String(parsed.version)}`);
        this.settings = normalizeSettings(parsed.settings, this.settings);
        await this.loadOptions();
        const available = new Set(this.modelsCache.map((model) => modelKey(model)));
        if (this.settings.workerModel && !available.has(modelKey(this.settings.workerModel)))
            this.settings.workerModel = null;
        if (this.settings.watchdogModel && !available.has(modelKey(this.settings.watchdogModel))) {
            this.settings.watchdogModel = null;
        }
        this.watchdogState.enabled = this.settings.watchdogEnabled;
        this.restartTimer();
        await this.applyWatchdogSessionSettings().catch(() => { });
        if (typeof parsed.exportedAt === "string" && parsed.exportedAt) {
            await this.ctx.storage.set("profile.importedAt", parsed.exportedAt);
        }
        this.persistSoon();
        this.emitNotice({ level: "success", title: "Superagent profile imported", code: "profile-imported" });
        this.emitSoon(true);
        return this.state();
    }
    async applyNestedPolicy(sessionID) {
        await this.ctx.session.update({
            sessionID,
            permissions: this.settings.allowNestedSubagents
                ? []
                : [{ action: "subagent", resource: "*", effect: "deny" }],
        });
    }
    async applyNestedPolicyToWorkers() {
        await Promise.all([...this.workerSessions].map((sessionID) => this.applyNestedPolicy(sessionID)));
    }
    async createSession(input) {
        const created = await this.ctx.session.create({
            title: input.title,
            ...(input.agent ? { agent: input.agent } : {}),
            ...(input.model
                ? {
                    model: {
                        id: input.model.modelID,
                        providerID: input.model.providerID,
                        ...(input.model.variant ? { variant: input.model.variant } : {}),
                    },
                }
                : {}),
            location: { directory: (input.directory ?? this.ctx.location.directory) },
            metadata: {
                superagent: {
                    role: input.role,
                    ...(input.ticketID ? { ticketID: input.ticketID } : {}),
                },
            },
        });
        return {
            id: created.id,
            directory: input.directory ?? this.ctx.location.directory,
            ...(created.model ? { model: created.model } : {}),
        };
    }
    async ensureWatchdogSession(directory = this.ctx.location.directory) {
        if (this.watchdogState.sessionID) {
            try {
                await this.ctx.session.get({ sessionID: this.watchdogState.sessionID });
                this.watchdogSessions.add(this.watchdogState.sessionID);
                await this.applyWatchdogSessionSettings();
                return this.watchdogState.sessionID;
            }
            catch {
                this.watchdogState.sessionID = null;
            }
        }
        const created = await this.createSession({
            title: "Superagent Watchdog",
            agent: this.settings.watchdogAgent ?? undefined,
            model: this.settings.watchdogModel ?? undefined,
            directory,
            role: "watchdog",
        });
        this.watchdogState.sessionID = created.id;
        this.watchdogSessions.add(created.id);
        this.persistSoon();
        return created.id;
    }
    async applyWatchdogSessionSettings() {
        const sessionID = this.watchdogState.sessionID;
        if (!sessionID)
            return;
        if (this.settings.watchdogAgent) {
            await this.ctx.session.switchAgent({ sessionID, agent: this.settings.watchdogAgent }).catch(() => { });
        }
        if (this.settings.watchdogModel) {
            await this.ctx.session
                .switchModel({
                sessionID,
                model: {
                    id: this.settings.watchdogModel.modelID,
                    providerID: this.settings.watchdogModel.providerID,
                    ...(this.settings.watchdogModel.variant ? { variant: this.settings.watchdogModel.variant } : {}),
                },
            })
                .catch(() => { });
        }
    }
    async snapshot(ticket) {
        const now = Date.now();
        let messages = [];
        if (ticket.sessionID) {
            try {
                messages = asMessages(await this.ctx.session.context({ sessionID: ticket.sessionID }));
            }
            catch {
                // A missing session is itself useful evidence for the watchdog.
            }
        }
        return {
            ticketID: ticket.id,
            title: ticket.title,
            status: ticket.status,
            ageSec: Math.round((now - ticket.createdAt) / 1000),
            idleSec: Math.round((now - ticket.lastActivityAt) / 1000),
            nudges: ticket.nudges,
            checks: ticket.checks,
            model: modelKey(ticket.model) || "default",
            lastText: truncate(ticket.lastText ?? "", 3000),
            recentAssistant: recentAssistant(messages, 4),
            recentTools: recentToolNames(messages, 12),
            ...(ticket.lastError ? { lastError: truncate(ticket.lastError, 1200) } : {}),
        };
    }
    async applyDecision(decision) {
        let applied = 0;
        for (const entry of decision.workers) {
            const ticket = this.tickets.get(entry.ticketID);
            if (!ticket || !isActive(ticket.status))
                continue;
            ticket.checks += 1;
            ticket.watchdogNote = truncate(entry.reason, 2000);
            ticket.updatedAt = Date.now();
            if (entry.assessment === "done") {
                ticket.status = "done";
                applied++;
                continue;
            }
            if (entry.assessment === "failed") {
                ticket.status = "failed";
                ticket.lastError = entry.reason || "Watchdog marked the worker as failed";
                this.addAttention(ticket, "Worker failed", entry.reason || "Watchdog marked the worker as failed", "worker-failed");
                applied++;
                continue;
            }
            if (entry.assessment === "needs_input") {
                ticket.status = "waiting";
                ticket.attention = true;
                this.addAttention(ticket, "Worker needs input", entry.message || entry.reason || "The worker is waiting on a decision", "worker-needs-input");
                applied++;
                continue;
            }
            if (entry.action === "escalate") {
                ticket.attention = true;
                this.addAttention(ticket, "Worker needs attention", entry.message || entry.reason || "The watchdog escalated this worker", "worker-needs-attention");
                applied++;
                continue;
            }
            if (!this.settings.autoRecover) {
                if (entry.assessment === "stalled" || entry.assessment === "off_track") {
                    this.addAttention(ticket, "Worker may be stuck", entry.reason || "The watchdog detected a stall", "worker-stuck");
                }
                continue;
            }
            if (entry.action === "nudge" && ticket.sessionID) {
                try {
                    await this.ctx.session.prompt({
                        sessionID: ticket.sessionID,
                        text: buildNudgeMessage(entry),
                        delivery: ticket.status === "running" ? "steer" : "queue",
                    });
                    ticket.nudges += 1;
                    ticket.status = ticket.status === "waiting" ? "running" : ticket.status;
                    ticket.updatedAt = Date.now();
                    ticket.lastActivityAt = Date.now();
                    applied++;
                }
                catch (error) {
                    ticket.lastError = errorText(error);
                    this.addAttention(ticket, "Could not nudge worker", ticket.lastError, "nudge-failed");
                }
                continue;
            }
            if (entry.action === "interrupt" && ticket.sessionID) {
                try {
                    const result = await this.ctx.session.interrupt({ sessionID: ticket.sessionID, resume: false });
                    if (result.interrupted) {
                        await this.ctx.session.prompt({
                            sessionID: ticket.sessionID,
                            text: buildRecoveryMessage(entry),
                            delivery: "steer",
                        });
                        ticket.nudges += 1;
                        ticket.status = "running";
                        ticket.updatedAt = Date.now();
                        ticket.lastActivityAt = Date.now();
                        applied++;
                    }
                }
                catch (error) {
                    ticket.lastError = errorText(error);
                    this.addAttention(ticket, "Could not recover worker", ticket.lastError, "recover-failed");
                }
            }
        }
        this.persistSoon();
        this.emitSoon(true);
        return applied;
    }
    async refreshTicket(ticket) {
        if (!ticket.sessionID)
            return;
        try {
            const messages = asMessages(await this.ctx.session.context({ sessionID: ticket.sessionID }));
            const text = lastAssistantText(messages);
            if (text)
                ticket.lastText = truncate(text, 12_000);
            const last = lastMessageTime(messages);
            if (last > ticket.lastActivityAt)
                ticket.lastActivityAt = last;
            const error = messageError(messages);
            if (error)
                ticket.lastError = error;
        }
        catch {
            // The session may have been removed between the list and this read.
        }
    }
    async consumeEvents() {
        const types = [
            "session.created",
            "session.deleted",
            "session.execution.started",
            "session.execution.succeeded",
            "session.execution.failed",
            "session.execution.interrupted",
            "session.text.ended",
            "session.tool.called",
            "session.tool.success",
            "session.tool.failed",
            "session.model.selected",
        ];
        try {
            for await (const event of this.ctx.event.subscribe({
                types: types,
                signal: this.eventAbort.signal,
            })) {
                this.onEvent(event);
            }
        }
        catch (error) {
            if (!this.disposed) {
                this.emitNotice({
                    level: "error",
                    title: "Superagent event stream stopped",
                    code: "event-stream-stopped",
                    message: errorText(error),
                });
            }
        }
    }
    onEvent(event) {
        const sessionID = typeof event.data?.sessionID === "string" ? event.data.sessionID : undefined;
        if (!sessionID)
            return;
        const ticket = this.findTicketBySession(sessionID);
        if (!ticket)
            return;
        const now = Date.now();
        ticket.updatedAt = now;
        switch (event.type) {
            case "session.execution.started":
                if (ticket.status !== "cancelled" && ticket.status !== "done" && ticket.status !== "failed")
                    ticket.status = "running";
                ticket.lastActivityAt = now;
                break;
            case "session.execution.succeeded":
                if (ticket.status !== "cancelled" && ticket.status !== "done" && ticket.status !== "failed")
                    ticket.status = "waiting";
                ticket.lastActivityAt = now;
                void this.refreshTicket(ticket).then(() => {
                    this.persistSoon();
                    this.emitSoon();
                });
                break;
            case "session.execution.failed": {
                ticket.status = "failed";
                const error = event.data?.error;
                ticket.lastError = typeof error === "string" ? error : errorText(error);
                this.addAttention(ticket, "Worker failed", ticket.lastError ?? "The worker execution failed", "worker-failed");
                break;
            }
            case "session.execution.interrupted": {
                if (ticket.status !== "cancelled" && ticket.status !== "done" && ticket.status !== "failed") {
                    ticket.status = "waiting";
                }
                ticket.lastActivityAt = now;
                break;
            }
            case "session.text.ended": {
                const text = typeof event.data?.text === "string" ? event.data.text : "";
                if (text)
                    ticket.lastText = truncate(text, 12_000);
                ticket.lastActivityAt = now;
                break;
            }
            case "session.tool.called":
            case "session.tool.success":
            case "session.tool.failed":
                ticket.lastActivityAt = now;
                break;
            case "session.deleted":
                if (isActive(ticket.status)) {
                    ticket.status = "cancelled";
                    ticket.lastError = "Session was removed";
                }
                this.workerSessions.delete(sessionID);
                break;
        }
        this.persistSoon();
        this.emitSoon();
    }
    findTicketBySession(sessionID) {
        for (const ticket of this.tickets.values()) {
            if (ticket.sessionID === sessionID)
                return ticket;
        }
        return undefined;
    }
    activeTickets() {
        return Array.from(this.tickets.values()).filter((ticket) => isActive(ticket.status));
    }
    requireTicket(ticketID) {
        const ticket = this.tickets.get(ticketID);
        if (!ticket)
            throw new Error(`Unknown Superagent ticket: ${ticketID}`);
        return ticket;
    }
    restartTimer() {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
        if (!this.settings.watchdogEnabled) {
            this.watchdogState.nextRunAt = null;
            this.watchdogState.enabled = false;
            this.emitSoon(true);
            return;
        }
        this.watchdogState.enabled = true;
        const intervalMs = this.settings.watchdogIntervalSec * 1000;
        this.watchdogState.nextRunAt = Date.now() + intervalMs;
        this.timer = setInterval(() => {
            this.watchdogState.nextRunAt = Date.now() + intervalMs;
            if (!this.watchdogState.running)
                void this.runWatchdog();
        }, intervalMs);
    }
    async loadOptions() {
        if (Date.now() - this.optionsAt < 30_000)
            return;
        if (this.optionsLoading)
            return this.optionsLoading;
        this.optionsLoading = (async () => {
            try {
                const [rawModels, rawProviders, rawAgents] = await Promise.all([
                    this.ctx.model.list().catch(() => []),
                    this.ctx.provider.list().catch(() => []),
                    this.ctx.agent.list().catch(() => []),
                ]);
                const models = unwrapList(rawModels);
                const providers = unwrapList(rawProviders);
                const providerNames = new Map();
                for (const provider of providers) {
                    if (provider.id && provider.activation === "enabled") {
                        providerNames.set(provider.id, provider.name || provider.id);
                    }
                }
                this.modelsCache = models
                    .filter((model) => {
                    if (model.enabled === false)
                        return false;
                    if (model.capabilities && model.capabilities.tools === false)
                        return false;
                    if (providerNames.size > 0 && model.providerID)
                        return providerNames.has(model.providerID);
                    return true;
                })
                    .map((model) => {
                    const modelID = model.modelID || model.id || "";
                    const providerID = model.providerID || "";
                    if (!modelID || !providerID)
                        return undefined;
                    return {
                        providerID,
                        modelID,
                        name: model.name || modelID,
                        providerName: providerNames.get(providerID) || providerID,
                    };
                })
                    .filter((model) => Boolean(model))
                    .sort((a, b) => a.providerName.localeCompare(b.providerName) || a.name.localeCompare(b.name));
                this.agentsCache = unwrapList(rawAgents)
                    .filter((agent) => {
                    if (typeof agent.id !== "string" || !agent.id)
                        return false;
                    if (agent.hidden)
                        return false;
                    if (agent.id === SUPERAGENT_AGENT_ID)
                        return false;
                    return !["title", "summary", "compaction"].includes(agent.id);
                })
                    .map((agent) => {
                    const model = agent.model;
                    return {
                        id: agent.id,
                        name: agent.name || agent.id,
                        mode: agent.mode || "all",
                        ...(model && model.providerID && (model.id || model.modelID)
                            ? {
                                model: {
                                    providerID: model.providerID,
                                    modelID: (model.modelID || model.id),
                                    ...(model.variant ? { variant: model.variant } : {}),
                                },
                            }
                            : {}),
                    };
                })
                    .sort((a, b) => a.name.localeCompare(b.name));
                this.optionsAt = Date.now();
            }
            finally {
                this.optionsLoading = null;
            }
        })();
        return this.optionsLoading;
    }
    addAttention(ticket, title, message, code) {
        const now = Date.now();
        const existing = this.attention.find((item) => !item.read &&
            (code ? item.code === code : item.title === title) &&
            (item.ticketID ?? "") === (ticket?.id ?? ""));
        if (existing) {
            existing.message = truncate(message, 4000);
            existing.createdAt = now;
            this.emitAttention(existing);
            this.persistSoon();
            return;
        }
        const item = {
            id: `a_${randomID()}`,
            ...(ticket ? { ticketID: ticket.id } : {}),
            ...(code ? { code } : {}),
            title,
            message: truncate(message, 4000),
            createdAt: now,
            read: false,
        };
        this.attention.unshift(item);
        if (this.attention.length > 50)
            this.attention.length = 50;
        this.emitAttention(item);
        this.persistSoon();
    }
    persistSoon() {
        if (this.disposed)
            return;
        if (this.persistTimer)
            clearTimeout(this.persistTimer);
        this.persistTimer = setTimeout(() => {
            this.persistTimer = null;
            void this.persistNow();
        }, 300);
    }
    persistNow() {
        const settings = this.settings;
        const tickets = Array.from(this.tickets.values());
        const attention = this.attention.slice();
        this.persistence = this.persistence
            .then(async () => {
            await this.ctx.storage.set(SETTINGS_KEY, settings);
            await this.ctx.storage.set(TICKETS_KEY, tickets);
            await this.ctx.storage.set(ATTENTION_KEY, attention);
        })
            .catch((error) => {
            this.emitNotice({
                level: "error",
                title: "Could not save Superagent state",
                code: "save-failed",
                message: errorText(error),
            });
        });
        return this.persistence;
    }
    emitSoon(immediate = false) {
        if (this.disposed)
            return;
        if (immediate) {
            if (this.emitTimer)
                clearTimeout(this.emitTimer);
            this.emitTimer = null;
            void this.state().then((state) => this.emitState(state)).catch(() => { });
            return;
        }
        if (this.emitTimer)
            return;
        this.emitTimer = setTimeout(() => {
            this.emitTimer = null;
            void this.state().then((state) => this.emitState(state)).catch(() => { });
        }, 400);
    }
}
function newTicketID() {
    return `t_${randomID()}`;
}
function randomID() {
    const crypto = globalThis.crypto;
    if (crypto && typeof crypto.randomUUID === "function")
        return crypto.randomUUID().slice(0, 12);
    return Math.random().toString(36).slice(2, 14);
}
function ticketTitle(input, task) {
    const raw = (input ?? "").trim() || task.split(/\r?\n/, 1)[0]?.trim() || "Task";
    return truncate(raw.replace(/\s+/g, " "), 72);
}
function errorText(error) {
    if (error instanceof Error)
        return error.message;
    if (typeof error === "string")
        return error;
    if (error && typeof error === "object") {
        const record = error;
        if (typeof record.message === "string")
            return record.message;
        try {
            return JSON.stringify(error);
        }
        catch {
            return "unknown error";
        }
    }
    return String(error);
}
function withTimeout(promise, ms) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(undefined), ms);
        promise.then((value) => {
            clearTimeout(timer);
            resolve(value);
        }, () => {
            clearTimeout(timer);
            resolve(undefined);
        });
    });
}
