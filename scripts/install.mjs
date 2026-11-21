#!/usr/bin/env node
/**
 * Install opencode-superagent into the current user's OpenCode config.
 *
 * Usage:
 *   node scripts/install.mjs [--profile <profile.json>] [--no-config]
 *
 * The plugin is copied to:
 *   <config>/plugins/opencode-superagent
 *
 * Desktop loads this plugin from the global opencode.json(c). The script adds
 * the local plugin path to that file without removing existing entries.
 */

import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const sourceRoot = resolve(here, "..")
const args = process.argv.slice(2)

const profileIndex = args.indexOf("--profile")
const profile = profileIndex >= 0 ? args[profileIndex + 1] : undefined
const noConfig = args.includes("--no-config")

const configRoot = process.env.OPENCODE_CONFIG_DIR
  ? resolve(process.env.OPENCODE_CONFIG_DIR)
  : join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode")
const pluginsRoot = join(configRoot, "plugins")
const target = join(pluginsRoot, "opencode-superagent")

for (const required of ["dist", "package.json"]) {
  if (!existsSync(join(sourceRoot, required))) {
    fail(`Missing ${required} in ${sourceRoot}. Run "npm run build" first.`)
  }
}
if (profile && !existsSync(profile)) fail(`Profile not found: ${profile}`)

let profileObject
if (profile) {
  try {
    const raw = (await readFile(profile, "utf8")).replace(/^\uFEFF/, "")
    profileObject = JSON.parse(raw)
  } catch (error) {
    fail(`Could not read profile: ${error.message}`)
  }
  if (profileObject?.kind !== "opencode-superagent-profile" || profileObject?.version !== 1) {
    fail("Profile must be an opencode-superagent profile with version 1")
  }
}

await mkdir(pluginsRoot, { recursive: true })
if (resolve(sourceRoot) !== resolve(target)) {
  await cp(join(sourceRoot, "dist"), join(target, "dist"), { recursive: true })
  await cp(join(sourceRoot, "package.json"), join(target, "package.json"))
  if (existsSync(join(sourceRoot, "README.md"))) await cp(join(sourceRoot, "README.md"), join(target, "README.md"))
  if (existsSync(join(sourceRoot, "scripts"))) await cp(join(sourceRoot, "scripts"), join(target, "scripts"), { recursive: true })
  if (existsSync(join(sourceRoot, "agents"))) await cp(join(sourceRoot, "agents"), join(target, "agents"), { recursive: true })
  console.log(`已安装插件文件到 ${target}`)
} else {
  console.log(`插件已安装在 ${target}`)
}

const modeSource = join(sourceRoot, "agents", "superagent.md")
if (existsSync(modeSource)) {
  const modeTarget = join(configRoot, "agents", "superagent.md")
  await mkdir(dirname(modeTarget), { recursive: true })
  await cp(modeSource, modeTarget)
  console.log(`已安装 Superagent 模式到 ${modeTarget}`)
} else {
  console.warn("警告：未找到 agents/superagent.md，桌面端将无法选择 Superagent 模式。")
}

if (!noConfig) {
  const entry = "./plugins/opencode-superagent"
  const configPath = await ensureConfigEntry(entry, profileObject)
  console.log(`已更新 ${configPath}`)
}

console.log("")
console.log("后续步骤：")
console.log("  1. 重启 OpenCode Desktop（或在 设置 > 扩展 > 插件 中重新加载）。")
console.log("  2. 在 Agent 选择器中选择 Superagent，或打开 设置 > Superagent 点击「新建 Superagent 会话」。")
console.log("  3. 打开 设置 > Superagent，选择 Worker 和 Watchdog 模型。")
console.log("  4. 手动打开 Watchdog 开关；默认保持关闭。")
console.log("")
console.log("如果插件没有出现，请检查服务端日志或运行：")
console.log("  opencode plugin check")

async function ensureConfigEntry(entry, profileObject) {
  const jsonc = join(configRoot, "opencode.jsonc")
  const json = join(configRoot, "opencode.json")
  const path = existsSync(jsonc) ? jsonc : existsSync(json) ? json : jsonc
  const literal = profileObject ? entryObject(entry, profileObject) : JSON.stringify(entry)

  if (!existsSync(path)) {
    const content = `{\n  "$schema": "https://opencode.ai/config.json",\n  "plugins": [\n    ${literal}\n  ]\n}\n`
    await writeFile(path, content, "utf8")
    return path
  }

  let text = await readFile(path, "utf8")
  const backup = `${path}.bak-superagent`
  const ensureBackup = async () => {
    if (!existsSync(backup)) await writeFile(backup, text, "utf8")
  }
  const match = findTopLevelKey(text, ["plugins"])
  if (match) {
    const open = findNext(text, match.valueEnd, "[")
    const close = open >= 0 ? findMatching(text, open, "[", "]") : -1
    const inside = open >= 0 && close > open ? text.slice(open, close + 1) : ""
    if (inside.includes("opencode-superagent")) {
      if (!profileObject) return path
      const replaced = replaceEntryObject(text, entry, literal)
      if (replaced === text) {
        console.warn("警告：配置里已有 opencode-superagent，但无法嵌入 profile；请在设置页手动导入")
        return path
      }
      await ensureBackup()
      await writeFile(path, replaced, "utf8")
      return path
    }
  }

  const next = addEntry(text, literal)
  if (next === text) {
    fail(`Could not find a plugin array in ${path}. Add manually: "plugins": [${literal}]`)
  }
  await ensureBackup()
  await writeFile(path, next, "utf8")
  return path
}

function entryObject(entry, profileObject) {
  return `{ "package": ${JSON.stringify(entry)}, "options": { "profile": ${JSON.stringify(profileObject)} } }`
}

/** Replace an existing string entry or package object with the new literal. */
function replaceEntryObject(text, entry, literal) {
  const packagePattern = new RegExp(`["']package["']\\s*:\\s*${escapeRegExp(JSON.stringify(entry))}`)
  const match = packagePattern.exec(text)
  if (match) {
    const start = text.lastIndexOf("{", match.index)
    if (start >= 0) {
      const end = findMatching(text, start, "{", "}")
      if (end > start) return text.slice(0, start) + literal + text.slice(end + 1)
    }
  }
  const quoted = JSON.stringify(entry)
  const index = text.indexOf(quoted)
  if (index >= 0) return text.slice(0, index) + literal + text.slice(index + quoted.length)
  return text
}

/** Minimal JSONC-aware array insertion: preserve comments and unrelated text. */
function addEntry(text, literal) {
  const match = findTopLevelKey(text, ["plugins"])
  if (!match) {
    const brace = text.indexOf("{")
    if (brace < 0) return text
    const insert = `\n  "plugins": [\n    ${literal}\n  ],`
    return text.slice(0, brace + 1) + insert + text.slice(brace + 1)
  }

  const open = findNext(text, match.valueEnd, "[")
  if (open < 0) return text
  const close = findMatching(text, open, "[", "]")
  if (close < 0) return text

  const after = text.slice(open + 1, close)
  const hasContent = after.trim().length > 0
  const insertion = hasContent ? `\n    ${literal},` : `\n    ${literal}\n  `
  return text.slice(0, open + 1) + insertion + text.slice(open + 1)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function findTopLevelKey(text, keys) {
  let depth = 0
  let index = 0
  while (index < text.length) {
    const token = skipTrivia(text, index)
    if (token.index >= text.length) break
    index = token.index
    const char = text[index]
    if (char === "{") {
      depth++
      index++
      continue
    }
    if (char === "}") {
      depth--
      index++
      continue
    }
    if (char === '"') {
      const end = findStringEnd(text, index)
      if (end < 0) break
      const key = JSON.parse(text.slice(index, end + 1))
      let cursor = skipTrivia(text, end + 1).index
      if (depth === 1 && cursor < text.length && text[cursor] === ":" && keys.includes(key)) {
        return { valueEnd: cursor + 1 }
      }
      index = end + 1
      continue
    }
    index++
  }
  return undefined
}

function findNext(text, from, char) {
  const index = skipTrivia(text, from).index
  return index < text.length && text[index] === char ? index : -1
}

function findMatching(text, open, openChar, closeChar) {
  let depth = 0
  let index = open
  while (index < text.length) {
    const token = skipTrivia(text, index)
    index = token.index
    if (index >= text.length) break
    const char = text[index]
    if (char === openChar) depth++
    if (char === closeChar) {
      depth--
      if (depth === 0) return index
    }
    if (char === '"') {
      const end = findStringEnd(text, index)
      if (end < 0) return -1
      index = end + 1
      continue
    }
    index++
  }
  return -1
}

function findStringEnd(text, start) {
  let index = start + 1
  let escaped = false
  while (index < text.length) {
    const char = text[index]
    if (escaped) escaped = false
    else if (char === "\\") escaped = true
    else if (char === '"') return index
    index++
  }
  return -1
}

function skipTrivia(text, from) {
  let index = from
  while (index < text.length) {
    const char = text[index]
    const next = text[index + 1]
    if (char === " " || char === "\t" || char === "\r" || char === "\n") {
      index++
      continue
    }
    if (char === "/" && next === "/") {
      index += 2
      while (index < text.length && text[index] !== "\n") index++
      continue
    }
    if (char === "/" && next === "*") {
      index += 2
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index++
      index += 2
      continue
    }
    break
  }
  return { index }
}

function fail(message) {
  console.error(`error: ${message}`)
  process.exit(1)
}
