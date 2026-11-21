/**
 * Types and small pure helpers shared by the server part and the desktop GUI.
 *
 * Keep this file free of Node, Electron, Solid, and OpenCode runtime imports so
 * both build targets can use it.
 */

export const PLUGIN_ID = "superagent"
export const SUPERAGENT_AGENT_ID = "superagent"
export const PACKAGE_NAME = "opencode-superagent"
export const PLUGIN_VERSION = "0.1.0"

export const PROFILE_KIND = "opencode-superagent-profile"
export const PROFILE_VERSION = 1

export type ModelRef = {
  providerID: string
  modelID: string
  variant?: string
}

export type ModelOption = ModelRef & {
  name: string
  providerName: string
}

export type AgentOption = {
  id: string
  name: string
  mode: "subagent" | "primary" | "all" | string
  model?: ModelRef
}

export type TicketStatus = "queued" | "running" | "waiting" | "done" | "failed" | "cancelled"

export type Ticket = {
  id: string
  title: string
  task: string
  sessionID?: string
  status: TicketStatus
  createdAt: number
  updatedAt: number
  lastActivityAt: number
  model?: ModelRef
  agent?: string
  directory?: string
  nudges: number
  checks: number
  lastText?: string
  lastError?: string
  watchdogNote?: string
  attention?: boolean
  source?: "tool" | "command" | "desktop"
}

export type TicketView = Ticket & {
  ageMs: number
  idleMs: number
}

export type Language = "auto" | "zh-CN" | "en"

export type Settings = {
  /** Plugin UI language. Defaults to Chinese so the desktop UI is localized out of the box. */
  language: Language
  /** Master switch. The watchdog never runs while this is false, including manual runs. */
  watchdogEnabled: boolean
  /** Seconds between automatic watchdog checks. */
  watchdogIntervalSec: number
  /** A running worker with no activity for this many seconds is a stall candidate. */
  stallAfterSec: number
  /** Model for worker sessions. `null` inherits the agent/session default. */
  workerModel: ModelRef | null
  /** Model for the independent watchdog session. `null` inherits the agent/default model. */
  watchdogModel: ModelRef | null
  /** Agent preset for worker sessions. `null` uses the server default. */
  workerAgent: string | null
  /** Agent preset for the watchdog session. `null` uses the server default. */
  watchdogAgent: string | null
  /** When false, the watchdog observes and escalates but never nudges or interrupts. */
  autoRecover: boolean
  /** Ask the desktop to show a notification when the watchdog escalates. */
  notifyOnEscalation: boolean
  /** When false, worker subagents cannot launch another layer of subagents. */
  allowNestedSubagents: boolean
  /** Upper bound for live worker sessions. */
  maxWorkers: number
  /** Extra instructions appended to the watchdog system prompt. */
  watchdogInstructions: string
}

export const DEFAULT_SETTINGS: Settings = {
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
}

export const ACTIVE_STATUSES: readonly TicketStatus[] = ["queued", "running", "waiting"]

export type WatchdogAssessment =
  | "on_track"
  | "stalled"
  | "off_track"
  | "needs_input"
  | "done"
  | "failed"

export type WatchdogAction = "none" | "nudge" | "interrupt" | "escalate"

export type WatchdogWorkerDecision = {
  ticketID: string
  assessment: WatchdogAssessment
  action: WatchdogAction
  reason: string
  message?: string
}

export type WatchdogDecision = {
  workers: WatchdogWorkerDecision[]
  summary?: string
  createdAt: number
}

export type WatchdogView = {
  enabled: boolean
  running: boolean
  lastRunAt: number | null
  lastError: string | null
  nextRunAt: number | null
  sessionID: string | null
  lastDecision: WatchdogDecision | null
}

export type AttentionCode =
  | "worker-start-failed"
  | "worker-failed"
  | "worker-needs-input"
  | "worker-needs-attention"
  | "worker-stuck"
  | "nudge-failed"
  | "recover-failed"
  | "watchdog-failed"

export type AttentionItem = {
  id: string
  ticketID?: string
  code?: AttentionCode
  title: string
  message: string
  createdAt: number
  read: boolean
}

export type PublicState = {
  pluginVersion: string
  settings: Settings
  models: ModelOption[]
  agents: AgentOption[]
  tickets: TicketView[]
  watchdog: WatchdogView
  attention: AttentionItem[]
  serverDirectory: string
}

export type Profile = {
  kind: typeof PROFILE_KIND
  version: typeof PROFILE_VERSION
  exportedAt: string
  plugin: {
    package: string
    version: string
  }
  settings: Settings
}

export type DispatchInput = {
  task: string
  title?: string
  model?: ModelRef | null
  agent?: string | null
  directory?: string
  source?: "tool" | "command" | "desktop"
}

export type DispatchResult = {
  ticketID: string
  sessionID: string
  title: string
  status: TicketStatus
  model?: ModelRef
  agent?: string
}

export type CollectResult = {
  ticketID: string
  sessionID: string
  status: TicketStatus
  text: string
  idleMs: number
}

export type WatchdogRunResult = {
  ran: boolean
  reason?: string
  decision?: WatchdogDecision
  applied: number
  error?: string
}

export type SettingsPatch = Partial<Settings>

/** Format a model reference the way OpenCode configuration does. */
export function modelKey(model: ModelRef | null | undefined): string {
  if (!model) return ""
  return `${model.providerID}/${model.modelID}${model.variant ? `#${model.variant}` : ""}`
}

/** Parse `provider/model` or `provider/model#variant` into a model reference. */
export function parseModelKey(value: string | null | undefined): ModelRef | null {
  if (!value) return null
  const [left, variant] = value.split("#", 2)
  const slash = left.indexOf("/")
  if (slash <= 0 || slash === left.length - 1) return null
  return {
    providerID: left.slice(0, slash),
    modelID: left.slice(slash + 1),
    ...(variant ? { variant } : {}),
  }
}

export function sameModel(a: ModelRef | null | undefined, b: ModelRef | null | undefined): boolean {
  if (!a || !b) return a === b
  return a.providerID === b.providerID && a.modelID === b.modelID && (a.variant ?? "") === (b.variant ?? "")
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 1))}…`
}

export function isActive(status: TicketStatus): boolean {
  return ACTIVE_STATUSES.includes(status)
}

export function normalizeSettings(input: unknown, fallback: Settings = DEFAULT_SETTINGS): Settings {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {}
  const number = (value: unknown, min: number, max: number, otherwise: number) => {
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
    if (!Number.isFinite(parsed)) return otherwise
    return Math.min(max, Math.max(min, Math.round(parsed)))
  }
  const bool = (value: unknown, otherwise: boolean) => (typeof value === "boolean" ? value : otherwise)
  const model = (value: unknown): ModelRef | null => {
    if (!value || typeof value !== "object") return null
    const entry = value as Record<string, unknown>
    if (typeof entry.providerID !== "string" || typeof entry.modelID !== "string") return null
    if (!entry.providerID || !entry.modelID) return null
    return {
      providerID: entry.providerID,
      modelID: entry.modelID,
      ...(typeof entry.variant === "string" && entry.variant ? { variant: entry.variant } : {}),
    }
  }
  const agent = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value.trim() : null
  const has = (key: string) => Object.prototype.hasOwnProperty.call(raw, key)
  const modelField = (key: "workerModel" | "watchdogModel", otherwise: ModelRef | null) => {
    if (!has(key)) return otherwise
    if (raw[key] === null) return null
    return model(raw[key]) ?? otherwise
  }
  const agentField = (key: "workerAgent" | "watchdogAgent", otherwise: string | null) => {
    if (!has(key)) return otherwise
    if (raw[key] === null) return null
    return agent(raw[key])
  }

  const language = (value: unknown, otherwise: Language): Language =>
    value === "auto" || value === "zh-CN" || value === "en" ? value : otherwise

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
    watchdogInstructions:
      typeof raw.watchdogInstructions === "string"
        ? truncate(raw.watchdogInstructions, 8000)
        : fallback.watchdogInstructions,
  }
}
