import assert from "node:assert/strict"
import test from "node:test"
import {
  DEFAULT_SETTINGS,
  isActive,
  modelKey,
  normalizeSettings,
  parseModelKey,
} from "../dist/shared.js"
import { buildWorkerPrompt, extractDecision } from "../dist/server/prompt.js"

test("parseModelKey round-trips provider/model and variant", () => {
  assert.deepEqual(parseModelKey("provider-a/model-x"), {
    providerID: "provider-a",
    modelID: "model-x",
  })
  assert.deepEqual(parseModelKey("provider-b/model-y#high"), {
    providerID: "provider-b",
    modelID: "model-y",
    variant: "high",
  })
  assert.equal(parseModelKey(""), null)
  assert.equal(parseModelKey("missing-slash"), null)
  assert.equal(modelKey(parseModelKey("a/b#high")), "a/b#high")
})

test("normalizeSettings clamps and keeps valid values", () => {
  const settings = normalizeSettings({
    watchdogEnabled: true,
    watchdogIntervalSec: 1,
    stallAfterSec: 999999,
    maxWorkers: 100,
    workerModel: { providerID: "provider-a", modelID: "model-x" },
    watchdogAgent: "plan",
  })
  assert.equal(settings.watchdogEnabled, true)
  assert.equal(settings.watchdogIntervalSec, 20)
  assert.equal(settings.stallAfterSec, 86_400)
  assert.equal(settings.maxWorkers, 32)
  assert.deepEqual(settings.workerModel, { providerID: "provider-a", modelID: "model-x" })
  assert.equal(settings.watchdogAgent, "plan")
  assert.equal(normalizeSettings({}).watchdogEnabled, DEFAULT_SETTINGS.watchdogEnabled)
  assert.equal(normalizeSettings({}).language, "zh-CN")
  assert.equal(normalizeSettings({ language: "en" }).language, "en")
  assert.equal(normalizeSettings({ language: "auto" }).language, "auto")
  assert.equal(normalizeSettings({ language: "bogus" }).language, "zh-CN")
  assert.equal(normalizeSettings({}).allowNestedSubagents, false)
  assert.equal(normalizeSettings({ allowNestedSubagents: true }).allowNestedSubagents, true)

  const cleared = normalizeSettings(
    { workerModel: null, watchdogModel: null, workerAgent: null, watchdogAgent: null },
    { ...DEFAULT_SETTINGS, workerModel: { providerID: "a", modelID: "b" }, workerAgent: "build" },
  )
  assert.equal(cleared.workerModel, null)
  assert.equal(cleared.watchdogModel, null)
  assert.equal(cleared.workerAgent, null)
  assert.equal(cleared.watchdogAgent, null)
})

test("isActive recognizes only queued, running, and waiting", () => {
  assert.equal(isActive("queued"), true)
  assert.equal(isActive("running"), true)
  assert.equal(isActive("waiting"), true)
  assert.equal(isActive("done"), false)
  assert.equal(isActive("failed"), false)
  assert.equal(isActive("cancelled"), false)
})

test("extractDecision accepts plain and fenced JSON", () => {
  const plain = extractDecision(
    '{"summary":"ok","workers":[{"ticketID":"t_1","assessment":"done","action":"none","reason":"complete"}]}',
    123,
  )
  assert.equal(plain.createdAt, 123)
  assert.equal(plain.workers[0].ticketID, "t_1")
  assert.equal(plain.workers[0].assessment, "done")

  const fenced = extractDecision(
    '```json\n{"workers":[{"ticketID":"t_2","assessment":"stalled","action":"nudge","reason":"no progress","message":"try smaller"}]}\n```',
  )
  assert.equal(fenced.workers[0].action, "nudge")
  assert.equal(fenced.workers[0].message, "try smaller")
})

test("extractDecision rejects malformed or empty decisions", () => {
  assert.throws(() => extractDecision("not json"))
  assert.throws(() => extractDecision('{"workers":[]}'))
  assert.throws(() => extractDecision('{"workers":[{"ticketID":"t","assessment":"unknown","action":"none"}]}'))
})

test("buildWorkerPrompt includes the ticket and task", () => {
  const prompt = buildWorkerPrompt({ ticketID: "t_1", title: "Fix tests", task: "Run the failing test." })
  assert.match(prompt, /t_1/)
  assert.match(prompt, /Fix tests/)
  assert.match(prompt, /Run the failing test/)
})
