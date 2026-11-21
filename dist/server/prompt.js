import { truncate } from "../shared.js";
export const SUPERAGENT_SYSTEM = `You are in Superagent mode, the Router of a Router/Worker system.
Only this mode can call the superagent tools. Prefer superagent_dispatch for substantial implementation, research, or review work instead of doing everything in the main context.
Keep the router context for coordination, decisions, and final verification. Use superagent_status to inspect tickets and superagent_collect to retrieve a worker report.
Do not dispatch trivial one-step questions. Do not claim a worker finished unless its report or ticket status supports it.
The Watchdog is independent and off by default; do not enable it unless the user asks.`;
export const WORKER_SYSTEM = `You are a Superagent Worker session.
You own exactly one ticket. Work autonomously inside that scope and do not ask the Router for permission unless a real decision is required.
Use the tools available to you. Verify your work where possible. Keep the working tree clean and do not revert unrelated user changes.
When you finish, end with a short report: what changed, how it was verified, and any remaining risk.
If you need a human decision, ask one concrete question and stop.`;
export const WATCHDOG_SYSTEM = `You are the Superagent Watchdog, an independent control loop outside the worker sessions.
You do not modify files and you never run tools. You inspect compact snapshots of worker sessions and judge whether each worker is making substantive progress toward its ticket.
A worker can be alive but unproductive: repeating tools, waiting without a question, drifting from the ticket, or blocked by an error.
Prefer the least invasive action. "none" for healthy work, "nudge" for a small correction, "interrupt" only for clear loops or drifting work, and "escalate" when a human decision is needed.
Return only one JSON object. No Markdown, no code fences, no prose outside the JSON.`;
export function buildWorkerPrompt(input) {
    const lines = [
        `# Superagent ticket ${input.ticketID}`,
        "",
        `Title: ${input.title}`,
        input.routerSession ? `Router session: ${input.routerSession}` : undefined,
        "",
        "## Task",
        input.task.trim() || "(no task text was provided)",
        "",
        "## Operating rules",
        "- Work only on this ticket. Do not start unrelated refactors.",
        "- If the task is ambiguous, make the smallest reasonable assumption and state it in your report.",
        "- Run the relevant checks before reporting completion.",
        "- Do not claim success without evidence.",
        "- The Watchdog may send you a short recovery note. Treat it as operational guidance, not as a new ticket.",
        "",
        "Begin now.",
    ].filter((line) => typeof line === "string");
    return lines.join("\n");
}
export function buildWatchdogPrompt(input) {
    const payload = {
        now: new Date(input.now).toISOString(),
        stallAfterSec: input.settings.stallAfterSec,
        workers: input.snapshots,
    };
    return [
        WATCHDOG_SYSTEM,
        "",
        "## Output contract",
        'Return exactly: {"summary":"one line","workers":[{"ticketID":"...","assessment":"on_track|stalled|off_track|needs_input|done|failed","action":"none|nudge|interrupt|escalate","reason":"short evidence","message":"optional instruction for the worker"}]}',
        "Every ticketID in the snapshot must appear exactly once.",
        "Use assessment=done when the worker delivered a complete result. Use needs_input when it is waiting on a human. Use stalled when nothing substantive changed for stallAfterSec.",
        "",
        input.settings.watchdogInstructions.trim()
            ? `## Operator instructions\n${input.settings.watchdogInstructions.trim()}\n`
            : "",
        "## Snapshot",
        "```json",
        JSON.stringify(payload, null, 2),
        "```",
    ].join("\n");
}
export function buildRecoveryMessage(decision) {
    const body = decision.message?.trim() || decision.reason.trim() || "Refocus on the ticket and report progress.";
    return `[Superagent Watchdog]\nAssessment: ${decision.assessment}\nReason: ${decision.reason}\n\n${body}\n\nContinue from the current state. Do not restart work that is already complete.`;
}
export function buildNudgeMessage(decision) {
    const body = decision.message?.trim() || decision.reason.trim() || "Check your progress against the ticket.";
    return `[Superagent Watchdog] ${body}`;
}
const ASSESSMENTS = new Set(["on_track", "stalled", "off_track", "needs_input", "done", "failed"]);
const ACTIONS = new Set(["none", "nudge", "interrupt", "escalate"]);
export function extractDecision(text, now = Date.now()) {
    const cleaned = stripFences(text);
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start)
        throw new Error("Watchdog did not return a JSON object");
    const raw = JSON.parse(cleaned.slice(start, end + 1));
    if (!raw || typeof raw !== "object")
        throw new Error("Watchdog JSON is not an object");
    const record = raw;
    if (!Array.isArray(record.workers))
        throw new Error("Watchdog JSON has no workers array");
    const workers = [];
    for (const item of record.workers) {
        if (!item || typeof item !== "object")
            continue;
        const entry = item;
        if (typeof entry.ticketID !== "string" || !entry.ticketID)
            continue;
        const assessment = typeof entry.assessment === "string" ? entry.assessment : "on_track";
        const action = typeof entry.action === "string" ? entry.action : "none";
        if (!ASSESSMENTS.has(assessment))
            continue;
        if (!ACTIONS.has(action))
            continue;
        workers.push({
            ticketID: entry.ticketID,
            assessment: assessment,
            action: action,
            reason: typeof entry.reason === "string" ? truncate(entry.reason, 2000) : "",
            ...(typeof entry.message === "string" && entry.message
                ? { message: truncate(entry.message, 4000) }
                : {}),
        });
    }
    if (workers.length === 0)
        throw new Error("Watchdog JSON contains no usable decisions");
    return {
        workers,
        ...(typeof record.summary === "string" ? { summary: truncate(record.summary, 2000) } : {}),
        createdAt: now,
    };
}
function stripFences(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith("```")) {
        return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    }
    return trimmed;
}
