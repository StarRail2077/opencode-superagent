import { Command, ComposerPill, MenuItem, Panel, Plugin, SettingsPage, Style } from "@opencode/plugin/gui"
import { PLUGIN_ID, isActive } from "./shared.js"
import { SuperagentDashboard } from "./gui/panel.js"
import { SuperagentSettings } from "./gui/settings.js"
import { guiStore, installGuiStore } from "./gui/store.js"
import { messages } from "./gui/i18n.js"
import { translate } from "./gui/translate.js"
import style from "./gui/style.css?inline"

export default Plugin.define({
  i18n: messages,
  setup(ctx) {
    const store = installGuiStore(ctx)
    const t = (key: string, params?: Record<string, string | number | boolean>) =>
      translate(store.state()?.settings.language, ctx.locale.locale(), key, params)
    const dashboardTab = {
      id: "dashboard",
      get title() {
        return t("dashboard")
      },
      closable: "compact" as const,
      fallback: true,
    }

    ctx.add(Style, style)

    ctx.add(SettingsPage, {
      id: "superagent",
      icon: "server",
      get title() {
        return t("title")
      },
      get entries() {
        return [
          {
            id: "superagent-enter-mode",
            title: t("settings.enterMode"),
            description: t("settings.enterModeDesc"),
            keywords: "superagent mode agent 模式",
          },
          {
            id: "superagent-language",
            title: t("settings.language"),
            description: t("settings.languageDesc"),
            keywords: "language 语言",
          },
          {
            id: "superagent-watchdog",
            title: t("settings.entries.watchdog"),
            description: t("settings.entries.watchdogDesc"),
            keywords: "superagent watchdog",
          },
          {
            id: "superagent-worker-model",
            title: t("settings.entries.workerModel"),
            description: t("settings.entries.workerModelDesc"),
            keywords: "subagent model",
          },
          {
            id: "superagent-watchdog-model",
            title: t("settings.entries.watchdogModel"),
            description: t("settings.entries.watchdogModelDesc"),
            keywords: "watchdog model",
          },
          {
            id: "superagent-allow-nested",
            title: t("settings.allowNested"),
            description: t("settings.allowNestedDesc"),
            keywords: "subagent nested 嵌套",
          },
          {
            id: "superagent-interval",
            title: t("settings.entries.interval"),
            description: t("settings.entries.intervalDesc"),
          },
          {
            id: "superagent-export",
            title: t("settings.entries.export"),
            description: t("settings.entries.exportDesc"),
          },
        ]
      },
      render: () => <SuperagentSettings />,
    })

    ctx.add(Panel, {
      id: "dashboard",
      region: "side",
      width: "narrow",
      list: (input) => (input.open.includes("dashboard") ? [dashboardTab] : []),
      render: () => <SuperagentDashboard />,
    })

    ctx.add(MenuItem, () => {
      const session = ctx.sessions.current()
      return {
        menu: "session.panel" as const,
        id: "dashboard",
        title: t("dashboard"),
        icon: "status" as const,
        keybind: `${PLUGIN_ID}.dashboard`,
        description: t("panel.active", { n: store.activeTickets().length }),
        opened: Boolean(session) && ctx.layout.state(`${PLUGIN_ID}:dashboard`, session!) !== "closed",
        run: () => store.openDashboard(),
      }
    })

    ctx.add(Command, () => ({
      id: "dashboard",
      title: t("command.dashboard"),
      group: "Superagent",
      run: () => store.openDashboard(),
    }))

    ctx.add(Command, () => ({
      id: "new-mode-session",
      title: t("command.openModeSession"),
      group: "Superagent",
      run: async () => {
        await store.openModeSession()
      },
    }))

    ctx.add(Command, () => ({
      id: "enter-mode",
      title: t("command.enterMode"),
      group: "Superagent",
      enabled: Boolean(ctx.sessions.current()),
      run: async () => {
        await store.enterMode()
      },
    }))

    ctx.add(Command, () => ({
      id: "toggle",
      title: t("command.toggle"),
      group: "Superagent",
      enabled: store.state() !== null,
      run: async () => {
        const current = store.state()
        if (!current) return
        await store.update({ watchdogEnabled: !current.settings.watchdogEnabled })
      },
    }))

    ctx.add(Command, () => ({
      id: "run",
      title: t("command.run"),
      group: "Superagent",
      enabled: Boolean(store.state()?.settings.watchdogEnabled) && store.busy() === null,
      run: async () => {
        await store.runWatchdog()
      },
    }))

    ctx.add(Command, () => ({
      id: "settings",
      title: t("command.settings"),
      group: "Superagent",
      run: () => ctx.layout.settings("superagent"),
    }))

    ctx.add(ComposerPill, {
      id: "workers",
      order: 20,
      show: () => {
        const state = store.state()
        if (!state) return undefined
        const active = state.tickets.filter((ticket) => isActive(ticket.status))
        if (active.length === 0) return undefined
        return {
          label: t("panel.workerCount", { n: active.length }),
          icon: "status" as const,
          tone: state.watchdog.lastError ? ("danger" as const) : ("success" as const),
          title: "Superagent",
          rows: active.map((ticket) => ({
            id: ticket.id,
            label: ticket.title,
            detail: t(`panel.status.${ticket.status}`),
            icon: "status" as const,
            run: () => store.openTicket(ticket.sessionID),
          })),
        }
      },
    })
  },
})
