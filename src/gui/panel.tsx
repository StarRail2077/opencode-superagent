import { usePlugin } from "@opencode/plugin/gui"
import { For, Show, createSignal } from "solid-js"
import { isActive, modelKey, type TicketView } from "../shared.js"
import { attentionTitle, guiStore } from "./store.js"
import { translate } from "./translate.js"

export function SuperagentDashboard() {
  const ctx = usePlugin()
  const store = guiStore(ctx)
  const ui = ctx.ui
  const state = () => store.state()
  const t = (key: string, params?: Record<string, string | number | boolean>) =>
    translate(state()?.settings.language, ctx.locale.locale(), key, params)
  const [task, setTask] = createSignal("")
  const [title, setTitle] = createSignal("")

  const submit = async () => {
    const text = task().trim()
    if (!text) return
    const result = await store.dispatch(text, title().trim() || undefined)
    if (result) {
      setTask("")
      setTitle("")
    }
  }

  return (
    <div class="sa-root">
      <div class="sa-header">
        <div class="sa-title-row">
          <div>
            <div class="sa-title">Superagent</div>
            <div class="sa-subtitle">{statusLine(state(), t)}</div>
          </div>
          <ui.Switch
            label="Watchdog"
            hideLabel
            checked={state()?.settings.watchdogEnabled ?? false}
            disabled={store.busy() !== null}
            onChange={(enabled) => void store.update({ watchdogEnabled: enabled })}
          />
        </div>
        <div class="sa-actions">
          <ui.Button
            variant="ghost"
            size="small"
            icon="status"
            disabled={store.busy() !== null}
            onClick={() => void store.enterMode()}
          >
            {t("panel.enterMode")}
          </ui.Button>
          <ui.Button
            variant="neutral"
            size="small"
            icon="status"
            busy={state()?.watchdog.running ?? false}
            disabled={!state()?.settings.watchdogEnabled || store.busy() !== null}
            onClick={() => void store.runWatchdog()}
          >
            {t("settings.checkNow")}
          </ui.Button>
          <ui.Button variant="ghost" size="small" icon="terminal" onClick={() => void store.openWatchdog()}>
            Watchdog
          </ui.Button>
          <ui.Button variant="ghost" size="small" icon="settings-gear" onClick={() => ctx.layout.settings("superagent")}>
            {t("settings.settingsButton")}
          </ui.Button>
        </div>
      </div>

      <Show when={store.error()}>
        {(message) => <div class="sa-error">{message()}</div>}
      </Show>

      <div class="sa-dispatch">
        <div class="sa-dispatch-title">{t("panel.dispatchTitle")}</div>
        <ui.TextInput
          label={t("panel.taskTitle")}
          value={title()}
          placeholder={t("panel.taskTitlePlaceholder")}
          onInput={setTitle}
          onSubmit={() => void submit()}
        />
        <textarea
          class="sa-textarea"
          aria-label={t("panel.dispatchTitle")}
          placeholder={t("panel.taskPlaceholder")}
          value={task()}
          onInput={(event) => setTask(event.currentTarget.value)}
        />
        <div class="sa-dispatch-footer">
          <span class="sa-hint">
            {state()?.settings.workerModel
              ? `${t("panel.model")}: ${modelKey(state()?.settings.workerModel)}`
              : `${t("panel.model")}: ${t("model.default")}`}
          </span>
          <ui.Button
            variant="contrast"
            size="small"
            icon="arrow-up"
            disabled={!task().trim() || store.busy() !== null}
            onClick={() => void submit()}
          >
            {t("panel.dispatch")}
          </ui.Button>
        </div>
      </div>

      <div class="sa-section">
        <div class="sa-section-title">
          {t("panel.workers")}
          <span class="sa-count">{state()?.tickets.length ?? 0}</span>
        </div>
        <Show
          when={(state()?.tickets.length ?? 0) > 0}
          fallback={<div class="sa-empty">{t("panel.noTickets")}</div>}
        >
          <div class="sa-list">
            <For each={state()?.tickets ?? []}>{(ticket) => <TicketCard ticket={ticket} />}</For>
          </div>
        </Show>
      </div>

      <Show when={(state()?.attention.length ?? 0) > 0}>
        <div class="sa-section">
          <div class="sa-section-title">
            {t("panel.needsAttention")}
            <ui.Button variant="ghost" size="small" onClick={() => void store.clearAttention(undefined, true)}>
              {t("panel.clear")}
            </ui.Button>
          </div>
          <div class="sa-list">
            <For each={state()?.attention ?? []}>
              {(item) => (
                <div class="sa-attention">
                  <div class="sa-attention-title">{attentionTitle(item, t)}</div>
                  <div class="sa-attention-message">{item.message}</div>
                  <div class="sa-ticket-actions">
                    <Show when={item.ticketID}>
                      {(ticketID) => {
                        const ticket = () => state()?.tickets.find((entry) => entry.id === ticketID())
                        return (
                          <ui.Button
                            variant="ghost"
                            size="small"
                            onClick={() => store.openTicket(ticket()?.sessionID)}
                            disabled={!ticket()?.sessionID}
                          >
                            {t("panel.openWorker")}
                          </ui.Button>
                        )
                      }}
                    </Show>
                    <ui.Button variant="ghost" size="small" onClick={() => void store.clearAttention(item.id)}>
                      {t("panel.dismiss")}
                    </ui.Button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      <div class="sa-footer">
        <span>
          {state()?.watchdog.lastError
            ? `${t("panel.watchdogError")}: ${state()?.watchdog.lastError}`
            : t("panel.independent")}
        </span>
        <span>
          {state()?.watchdog.lastRunAt
            ? new Date(state()!.watchdog.lastRunAt!).toLocaleTimeString()
            : t("panel.neverChecked")}
        </span>
      </div>
    </div>
  )
}

function TicketCard(props: { ticket: TicketView }) {
  const ctx = usePlugin()
  const store = guiStore(ctx)
  const ui = ctx.ui
  const t = (key: string, params?: Record<string, string | number | boolean>) =>
    translate(store.state()?.settings.language, ctx.locale.locale(), key, params)
  const ticket = () => props.ticket
  const active = () => isActive(ticket().status)

  return (
    <div class={`sa-ticket sa-status-${ticket().status}`}>
      <div class="sa-ticket-head">
        <div class="sa-ticket-title" title={ticket().title}>{ticket().title}</div>
        <span class={`sa-badge sa-badge-${ticket().status}`}>{statusLabel(ticket().status, t)}</span>
      </div>
      <div class="sa-ticket-meta">
        <span>{ticket().id}</span>
        <span>·</span>
        <span>{ticket().model ? modelKey(ticket().model) : t("panel.ticket.defaultModel")}</span>
        <span>·</span>
        <span>{idle(ticket().idleMs, t)}</span>
        <Show when={ticket().nudges > 0}>
          <span>· {t("panel.ticket.nudges", { n: ticket().nudges })}</span>
        </Show>
      </div>
      <Show when={ticket().lastText}>
        {(text) => <div class="sa-ticket-text">{excerpt(text())}</div>}
      </Show>
      <Show when={ticket().watchdogNote}>
        {(note) => <div class="sa-ticket-note">{t("panel.ticket.watchdog")}: {note()}</div>}
      </Show>
      <Show when={ticket().lastError}>
        {(message) => <div class="sa-error">{message()}</div>}
      </Show>
      <div class="sa-ticket-actions">
        <Show when={ticket().sessionID}>
          {(sessionID) => (
            <ui.Button variant="ghost" size="small" icon="terminal" onClick={() => store.openTicket(sessionID())}>
              {t("panel.ticket.open")}
            </ui.Button>
          )}
        </Show>
        <Show when={active()}>
          <ui.Button
            variant="ghost"
            size="small"
            icon="circle-x"
            onClick={() => void store.cancel(ticket().id)}
          >
            {t("panel.ticket.cancel")}
          </ui.Button>
        </Show>
        <Show when={!active()}>
          <ui.Button variant="ghost" size="small" icon="trash" onClick={() => void store.remove(ticket().id)}>
            {t("panel.ticket.remove")}
          </ui.Button>
        </Show>
      </div>
    </div>
  )
}

type Translate = (key: string, params?: Record<string, string | number | boolean>) => string

function statusLine(state: ReturnType<ReturnType<typeof guiStore>["state"]>, t: Translate): string {
  if (!state) return t("panel.connecting")
  const active = state.tickets.filter((ticket) => isActive(ticket.status)).length
  const watchdog = state.settings.watchdogEnabled
    ? state.watchdog.running
      ? t("status.checking")
      : t("status.on")
    : t("status.off")
  return `${t("panel.active", { n: active })} · ${t("panel.watchdogState", { state: watchdog })}`
}

function statusLabel(status: string, t: Translate): string {
  const key = `panel.status.${status}`
  const translated = t(key)
  return translated === key ? status : translated
}

function idle(ms: number, t: Translate): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return t("panel.idle.seconds", { n: seconds })
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return t("panel.idle.minutes", { n: minutes })
  return t("panel.idle.hours", { n: Math.round(minutes / 60) })
}

function excerpt(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim()
  return clean.length > 220 ? `${clean.slice(0, 219)}…` : clean
}
