import { Rpc } from "@opencode/plugin/rpc";
import { PLUGIN_ID } from "./shared.js";
const model = {
    type: "object",
    properties: {
        providerID: { type: "string" },
        modelID: { type: "string" },
        variant: { type: "string" },
    },
    required: ["providerID", "modelID"],
    additionalProperties: false,
};
const modelOption = {
    type: "object",
    properties: {
        providerID: { type: "string" },
        modelID: { type: "string" },
        variant: { type: "string" },
        name: { type: "string" },
        providerName: { type: "string" },
    },
    required: ["providerID", "modelID", "name", "providerName"],
    additionalProperties: false,
};
const agentOption = {
    type: "object",
    properties: {
        id: { type: "string" },
        name: { type: "string" },
        mode: { type: "string" },
        model: { anyOf: [model, { type: "null" }] },
    },
    required: ["id", "name", "mode"],
    additionalProperties: false,
};
const ticket = {
    type: "object",
    properties: {
        id: { type: "string" },
        title: { type: "string" },
        task: { type: "string" },
        sessionID: { type: "string" },
        status: { type: "string", enum: ["queued", "running", "waiting", "done", "failed", "cancelled"] },
        createdAt: { type: "number" },
        updatedAt: { type: "number" },
        lastActivityAt: { type: "number" },
        model: { anyOf: [model, { type: "null" }] },
        agent: { type: "string" },
        directory: { type: "string" },
        nudges: { type: "number" },
        checks: { type: "number" },
        lastText: { type: "string" },
        lastError: { type: "string" },
        watchdogNote: { type: "string" },
        attention: { type: "boolean" },
        source: { type: "string", enum: ["tool", "command", "desktop"] },
        ageMs: { type: "number" },
        idleMs: { type: "number" },
    },
    required: ["id", "title", "task", "status", "createdAt", "updatedAt", "lastActivityAt", "nudges", "checks", "ageMs", "idleMs"],
    additionalProperties: true,
};
const settings = {
    type: "object",
    properties: {
        language: { type: "string", enum: ["auto", "zh-CN", "en"] },
        watchdogEnabled: { type: "boolean" },
        watchdogIntervalSec: { type: "number" },
        stallAfterSec: { type: "number" },
        workerModel: { anyOf: [model, { type: "null" }] },
        watchdogModel: { anyOf: [model, { type: "null" }] },
        workerAgent: { anyOf: [{ type: "string" }, { type: "null" }] },
        watchdogAgent: { anyOf: [{ type: "string" }, { type: "null" }] },
        autoRecover: { type: "boolean" },
        notifyOnEscalation: { type: "boolean" },
        allowNestedSubagents: { type: "boolean" },
        maxWorkers: { type: "number" },
        watchdogInstructions: { type: "string" },
    },
    required: [
        "language",
        "watchdogEnabled",
        "watchdogIntervalSec",
        "stallAfterSec",
        "workerModel",
        "watchdogModel",
        "workerAgent",
        "watchdogAgent",
        "autoRecover",
        "notifyOnEscalation",
        "allowNestedSubagents",
        "maxWorkers",
        "watchdogInstructions",
    ],
    additionalProperties: false,
};
const decision = {
    type: "object",
    properties: {
        workers: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    ticketID: { type: "string" },
                    assessment: {
                        type: "string",
                        enum: ["on_track", "stalled", "off_track", "needs_input", "done", "failed"],
                    },
                    action: { type: "string", enum: ["none", "nudge", "interrupt", "escalate"] },
                    reason: { type: "string" },
                    message: { type: "string" },
                },
                required: ["ticketID", "assessment", "action", "reason"],
                additionalProperties: false,
            },
        },
        summary: { type: "string" },
        createdAt: { type: "number" },
    },
    required: ["workers", "createdAt"],
    additionalProperties: false,
};
const attention = {
    type: "object",
    properties: {
        id: { type: "string" },
        ticketID: { type: "string" },
        code: { type: "string" },
        title: { type: "string" },
        message: { type: "string" },
        createdAt: { type: "number" },
        read: { type: "boolean" },
    },
    required: ["id", "title", "message", "createdAt", "read"],
    additionalProperties: false,
};
const state = {
    type: "object",
    properties: {
        pluginVersion: { type: "string" },
        settings,
        models: { type: "array", items: modelOption },
        agents: { type: "array", items: agentOption },
        tickets: { type: "array", items: ticket },
        watchdog: {
            type: "object",
            properties: {
                enabled: { type: "boolean" },
                running: { type: "boolean" },
                lastRunAt: { anyOf: [{ type: "number" }, { type: "null" }] },
                lastError: { anyOf: [{ type: "string" }, { type: "null" }] },
                nextRunAt: { anyOf: [{ type: "number" }, { type: "null" }] },
                sessionID: { anyOf: [{ type: "string" }, { type: "null" }] },
                lastDecision: { anyOf: [decision, { type: "null" }] },
            },
            required: ["enabled", "running", "lastRunAt", "lastError", "nextRunAt", "sessionID", "lastDecision"],
            additionalProperties: false,
        },
        attention: { type: "array", items: attention },
        serverDirectory: { type: "string" },
    },
    required: ["pluginVersion", "settings", "models", "agents", "tickets", "watchdog", "attention", "serverDirectory"],
    additionalProperties: false,
};
const settingsPatch = {
    type: "object",
    properties: {
        language: { type: "string", enum: ["auto", "zh-CN", "en"] },
        watchdogEnabled: { type: "boolean" },
        watchdogIntervalSec: { type: "number" },
        stallAfterSec: { type: "number" },
        workerModel: { anyOf: [model, { type: "null" }] },
        watchdogModel: { anyOf: [model, { type: "null" }] },
        workerAgent: { anyOf: [{ type: "string" }, { type: "null" }] },
        watchdogAgent: { anyOf: [{ type: "string" }, { type: "null" }] },
        autoRecover: { type: "boolean" },
        notifyOnEscalation: { type: "boolean" },
        allowNestedSubagents: { type: "boolean" },
        maxWorkers: { type: "number" },
        watchdogInstructions: { type: "string" },
    },
    additionalProperties: false,
};
export const SuperagentRpc = Rpc.define({
    id: PLUGIN_ID,
    methods: {
        getState: {
            input: { type: "object", properties: {}, additionalProperties: false },
            output: state,
        },
        updateSettings: {
            input: { type: "object", properties: { patch: settingsPatch }, required: ["patch"], additionalProperties: false },
            output: state,
        },
        dispatch: {
            input: {
                type: "object",
                properties: {
                    task: { type: "string" },
                    title: { type: "string" },
                    sessionID: { type: "string" },
                    model: { anyOf: [model, { type: "null" }] },
                    agent: { anyOf: [{ type: "string" }, { type: "null" }] },
                    directory: { type: "string" },
                    source: { type: "string", enum: ["tool", "command", "desktop"] },
                },
                required: ["task", "sessionID"],
                additionalProperties: false,
            },
            output: {
                type: "object",
                properties: {
                    ticketID: { type: "string" },
                    sessionID: { type: "string" },
                    title: { type: "string" },
                    status: { type: "string" },
                    model: { anyOf: [model, { type: "null" }] },
                    agent: { type: "string" },
                },
                required: ["ticketID", "sessionID", "title", "status"],
                additionalProperties: false,
            },
        },
        collect: {
            input: {
                type: "object",
                properties: { ticketID: { type: "string" }, timeoutMs: { type: "number" } },
                required: ["ticketID"],
                additionalProperties: false,
            },
            output: {
                type: "object",
                properties: {
                    ticketID: { type: "string" },
                    sessionID: { type: "string" },
                    status: { type: "string" },
                    text: { type: "string" },
                    idleMs: { type: "number" },
                },
                required: ["ticketID", "sessionID", "status", "text", "idleMs"],
                additionalProperties: false,
            },
        },
        cancel: {
            input: { type: "object", properties: { ticketID: { type: "string" } }, required: ["ticketID"], additionalProperties: false },
            output: {
                type: "object",
                properties: { cancelled: { type: "boolean" }, state },
                required: ["cancelled"],
                additionalProperties: false,
            },
        },
        removeTicket: {
            input: { type: "object", properties: { ticketID: { type: "string" } }, required: ["ticketID"], additionalProperties: false },
            output: state,
        },
        runWatchdog: {
            input: {
                type: "object",
                properties: { force: { type: "boolean" } },
                additionalProperties: false,
            },
            output: {
                type: "object",
                properties: {
                    ran: { type: "boolean" },
                    reason: { type: "string" },
                    decision: { anyOf: [decision, { type: "null" }] },
                    applied: { type: "number" },
                    error: { type: "string" },
                },
                required: ["ran", "applied"],
                additionalProperties: false,
            },
        },
        clearAttention: {
            input: {
                type: "object",
                properties: { id: { type: "string" }, all: { type: "boolean" } },
                additionalProperties: false,
            },
            output: state,
        },
        exportProfile: {
            input: { type: "object", properties: {}, additionalProperties: false },
            output: {
                type: "object",
                properties: { filename: { type: "string" }, content: { type: "string" } },
                required: ["filename", "content"],
                additionalProperties: false,
            },
        },
        importProfile: {
            input: {
                type: "object",
                properties: { path: { type: "string" }, content: { type: "string" } },
                additionalProperties: false,
            },
            output: state,
        },
        openWatchdogSession: {
            input: { type: "object", properties: {}, additionalProperties: false },
            output: {
                type: "object",
                properties: { sessionID: { type: "string" } },
                required: ["sessionID"],
                additionalProperties: false,
            },
        },
        enterMode: {
            input: {
                type: "object",
                properties: { sessionID: { type: "string" } },
                required: ["sessionID"],
                additionalProperties: false,
            },
            output: {
                type: "object",
                properties: {
                    sessionID: { type: "string" },
                    agent: { type: "string" },
                },
                required: ["sessionID", "agent"],
                additionalProperties: false,
            },
        },
        openModeSession: {
            input: { type: "object", properties: {}, additionalProperties: false },
            output: {
                type: "object",
                properties: { sessionID: { type: "string" } },
                required: ["sessionID"],
                additionalProperties: false,
            },
        },
    },
    events: {
        state: { schema: state },
        attention: { schema: attention },
        notice: {
            schema: {
                type: "object",
                properties: {
                    level: { type: "string", enum: ["info", "success", "warning", "error"] },
                    title: { type: "string" },
                    code: { type: "string" },
                    message: { type: "string" },
                },
                required: ["level", "title"],
                additionalProperties: false,
            },
        },
    },
});
