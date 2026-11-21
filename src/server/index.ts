import { Plugin } from "@opencode/plugin"
import { SuperagentRpc } from "../rpc.js"
import {
  PLUGIN_ID,
  SUPERAGENT_AGENT_ID,
  modelKey,
  normalizeSettings,
  type Settings,
  type SettingsPatch,
  type DispatchInput,
  type ModelRef,
} from "../shared.js"
import { SuperagentRuntime } from "./runtime.js"

const STORAGE_KEYS = {
  settings: "settings.v1",
  tickets: "tickets.v1",
  attention: "attention.v1",
} as const

const modelSchema = {
  type: "object",
  properties: {
    providerID: { type: "string" },
    modelID: { type: "string" },
    variant: { type: "string" },
  },
  required: ["providerID", "modelID"],
  additionalProperties: false,
} as const

function stagedProfile(options: unknown): { settings: Settings; exportedAt: string } | undefined {
  if (!options || typeof options !== "object") return undefined
  const profile = (options as Record<string, unknown>).profile
  if (!profile || typeof profile !== "object") return undefined
  const record = profile as Record<string, unknown>
  if (record.kind !== "opencode-superagent-profile") return undefined
  if (record.version !== 1) return undefined
  return {
    settings: normalizeSettings(record.settings),
    exportedAt: typeof record.exportedAt === "string" ? record.exportedAt : "",
  }
}

export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    const [storedSettings, tickets, attention, importedAt] = await Promise.all([
      ctx.storage.get(STORAGE_KEYS.settings),
      ctx.storage.get(STORAGE_KEYS.tickets),
      ctx.storage.get(STORAGE_KEYS.attention),
      ctx.storage.get("profile.importedAt"),
    ])
    // scripts/install.* can embed a profile in the plugin options. Import it once,
    // keyed by exportedAt, so a fresh machine needs no manual configuration and a
    // later migration can still replace an older profile.
    const staged = stagedProfile(ctx.options)
    const shouldImport = Boolean(staged && staged.exportedAt && staged.exportedAt !== importedAt)
    const settings = shouldImport ? staged!.settings : storedSettings

    const runtime = new SuperagentRuntime(ctx, { settings, tickets, attention })
    await runtime.start()
    if (shouldImport) await ctx.storage.set("profile.importedAt", staged!.exportedAt)

    const directoryForSession = async (sessionID?: string): Promise<string | undefined> => {
      if (!sessionID) return undefined
      try {
        const session = (await ctx.session.get({ sessionID })) as unknown as { location?: { directory?: string } }
        return session.location?.directory
      } catch {
        return undefined
      }
    }

    const assertMode = (agent: unknown): void => {
      if (String(agent ?? "") !== SUPERAGENT_AGENT_ID) {
        throw new Error(
          "Superagent tools are only available in Superagent mode. Switch this session to the Superagent agent (设置 > Superagent > 进入 Superagent 模式) and try again.",
        )
      }
    }

    const agentForSession = async (sessionID: string): Promise<string | undefined> => {
      const session = (await ctx.session.get({ sessionID })) as unknown as { agent?: string }
      return session.agent
    }

    const rpc = await ctx.rpc.register(SuperagentRpc as any, {
      getState: async () => runtime.state(),

      updateSettings: async (input) => {
        const patch = (input as { patch: SettingsPatch }).patch
        return runtime.updateSettings(patch)
      },

      dispatch: async (input) => {
        const body = input as DispatchInput & { sessionID: string }
        if (!body.sessionID) throw new Error("Open a session in Superagent mode before dispatching a worker.")
        assertMode(await agentForSession(body.sessionID))
        const { sessionID: _sessionID, ...dispatch } = body
        const result = await runtime.dispatch({ ...dispatch, source: body.source ?? "desktop" })
        return {
          ...result,
          ...(result.model ? { model: result.model } : {}),
        }
      },

      collect: async (input) => {
        const body = input as { ticketID: string; timeoutMs?: number }
        return runtime.collect(body.ticketID, body.timeoutMs)
      },

      cancel: async (input) => {
        const body = input as { ticketID: string }
        const cancelled = await runtime.cancel(body.ticketID)
        return { cancelled, state: await runtime.state() }
      },

      removeTicket: async (input) => {
        const body = input as { ticketID: string }
        runtime.removeTicket(body.ticketID)
        return runtime.state()
      },

      runWatchdog: async (input) => {
        const body = (input ?? {}) as { force?: boolean }
        return runtime.runWatchdog(body.force === true)
      },

      clearAttention: async (input) => {
        const body = (input ?? {}) as { id?: string; all?: boolean }
        runtime.clearAttention(body.id, body.all === true)
        return runtime.state()
      },

      exportProfile: async () => runtime.exportProfile(),

      importProfile: async (input) => {
        const body = (input ?? {}) as { path?: string; content?: string }
        return runtime.importProfile(body)
      },

      openWatchdogSession: async () => ({ sessionID: await runtime.openWatchdogSession() }),

      enterMode: async (input) => {
        const body = input as { sessionID: string }
        if (!body.sessionID) throw new Error("Open a session before entering Superagent mode.")
        const agent = await ctx.agent.get({ agentID: SUPERAGENT_AGENT_ID }).catch(() => undefined)
        if (!agent) {
          throw new Error(
            "Superagent mode is not installed. Reinstall the plugin with the one-click installer, then restart OpenCode Desktop.",
          )
        }
        await ctx.session.switchAgent({ sessionID: body.sessionID, agent: SUPERAGENT_AGENT_ID })
        return { sessionID: body.sessionID, agent: SUPERAGENT_AGENT_ID }
      },

      openModeSession: async () => {
        const agent = await ctx.agent.get({ agentID: SUPERAGENT_AGENT_ID }).catch(() => undefined)
        if (!agent) {
          throw new Error(
            "Superagent mode is not installed. Reinstall the plugin with the one-click installer, then restart OpenCode Desktop.",
          )
        }
        const created = await ctx.session.create({
          title: "Superagent",
          agent: SUPERAGENT_AGENT_ID,
          location: { directory: ctx.location.directory as never },
        })
        return { sessionID: created.id }
      },
    })

    runtime.setEmitters({
      state: (state) => {
        void rpc.events.emit("state", state)
      },
      attention: (item) => {
        void rpc.events.emit("attention", item)
      },
      notice: (notice) => {
        void rpc.events.emit("notice", notice)
      },
    })

    const tools = await ctx.tool.transform((editor) => {
      editor.namespace({
        name: PLUGIN_ID,
        description: "Superagent router and worker tools: delegate work, collect results, and control the watchdog.",
      })

      editor.add({
        name: "dispatch",
        description:
          "Delegate a self-contained task to a Superagent worker session. The worker has its own context and the configured subagent model, runs in the same directory, and reports back with a ticket id. Use this for substantial implementation, research, or review work instead of doing everything in the router session.",
        input: {
          type: "object",
          properties: {
            task: { type: "string", description: "Complete instructions for the worker. Be specific about scope and verification." },
            title: { type: "string", description: "Short ticket title for the dashboard." },
            model: { anyOf: [modelSchema, { type: "null" }], description: "Optional model override for this worker." },
            agent: { type: "string", description: "Optional agent preset id for this worker." },
          },
          required: ["task"],
          additionalProperties: false,
        },
        execute: async (input, context) => {
          assertMode((context as unknown as { agent?: unknown }).agent)
          const body = input as { task: string; title?: string; model?: ModelRef | null; agent?: string }
          const directory = await directoryForSession((context as unknown as { sessionID?: string }).sessionID)
          const result = await runtime.dispatch({ ...body, directory, source: "tool" })
          return {
            content: [
              `Dispatched Superagent ticket ${result.ticketID}.`,
              `Session: ${result.sessionID}`,
              `Status: ${result.status}`,
              result.model ? `Model: ${modelKey(result.model)}` : "Model: default",
              "",
              "Use superagent_collect with this ticket id to wait for the report, or superagent_status to inspect it.",
            ].join("\n"),
            metadata: result,
          }
        },
      })

      editor.add({
        name: "status",
        description: "List Superagent tickets, worker sessions, models, and watchdog state.",
        input: {
          type: "object",
          properties: {
            includeCompleted: { type: "boolean", description: "Include done, failed, and cancelled tickets." },
          },
          additionalProperties: false,
        },
        execute: async (input, context) => {
          assertMode((context as unknown as { agent?: unknown }).agent)
          const body = (input ?? {}) as { includeCompleted?: boolean }
          const state = await runtime.state()
          const tickets = body.includeCompleted
            ? state.tickets
            : state.tickets.filter((ticket) => ticket.status === "running" || ticket.status === "waiting" || ticket.status === "queued")
          const summary = {
            watchdog: state.watchdog,
            settings: {
              watchdogEnabled: state.settings.watchdogEnabled,
              workerModel: state.settings.workerModel,
              watchdogModel: state.settings.watchdogModel,
              workerAgent: state.settings.workerAgent,
              watchdogAgent: state.settings.watchdogAgent,
              intervalSec: state.settings.watchdogIntervalSec,
              stallAfterSec: state.settings.stallAfterSec,
              allowNestedSubagents: state.settings.allowNestedSubagents,
            },
            tickets: tickets.map((ticket) => ({
              ticketID: ticket.id,
              title: ticket.title,
              status: ticket.status,
              sessionID: ticket.sessionID,
              model: ticket.model,
              idleMs: ticket.idleMs,
              nudges: ticket.nudges,
              checks: ticket.checks,
              lastText: ticket.lastText?.slice(0, 500),
              lastError: ticket.lastError,
              watchdogNote: ticket.watchdogNote,
            })),
          }
          return { content: JSON.stringify(summary, null, 2) }
        },
      })

      editor.add({
        name: "collect",
        description:
          "Wait for a Superagent worker ticket to reach a turn boundary and return its latest report. Use after dispatching a task, or when the user asks for a worker's result.",
        input: {
          type: "object",
          properties: {
            ticketID: { type: "string", description: "Ticket id returned by superagent_dispatch." },
            timeoutMs: { type: "number", description: "Maximum wait in milliseconds. Defaults to 120000." },
          },
          required: ["ticketID"],
          additionalProperties: false,
        },
        execute: async (input, context) => {
          assertMode((context as unknown as { agent?: unknown }).agent)
          const body = input as { ticketID: string; timeoutMs?: number }
          const result = await runtime.collect(body.ticketID, body.timeoutMs)
          return {
            content: [
              `Ticket ${result.ticketID} · ${result.status}`,
              `Session: ${result.sessionID}`,
              `Idle: ${Math.round(result.idleMs / 1000)}s`,
              "",
              result.text || "(the worker has not produced a report yet)",
            ].join("\n"),
            metadata: result,
          }
        },
      })

      editor.add({
        name: "cancel",
        description: "Interrupt and cancel a Superagent worker ticket.",
        input: {
          type: "object",
          properties: { ticketID: { type: "string" } },
          required: ["ticketID"],
          additionalProperties: false,
        },
        execute: async (input, context) => {
          assertMode((context as unknown as { agent?: unknown }).agent)
          const body = input as { ticketID: string }
          const cancelled = await runtime.cancel(body.ticketID)
          return { content: cancelled ? `Cancelled ticket ${body.ticketID}.` : `Ticket ${body.ticketID} was not cancelled.` }
        },
      })

      editor.add({
        name: "watchdog",
        description:
          "Control the independent Watchdog. Actions: status, enable, disable, run, settings. The watchdog only runs while enabled; run forces one check now.",
        input: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["status", "enable", "disable", "run", "settings"] },
            intervalSec: { type: "number" },
            stallAfterSec: { type: "number" },
            autoRecover: { type: "boolean" },
            watchdogModel: { anyOf: [modelSchema, { type: "null" }] },
            watchdogAgent: { type: "string" },
            watchdogInstructions: { type: "string" },
          },
          required: ["action"],
          additionalProperties: false,
        },
        execute: async (input, context) => {
          assertMode((context as unknown as { agent?: unknown }).agent)
          const body = input as {
            action: "status" | "enable" | "disable" | "run" | "settings"
            intervalSec?: number
            stallAfterSec?: number
            autoRecover?: boolean
            watchdogModel?: ModelRef | null
            watchdogAgent?: string
            watchdogInstructions?: string
          }
          if (body.action === "enable" || body.action === "disable") {
            await runtime.updateSettings({ watchdogEnabled: body.action === "enable" })
            return { content: `Watchdog ${body.action === "enable" ? "enabled" : "disabled"}.` }
          }
          if (body.action === "run") {
            const result = await runtime.runWatchdog(true)
            return { content: JSON.stringify(result, null, 2) }
          }
          if (body.action === "settings") {
            const patch: SettingsPatch = {}
            if (typeof body.intervalSec === "number") patch.watchdogIntervalSec = body.intervalSec
            if (typeof body.stallAfterSec === "number") patch.stallAfterSec = body.stallAfterSec
            if (typeof body.autoRecover === "boolean") patch.autoRecover = body.autoRecover
            if (body.watchdogModel !== undefined) patch.watchdogModel = body.watchdogModel
            if (body.watchdogAgent !== undefined) patch.watchdogAgent = body.watchdogAgent
            if (typeof body.watchdogInstructions === "string") patch.watchdogInstructions = body.watchdogInstructions
            const state = await runtime.updateSettings(patch)
            return { content: JSON.stringify({ settings: state.settings, watchdog: state.watchdog }, null, 2) }
          }
          const state = await runtime.state()
          return { content: JSON.stringify({ settings: state.settings, watchdog: state.watchdog }, null, 2) }
        },
      })

      editor.add({
        name: "open_watchdog",
        description: "Return the Watchdog session id so it can be opened in the desktop app.",
        input: { type: "object", properties: {}, additionalProperties: false },
        execute: async (_input, context) => {
          assertMode((context as unknown as { agent?: unknown }).agent)
          const sessionID = await runtime.openWatchdogSession()
          return { content: `Watchdog session: ${sessionID}`, metadata: { sessionID } }
        },
      })
    })

    const commands = await ctx.command.transform((editor) => {
      editor.add({
        name: "superagent",
        description: "Dispatch the rest of the message to a Superagent worker",
        execute: async ({ sessionID, prompt, delivery }) => {
          if ((await agentForSession(sessionID)) !== SUPERAGENT_AGENT_ID) {
            await ctx.session.prompt({
              sessionID,
              text: [
                "请先进入 Superagent 模式，再使用 /superagent。",
                "",
                "方式一：在 设置 > Superagent 点击「进入 Superagent 模式」。",
                "方式二：在桌面端的 Agent 选择器中选择「Superagent」。",
                "",
                "只有 Superagent 模式可以调用 superagent 工具和派发 Worker。",
              ].join("\n"),
              delivery,
            })
            return
          }
          const text = prompt.text.trim()
          if (!text) {
            await ctx.session.prompt({ sessionID, text: "Usage: /superagent <task>", delivery })
            return
          }
          const result = await runtime.dispatch({
            task: text,
            directory: await directoryForSession(sessionID),
            source: "command",
          })
          await ctx.session.prompt({
            sessionID,
            text: [
              `Dispatched ticket ${result.ticketID} to a Superagent worker.`,
              `Worker session: ${result.sessionID}`,
              `Model: ${result.model ? modelKey(result.model) : "default"}`,
              "",
              "The worker runs independently. Use the Superagent dashboard to watch it, or ask me to collect its report.",
            ].join("\n"),
            delivery,
          })
        },
      })
    })

    return async () => {
      await runtime.dispose()
      await tools.dispose()
      await commands.dispose()
    }
  },
})
