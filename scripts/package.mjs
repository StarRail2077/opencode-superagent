#!/usr/bin/env node
/**
 * Build a clean source archive for a GitHub release.
 *
 * The archive intentionally excludes node_modules, local profiles, logs, and
 * release output. Prebuilt dist/ is included so users can install without
 * running the build toolchain.
 */

import { execFileSync } from "node:child_process"
import { mkdir, readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "..")
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
const out = resolve(process.argv[2] || join(root, "release", `opencode-superagent-${pkg.version}.tar.gz`))

await mkdir(dirname(out), { recursive: true })

const files = [
  ".github",
  ".gitignore",
  "agents",
  "LICENSE",
  "README.md",
  "dist",
  "examples",
  "install.cmd",
  "install.ps1",
  "install.sh",
  "package.json",
  "package-lock.json",
  "scripts",
  "src",
  "tests",
  "tsconfig.json",
  "tsconfig.server.json",
  "vite.config.ts",
]

execFileSync("tar", ["-czf", out, "-C", root, ...files], { stdio: "inherit" })
console.log(`Created ${out}`)
