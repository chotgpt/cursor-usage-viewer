import en from "../locales/en.json";
import zh from "../locales/zh-CN.json";
export type Language = "zh-CN" | "en";
export const dictionaries = { "zh-CN": zh, en } as const;
export function initialLanguage(): Language {
  try {
    return localStorage.getItem("cursor-language") === "en" ? "en" : "zh-CN";
  } catch {
    return "zh-CN";
  }
}
