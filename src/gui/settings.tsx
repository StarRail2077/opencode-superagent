import { usePlugin } from "@opencode/plugin/gui"
import { For, Show, createMemo, createSignal } from "solid-js"
import { parseModelKey, type Settings } from "../shared.js"
import { guiStore, modelSelectOptions } from "./store.js"
import { translate } from "./translate.js"

const INTERVALS = [30, 60, 90, 120, 180, 300, 600]
const STALLS = [90, 120, 300, 600, 900, 1800]
const MAX_WORKERS = [1, 2, 3, 4, 6, 8, 12, 16]

export function SuperagentSettings() {
  const ctx = usePlugin()
  const store = guiStore(ctx)
  const ui = ctx.ui
  const state = () => store.state()
  const t = (key: string, params?: Record<string, string | number | boolean>) =>
    translate(state()?.settings.language, ctx.locale.locale(), key, params)
  const settings = () => state()?.settings
  const busy = () => store.busy()
  const models = createMemo(() => modelSelectOptions(state()?.models ?? [], t))
  const agents = createMemo(() => [
    { value: "", label: t("agent.default") },
    ...(state()?.agents ?? []).map((agent) => ({ value: agent.id, label: `${agent.name} (${agent.mode})` })),
  ])
  const [instructions, setInstructions] = createSignal<string | null>(null)
  const instructionsValue = () => instructions() ?? settings()?.watchdogInstructions ?? ""

  const update = (patch: Partial<Settings>) => {
    void store.update(patch)
  }

  const modelValue = (model: Settings["workerModel"]) => {
    if (!model) return ""
    return `${model.providerID}/${model.modelID}${model.variant ? `#${model.variant}` : ""}`
  }

  const chooseModel = async (kind: "worker" | "watchdog") => {
    const current = kind === "worker" ? settings()?.workerModel : settings()?.watchdogModel
    const value = await ctx.dialogs.select({
      title: t(kind === "worker" ? "model.chooseWorker" : "model.chooseWatchdog"),
      placeholder: t("model.search"),
      current: modelValue(current ?? null),
      options: models().map((option) => ({
        title: option.label,
        value: option.value,
      })),
    })
    if (value === undefined) return
    const model = parseModelKey(value)
    update(kind === "worker" ? { workerModel: model } : { watchdogModel: model })
  }

  const modelLabel = (kind: "worker" | "watchdog") => {
    const model = kind === "worker" ? settings()?.workerModel : settings()?.watchdogModel
    if (!model) return t("model.default")
    const found = state()?.models.find((entry) => modelValue(entry) === modelValue(model))
    return found ? `${found.providerName} · ${found.name}` : `${model.providerID}/${model.modelID}`
  }

  return (
    <Show when={state()} fallback={<ui.Loader size="large" />}>
      {(current) => (
        <ui.SettingsLayout
          title={t("title")}
          description={t("settings.description")}
          actions={
            <ui.Button
              variant="neutral"
              icon="settings-gear"
              onClick={() => void store.refresh()}
            >
              {t("settings.refresh")}
            </ui.Button>
          }
        >
          <ui.SettingsSection title={t("settings.mode")} footer={t("settings.modeFooter")}>
            <ui.SettingsRow
              id="superagent-enter-mode"
              title={t("settings.enterMode")}
              description={t("settings.enterModeDesc")}
            >
              <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
                <ui.Button
                  variant="contrast"
                  icon="status"
                  disabled={busy() !== null}
                  onClick={() => void store.openModeSession()}
                >
                  {t("settings.openModeSession")}
                </ui.Button>
                <ui.Button
                  variant="ghost"
                  icon="status"
                  disabled={busy() !== null}
                  onClick={() => void store.enterMode()}
                >
                  {t("settings.enterModeButton")}
                </ui.Button>
              </div>
            </ui.SettingsRow>
          </ui.SettingsSection>

          <ui.SettingsSection
            title={t("settings.control")}
            footer={
              <Show when={store.error()}>
                {(message) => <span style={{ color: "var(--color-danger, #d33)" }}>{message()}</span>}
              </Show>
            }
          >
            <ui.SettingsRow
              id="superagent-language"
              title={t("settings.language")}
              description={t("settings.languageDesc")}
            >
              <ui.Select
                label={t("settings.language")}
                options={[
                  { value: "zh-CN", label: t("language.zh") },
                  { value: "en", label: t("language.en") },
                  { value: "auto", label: t("language.auto") },
                ]}
                value={current().settings.language}
                onChange={(value) => update({ language: value as Settings["language"] })}
              />
            </ui.SettingsRow>

            <ui.SettingsRow
              id="superagent-watchdog"
              title={t("settings.watchdog")}
              description={t("settings.watchdogDesc")}
            >
              <ui.Switch
                label={t("settings.enableWatchdog")}
                hideLabel
                checked={current().settings.watchdogEnabled}
                disabled={busy() !== null}
                onChange={(enabled) => update({ watchdogEnabled: enabled })}
              />
            </ui.SettingsRow>

            <ui.SettingsRow
              id="superagent-run"
              title={t("settings.runNow")}
              description={watchdogDescription(current(), t)}
            >
              <div style={{ display: "flex", gap: "8px" }}>
                <ui.Button
                  variant="neutral"
                  icon="status"
                  busy={current().watchdog.running}
                  disabled={!current().settings.watchdogEnabled || busy() !== null}
                  onClick={() => void store.runWatchdog()}
                >
                  {t("settings.checkNow")}
                </ui.Button>
                <ui.Button variant="ghost" icon="terminal" onClick={() => void store.openWatchdog()}>
                  {t("settings.openSession")}
                </ui.Button>
              </div>
            </ui.SettingsRow>

            <ui.SettingsRow
              id="superagent-dashboard"
              title={t("settings.dashboard")}
              description={t("settings.dashboardDesc")}
            >
              <ui.Button variant="neutral" icon="status" onClick={() => store.openDashboard()}>
                {t("settings.openDashboard")}
              </ui.Button>
            </ui.SettingsRow>
          </ui.SettingsSection>

          <ui.SettingsSection
            title={t("settings.models")}
            footer={t("settings.modelsFooter")}
          >
            <ui.SettingsRow
              id="superagent-worker-model"
              title={t("settings.workerModel")}
              description={t("settings.workerModelDesc")}
            >
              <ui.Button variant="neutral" icon="models" onClick={() => void chooseModel("worker")}>
                {modelLabel("worker")}
              </ui.Button>
            </ui.SettingsRow>

            <ui.SettingsRow
              id="superagent-watchdog-model"
              title={t("settings.watchdogModel")}
              description={t("settings.watchdogModelDesc")}
            >
              <ui.Button variant="neutral" icon="models" onClick={() => void chooseModel("watchdog")}>
                {modelLabel("watchdog")}
              </ui.Button>
            </ui.SettingsRow>

            <ui.SettingsRow
              id="superagent-worker-agent"
              title={t("settings.workerAgent")}
              description={t("settings.workerAgentDesc")}
            >
              <ui.Select
                label={t("settings.workerAgent")}
                options={agents()}
                value={current().settings.workerAgent ?? ""}
                onChange={(value) => update({ workerAgent: value || null })}
              />
            </ui.SettingsRow>

            <ui.SettingsRow
              id="superagent-watchdog-agent"
              title={t("settings.watchdogAgent")}
              description={t("settings.watchdogAgentDesc")}
            >
              <ui.Select
                label={t("settings.watchdogAgent")}
                options={agents()}
                value={current().settings.watchdogAgent ?? ""}
                onChange={(value) => update({ watchdogAgent: value || null })}
              />
            </ui.SettingsRow>
          </ui.SettingsSection>

          <ui.SettingsSection title={t("settings.policy")}>
            <ui.SettingsRow
              id="superagent-interval"
              title={t("settings.interval")}
              description={t("settings.intervalDesc")}
            >
              <ui.Select
                label={t("settings.interval")}
                options={INTERVALS.map((seconds) => ({ value: String(seconds), label: labelSeconds(seconds, t) }))}
                value={String(current().settings.watchdogIntervalSec)}
                onChange={(value) => update({ watchdogIntervalSec: Number(value) })}
              />
            </ui.SettingsRow>

            <ui.SettingsRow
              id="superagent-stall"
              title={t("settings.stall")}
              description={t("settings.stallDesc")}
            >
              <ui.Select
                label={t("settings.stall")}
                options={STALLS.map((seconds) => ({ value: String(seconds), label: labelSeconds(seconds, t) }))}
                value={String(current().settings.stallAfterSec)}
                onChange={(value) => update({ stallAfterSec: Number(value) })}
              />
            </ui.SettingsRow>

            <ui.SettingsRow
              id="superagent-autorecover"
              title={t("settings.autoRecover")}
              description={t("settings.autoRecoverDesc")}
            >
              <ui.Switch
                label={t("settings.autoRecover")}
                hideLabel
                checked={current().settings.autoRecover}
                onChange={(enabled) => update({ autoRecover: enabled })}
              />
            </ui.SettingsRow>

            <ui.SettingsRow
              id="superagent-allow-nested"
              title={t("settings.allowNested")}
              description={t("settings.allowNestedDesc")}
            >
              <ui.Switch
                label={t("settings.allowNested")}
                hideLabel
                checked={current().settings.allowNestedSubagents}
                disabled={busy() !== null}
                onChange={(enabled) => update({ allowNestedSubagents: enabled })}
              />
            </ui.SettingsRow>

            <ui.SettingsRow
              id="superagent-notify"
              title={t("settings.notify")}
              description={t("settings.notifyDesc")}
            >
              <ui.Switch
                label={t("settings.notify")}
                hideLabel
                checked={current().settings.notifyOnEscalation}
                onChange={(enabled) => update({ notifyOnEscalation: enabled })}
              />
            </ui.SettingsRow>

            <ui.SettingsRow
              id="superagent-max-workers"
              title={t("settings.maxWorkers")}
              description={t("settings.maxWorkersDesc")}
            >
              <ui.Select
                label={t("settings.maxWorkers")}
                options={MAX_WORKERS.map((count) => ({ value: String(count), label: `${count}` }))}
                value={String(current().settings.maxWorkers)}
                onChange={(value) => update({ maxWorkers: Number(value) })}
              />
            </ui.SettingsRow>

            <ui.SettingsRow
              id="superagent-instructions"
              title={t("settings.instructions")}
              description={t("settings.instructionsDesc")}
            >
              <div style={{ display: "flex", gap: "6px", "align-items": "center" }}>
                <ui.TextInput
                  label={t("settings.instructions")}
                  value={instructionsValue()}
                  placeholder={t("settings.instructionsPlaceholder")}
                  onInput={setInstructions}
                  onSubmit={(value) => {
                    update({ watchdogInstructions: value })
                    setInstructions(null)
                  }}
                />
                <ui.Button
                  variant="ghost"
                  size="small"
                  onClick={() => {
                    update({ watchdogInstructions: instructionsValue() })
                    setInstructions(null)
                  }}
                >
                  {t("settings.save")}
                </ui.Button>
              </div>
            </ui.SettingsRow>
          </ui.SettingsSection>

          <ui.SettingsSection
            title={t("settings.portability")}
            footer={t("settings.portabilityFooter")}
          >
            <ui.SettingsRow
              id="superagent-export"
              title={t("settings.export")}
              description={t("settings.exportDesc")}
            >
              <ui.Button variant="neutral" icon="download" onClick={() => void store.exportProfile()}>
                {t("settings.exportButton")}
              </ui.Button>
            </ui.SettingsRow>

            <ui.SettingsRow
              id="superagent-import"
              title={t("settings.import")}
              description={t("settings.importDesc")}
            >
              <ui.Button variant="neutral" icon="cloud-upload" onClick={() => void store.importProfile()}>
                {t("settings.importButton")}
              </ui.Button>
            </ui.SettingsRow>

            <ui.SettingsRow
              id="superagent-install"
              title={t("settings.install")}
              description={t("settings.installDesc")}
            >
              <ui.Button variant="ghost" icon="copy" onClick={() => void store.copyInstall()}>
                {t("settings.copyCommand")}
              </ui.Button>
            </ui.SettingsRow>
          </ui.SettingsSection>

          <Show when={(current().attention ?? []).length > 0}>
            <ui.SettingsSection
              title={t("settings.attention")}
              footer={
                <ui.Button variant="ghost" size="small" onClick={() => void store.clearAttention(undefined, true)}>
                  {t("settings.clearAll")}
                </ui.Button>
              }
            >
              <For each={current().attention}>
                {(item) => (
                  <ui.SettingsRow
                    id={`superagent-attention-${item.id}`}
                    title={item.title}
                    description={item.message}
                  >
                    <ui.Button
                      variant="ghost"
                      size="small"
                      onClick={() => {
                        if (item.ticketID) {
                          const ticket = current().tickets.find((entry) => entry.id === item.ticketID)
                          store.openTicket(ticket?.sessionID)
                        }
                        void store.clearAttention(item.id)
                      }}
                    >
                      {t("settings.open")}
                    </ui.Button>
                  </ui.SettingsRow>
                )}
              </For>
            </ui.SettingsSection>
          </Show>

          <ui.SettingsSection title={t("settings.status")}>
            <ui.SettingsRow id="superagent-status" title={t("settings.connection")} description={statusText(current(), t)}>
              <ui.Button variant="ghost" size="small" onClick={() => void store.refresh()}>
                {t("settings.refresh")}
              </ui.Button>
            </ui.SettingsRow>
          </ui.SettingsSection>
        </ui.SettingsLayout>
      )}
    </Show>
  )
}

type Translate = (key: string, params?: Record<string, string | number | boolean>) => string

function watchdogDescription(
  state: { watchdog: { running: boolean; lastRunAt: number | null; lastError: string | null; sessionID: string | null } },
  t: Translate,
): string {
  if (state.watchdog.running) return t("settings.checking")
  if (state.watchdog.lastError) return `${t("settings.lastError")}: ${state.watchdog.lastError}`
  if (state.watchdog.lastRunAt) {
    return `${t("settings.lastCheck")}: ${new Date(state.watchdog.lastRunAt).toLocaleTimeString()}`
  }
  return state.watchdog.sessionID ? t("settings.watchdogReady") : t("settings.noCheck")
}

function statusText(
  state: {
    settings: { watchdogEnabled: boolean }
    watchdog: { running: boolean; lastRunAt: number | null }
    tickets: readonly { status: string }[]
  },
  t: Translate,
): string {
  const active = state.tickets.filter(
    (ticket) => ticket.status === "running" || ticket.status === "waiting" || ticket.status === "queued",
  ).length
  const watchdog = state.settings.watchdogEnabled ? t("status.on") : t("status.off")
  const run = state.watchdog.running
    ? t("status.checking")
    : state.watchdog.lastRunAt
      ? t("status.idle")
      : t("status.notStarted")
  return `${watchdog} · ${t("panel.active", { n: active })} · ${run}`
}

function labelSeconds(seconds: number, t: Translate): string {
  if (seconds < 60) return t("time.seconds", { n: seconds })
  const minutes = Math.round(seconds / 60)
  return minutes < 60 ? t("time.minutes", { n: minutes }) : t("time.hours", { n: Math.round(minutes / 60) })
}
