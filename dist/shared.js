/**
 * Types and small pure helpers shared by the server part and the desktop GUI.
 *
 * Keep this file free of Node, Electron, Solid, and OpenCode runtime imports so
 * both build targets can use it.
 */
export const PLUGIN_ID = "superagent";
export const SUPERAGENT_AGENT_ID = "superagent";
export const PACKAGE_NAME = "opencode-superagent";
export const PLUGIN_VERSION = "0.1.0";
export const PROFILE_KIND = "opencode-superagent-profile";
export const PROFILE_VERSION = 1;
export const DEFAULT_SETTINGS = {
    language: "zh-CN",
    watchdogEnabled: false,
    watchdogIntervalSec: 90,
    stallAfterSec: 300,
    workerModel: null,
    watchdogModel: null,
    workerAgent: null,
    watchdogAgent: null,
    autoRecover: true,
    notifyOnEscalation: true,
    allowNestedSubagents: false,
    maxWorkers: 8,
    watchdogInstructions: "",
};
export const ACTIVE_STATUSES = ["queued", "running", "waiting"];
/** Format a model reference the way OpenCode configuration does. */
export function modelKey(model) {
    if (!model)
        return "";
    return `${model.providerID}/${model.modelID}${model.variant ? `#${model.variant}` : ""}`;
}
/** Parse `provider/model` or `provider/model#variant` into a model reference. */
export function parseModelKey(value) {
    if (!value)
        return null;
    const [left, variant] = value.split("#", 2);
    const slash = left.indexOf("/");
    if (slash <= 0 || slash === left.length - 1)
        return null;
    return {
        providerID: left.slice(0, slash),
        modelID: left.slice(slash + 1),
        ...(variant ? { variant } : {}),
    };
}
export function sameModel(a, b) {
    if (!a || !b)
        return a === b;
    return a.providerID === b.providerID && a.modelID === b.modelID && (a.variant ?? "") === (b.variant ?? "");
}
export function truncate(value, max) {
    if (value.length <= max)
        return value;
    return `${value.slice(0, Math.max(0, max - 1))}…`;
}
export function isActive(status) {
    return ACTIVE_STATUSES.includes(status);
}
export function normalizeSettings(input, fallback = DEFAULT_SETTINGS) {
    const raw = input && typeof input === "object" ? input : {};
    const number = (value, min, max, otherwise) => {
        const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
        if (!Number.isFinite(parsed))
            return otherwise;
        return Math.min(max, Math.max(min, Math.round(parsed)));
    };
    const bool = (value, otherwise) => (typeof value === "boolean" ? value : otherwise);
    const model = (value) => {
        if (!value || typeof value !== "object")
            return null;
        const entry = value;
        if (typeof entry.providerID !== "string" || typeof entry.modelID !== "string")
            return null;
        if (!entry.providerID || !entry.modelID)
            return null;
        return {
            providerID: entry.providerID,
            modelID: entry.modelID,
            ...(typeof entry.variant === "string" && entry.variant ? { variant: entry.variant } : {}),
        };
    };
    const agent = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
    const has = (key) => Object.prototype.hasOwnProperty.call(raw, key);
    const modelField = (key, otherwise) => {
        if (!has(key))
            return otherwise;
        if (raw[key] === null)
            return null;
        return model(raw[key]) ?? otherwise;
    };
    const agentField = (key, otherwise) => {
        if (!has(key))
            return otherwise;
        if (raw[key] === null)
            return null;
        return agent(raw[key]);
    };
    const language = (value, otherwise) => value === "auto" || value === "zh-CN" || value === "en" ? value : otherwise;
    return {
        language: language(raw.language, fallback.language),
        watchdogEnabled: bool(raw.watchdogEnabled, fallback.watchdogEnabled),
        watchdogIntervalSec: number(raw.watchdogIntervalSec, 20, 3600, fallback.watchdogIntervalSec),
        stallAfterSec: number(raw.stallAfterSec, 60, 86_400, fallback.stallAfterSec),
        workerModel: modelField("workerModel", fallback.workerModel),
        watchdogModel: modelField("watchdogModel", fallback.watchdogModel),
        workerAgent: agentField("workerAgent", fallback.workerAgent),
        watchdogAgent: agentField("watchdogAgent", fallback.watchdogAgent),
        autoRecover: bool(raw.autoRecover, fallback.autoRecover),
        notifyOnEscalation: bool(raw.notifyOnEscalation, fallback.notifyOnEscalation),
        allowNestedSubagents: bool(raw.allowNestedSubagents, fallback.allowNestedSubagents),
        maxWorkers: number(raw.maxWorkers, 1, 32, fallback.maxWorkers),
        watchdogInstructions: typeof raw.watchdogInstructions === "string"
            ? truncate(raw.watchdogInstructions, 8000)
            : fallback.watchdogInstructions,
    };
}
