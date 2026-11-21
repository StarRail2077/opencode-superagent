import { truncate } from "../shared.js";
/** OpenCode list endpoints sometimes return `{ data }` and sometimes the array directly. */
export function unwrapList(value) {
    if (Array.isArray(value))
        return value;
    if (value && typeof value === "object") {
        const data = value.data;
        if (Array.isArray(data))
            return data;
    }
    return [];
}
export function asMessages(value) {
    return unwrapList(value);
}
export function assistantTexts(messages) {
    const texts = [];
    for (const message of messages) {
        if (message.type !== "assistant" || !Array.isArray(message.content))
            continue;
        const text = message.content
            .filter((part) => part.type === "text" && typeof part.text === "string")
            .map((part) => part.text)
            .join("\n")
            .trim();
        if (text)
            texts.push(text);
    }
    return texts;
}
export function lastAssistantText(messages) {
    const texts = assistantTexts(messages);
    return texts.length > 0 ? texts[texts.length - 1] : "";
}
export function recentAssistant(messages, limit = 4) {
    return assistantTexts(messages)
        .slice(-limit)
        .map((text) => truncate(text, 2400));
}
export function recentToolNames(messages, limit = 12) {
    const names = [];
    for (const message of messages) {
        if (message.type !== "assistant" || !Array.isArray(message.content))
            continue;
        for (const part of message.content) {
            if (part.type === "tool" && typeof part.name === "string")
                names.push(part.name);
        }
    }
    return Array.from(new Set(names.slice(-limit)));
}
export function lastMessageTime(messages) {
    let latest = 0;
    for (const message of messages) {
        const time = message.time;
        if (!time)
            continue;
        const value = Math.max(time.completed ?? 0, time.streamed ?? 0, time.created ?? 0);
        if (value > latest)
            latest = value;
    }
    return latest;
}
export function messageError(messages) {
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (message.type !== "assistant" || !message.error)
            continue;
        return truncate(stringifyError(message.error), 1200);
    }
    return undefined;
}
function stringifyError(value) {
    if (typeof value === "string")
        return value;
    if (value && typeof value === "object") {
        const record = value;
        for (const key of ["message", "reason", "name", "type"]) {
            if (typeof record[key] === "string")
                return record[key];
        }
        try {
            return JSON.stringify(value);
        }
        catch {
            return "unknown error";
        }
    }
    return String(value);
}
