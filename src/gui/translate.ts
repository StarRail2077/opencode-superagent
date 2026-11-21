import type { Language } from "../shared.js"
import { en, zhCN } from "./i18n.js"

type Catalog = Record<string, string>

export function resolveLanguage(language: Language | undefined, locale: string): "zh-CN" | "en" {
  if (language === "en") return "en"
  if (language === "zh-CN") return "zh-CN"
  if (language === "auto") return locale.toLowerCase().startsWith("zh") ? "zh-CN" : "en"
  // Before stored settings load, prefer Chinese so the desktop UI is localized
  // out of the box. The settings page lets the user switch to English or Auto.
  return "zh-CN"
}

export function translate(
  language: Language | undefined,
  locale: string,
  key: string,
  params?: Record<string, string | number | boolean>,
): string {
  const fallback: Catalog = en
  const catalog: Catalog = resolveLanguage(language, locale) === "zh-CN" ? zhCN : fallback
  const template = catalog[key] ?? fallback[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    params[name] === undefined ? `{${name}}` : String(params[name]),
  )
}
