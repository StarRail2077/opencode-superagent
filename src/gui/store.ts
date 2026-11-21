import { createKeyed, type SetupContext } from "@opencode/plugin/gui"
import { createSignal, onCleanup } from "solid-js"
import { translate } from "./translate.js"
import { SuperagentRpc } from "../rpc.js"
import {
  PLUGIN_ID,
  isActive,
  modelKey,
  type ModelOption,
  type PublicState,
  type SettingsPatch,
} from "../shared.js"

type RpcClient = {
  getState: (input: object) => Promise<PublicState>
  updateSettings: (input: { patch: SettingsPatch }) => Promise<PublicState>
  dispatch: (input: {
    task: string
    title?: string
    sessionID: string
    directory?: string
    source?: "desktop"
  }) => Promise<{ ticketID: string; sessionID: string }>
  collect: (input: { ticketID: string; timeoutMs?: number }) => Promise<unknown>
  cancel: (input: { ticketID: string }) => Promise<{ cancelled: boolean; state?: PublicState }>
  removeTicket: (input: { ticketID: string }) => Promise<PublicState>
  runWatchdog: (input: { force?: boolean }) => Promise<unknown>
  clearAttention: (input: { id?: string; all?: boolean }) => Promise<PublicState>
  exportProfile: (input: object) => Promise<{ filename: string; content: string }>
  importProfile: (input: { path?: string; content?: string }) => Promise<PublicState>
  openWatchdogSession: (input: object) => Promise<{ sessionID: string }>
  enterMode: (input: { sessionID: string }) => Promise<{ sessionID: string; agent: string }>
  openModeSession: (input: object) => Promise<{ sessionID: string }>
}

export type GuiStore = ReturnType<typeof createGuiStore>

const stores = new WeakMap<object, GuiStore>()

export function installGuiStore(ctx: SetupContext<any>): GuiStore {
  const store = createGuiStore(ctx)
  stores.set(ctx, store)
  return store
}

export function guiStore(ctx: object): GuiStore {
  const store = stores.get(ctx)
  if (!store) throw new Error("Superagent GUI store is not installed")
  return store
}

function createGuiStore(ctx: SetupContext<any>) {
  const [state, setState] = createSignal<PublicState | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal<string | null>(null)
  const [connected, setConnected] = createSignal(false)
  const t = (key: string, params?: Record<string, string | number | boolean>) =>
    translate(state()?.settings.language, ctx.locale.locale(), key, params)

  const rpc = (): RpcClient | undefined => {
    const client = ctx.servers.get("sidecar")?.client as any
    if (!client) return undefined
    try {
      return client.rpc(SuperagentRpc) as RpcClient
    } catch {
      return undefined
    }
  }

  const run = async <T,>(label: string, work: (client: RpcClient) => Promise<T>, options?: { quiet?: boolean }): Promise<T | undefined> => {
    const client = rpc()
    if (!client) {
      setError(t("toast.serverNotReady"))
      return undefined
    }
    setBusy(label)
    setError(null)
    try {
      const result = await work(client)
      return result
    } catch (cause) {
      const message = errorText(cause)
      setError(message)
      if (!options?.quiet) ctx.toast.show({ variant: "error", title: label, description: message })
      return undefined
    } finally {
      setBusy(null)
    }
  }

  createKeyed(
    () => ctx.servers.get("sidecar")?.client,
    (client: any) => {
      let active = true
      const rpcClient = client.rpc(SuperagentRpc) as RpcClient
      setConnected(true)
      void rpcClient
        .getState({})
        .then((next) => {
          if (active) setState(next)
        })
        .catch((cause) => {
          if (active) setError(errorText(cause))
        })

      const offState = rpcClientEvents(rpcClient, "state", (event: any) => {
        if (active && event?.data) setState(event.data as PublicState)
      })
      const offAttention = rpcClientEvents(rpcClient, "attention", (event: any) => {
        if (!active || !event?.data) return
        const current = state()
        if (!current?.settings.notifyOnEscalation) return
        const item = event.data as { title: string; message?: string; id: string; code?: string }
        void ctx.attention.notify({
          title: attentionTitle(item, t),
          message: item.message,
          id: item.id,
          variant: item.code === "worker-failed" || item.code === "watchdog-failed" ? "error" : "default",
        })
      })
      const offNotice = rpcClientEvents(rpcClient, "notice", (event: any) => {
        if (!active || !event?.data) return
        const notice = event.data as { level: string; title: string; code?: string; message?: string }
        const variant = notice.level === "error" ? "error" : notice.level === "success" ? "success" : "default"
        const titleKey = notice.code ? `notice.${notice.code}` : ""
        const translated = titleKey ? t(titleKey) : notice.title
        ctx.toast.show({
          variant,
          title: translated === titleKey ? notice.title : translated,
          description: notice.message,
          duration: 3500,
        })
      })

      onCleanup(() => {
        active = false
        setConnected(false)
        offState()
        offAttention()
        offNotice()
      })
    },
    {
      otherwise: () => {
        setConnected(false)
      },
    },
  )

  const refresh = async () => {
    const next = await run(t("toast.refresh"), (client) => client.getState({}), { quiet: true })
    if (next) setState(next)
  }

  const update = async (patch: SettingsPatch) => {
    const next = await run(t("toast.update"), (client) => client.updateSettings({ patch }))
    if (next) setState(next)
    return next
  }

  const dispatch = async (task: string, title?: string) => {
    const session = ctx.sessions.current()
    if (!session) {
      ctx.toast.show({ variant: "error", title: t("toast.dispatch"), description: t("toast.modeNeedsSession") })
      return undefined
    }
    const result = await run(t("toast.dispatch"), (client) =>
      client.dispatch({
        task,
        title,
        sessionID: session.id,
        directory: session.directory,
        source: "desktop",
      }),
    )
    if (result) {
      ctx.toast.show({
        variant: "success",
        title: t("toast.dispatched"),
        description: t("toast.ticket", { id: result.ticketID }),
      })
      await refresh()
    }
    return result
  }

  const enterMode = async () => {
    const session = ctx.sessions.current()
    if (!session) {
      ctx.toast.show({ variant: "error", title: t("toast.enterMode"), description: t("toast.modeNeedsSession") })
      return
    }
    const result = await run(t("toast.enterMode"), (client) => client.enterMode({ sessionID: session.id }))
    if (result) {
      ctx.toast.show({
        variant: "success",
        title: t("toast.enteredMode"),
        description: t("toast.enteredModeDesc"),
      })
    }
  }

  const openModeSession = async () => {
    const result = await run(t("toast.enterMode"), (client) => client.openModeSession({}))
    if (result?.sessionID) {
      ctx.tabs.open({ server: "sidecar", id: result.sessionID }, { focus: true })
      ctx.toast.show({ variant: "success", title: t("toast.openedModeSession") })
    }
  }

  const runWatchdog = async () => {
    const result = (await run(t("toast.runWatchdog"), (client) => client.runWatchdog({ force: true }), {
      quiet: true,
    })) as { ran?: boolean; reason?: string; error?: string } | undefined
    await refresh()
    if (result?.error) {
      ctx.toast.show({ variant: "error", title: t("toast.watchdogFailed"), description: result.error })
    } else if (result && result.ran === false && result.reason === "no-active-tickets") {
      ctx.toast.show({ title: "Superagent", description: t("toast.noActiveWorkers") })
    }
    return result
  }

  const cancel = async (ticketID: string) => {
    const result = await run(t("toast.cancel"), (client) => client.cancel({ ticketID }))
    if (result?.state) setState(result.state)
    else await refresh()
    if (result?.cancelled) {
      ctx.toast.show({ variant: "success", title: t("toast.cancelled"), description: ticketID })
    }
  }

  const remove = async (ticketID: string) => {
    const next = await run(t("toast.remove"), (client) => client.removeTicket({ ticketID }))
    if (next) setState(next)
  }

  const clearAttention = async (id?: string, all = false) => {
    const next = await run(t("toast.clearAttention"), (client) => client.clearAttention({ id, all }), {
      quiet: true,
    })
    if (next) setState(next)
  }

  const exportProfile = async () => {
    const profile = await run(t("toast.export"), (client) => client.exportProfile({}), { quiet: true })
    if (!profile) return
    const saved = await ctx.system.save({ name: profile.filename, content: profile.content })
    if (saved) {
      ctx.toast.show({ variant: "success", title: t("toast.exported"), description: profile.filename })
    }
  }

  const importProfile = async () => {
    const content = await pickFileText()
    if (!content) return
    const next = await run(t("toast.import"), (client) => client.importProfile({ content }))
    if (next) {
      setState(next)
      ctx.toast.show({ variant: "success", title: t("toast.imported") })
    }
  }

  const openTicket = (sessionID?: string) => {
    if (!sessionID) return
    ctx.tabs.open({ server: "sidecar", id: sessionID }, { focus: true })
  }

  const openWatchdog = async () => {
    const result = await run(t("toast.openWatchdog"), (client) => client.openWatchdogSession({}), {
      quiet: true,
    })
    if (result?.sessionID) ctx.tabs.open({ server: "sidecar", id: result.sessionID }, { focus: true })
  }

  const openDashboard = () => {
    const session = ctx.sessions.current()
    if (session) ctx.layout.toggle(`${PLUGIN_ID}:dashboard`, session)
    else ctx.layout.settings(PLUGIN_ID)
  }

  const copyInstall = async () => {
    await ctx.system.copy("node scripts/install.mjs")
    ctx.toast.show({ variant: "success", title: t("toast.installCopied") })
  }

  const activeTickets = () => (state()?.tickets ?? []).filter((ticket) => isActive(ticket.status))

  return {
    ctx,
    state,
    error,
    busy,
    connected,
    activeTickets,
    refresh,
    update,
    dispatch,
    enterMode,
    openModeSession,
    runWatchdog,
    cancel,
    remove,
    clearAttention,
    exportProfile,
    importProfile,
    openTicket,
    openWatchdog,
    openDashboard,
    copyInstall,
  }
}

function pickFileText(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = "application/json,.json"
    input.style.display = "none"
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(undefined)
        return
      }
      void file
        .text()
        .then((text) => resolve(text.replace(/^\uFEFF/, "")))
        .catch(() => resolve(undefined))
    }
    input.oncancel = () => resolve(undefined)
    document.body.appendChild(input)
    input.click()
    setTimeout(() => input.remove(), 60_000)
  })
}

function rpcClientEvents(client: RpcClient, event: string, handler: (event: any) => void): () => void {
  try {
    const events = (client as any).events
    if (events && typeof events.on === "function") return events.on(event, handler)
  } catch {
    // Older servers may not expose live RPC events; state calls still work.
  }
  return () => {}
}

export function modelSelectOptions(
  models: readonly ModelOption[],
  t: (key: string) => string,
): { value: string; label: string }[] {
  return [
    { value: "", label: t("model.default") },
    ...models.map((model) => ({
      value: modelKey(model),
      label: `${model.providerName} · ${model.name}`,
    })),
  ]
}

export function attentionTitle(
  item: { title: string; code?: string },
  t: (key: string) => string,
): string {
  if (!item.code) return item.title
  const translated = t(`attention.${item.code}`)
  return translated === `attention.${item.code}` ? item.title : translated
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>
    if (typeof record.message === "string") return record.message
    try {
      return JSON.stringify(error)
    } catch {
      return "Unknown error"
    }
  }
  return String(error)
}
