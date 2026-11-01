import { inject, ref, type InjectionKey } from "vue";
import { webClientTranslations, type Language } from "../i18n/web-client.js";

export type WebClientTranslate = (key: string, variables?: Record<string, string | number>) => string;

/** The page's translator, provided by WebClient for components rendered inside it (also through skin widgets). */
export const WEB_CLIENT_T: InjectionKey<WebClientTranslate> = Symbol("webClientT");

/**
 * The language the web client currently shows, for components mounted
 * outside it (the skin layout editor button lives at the app root).
 */
export const pageLanguage = ref<Language | null>(null);

function storedLanguage(): Language | null {
  try {
    const value = localStorage.getItem("webspeak:language");
    return value === "zh" || value === "en" || value === "de" || value === "ru" || value === "ja" ? value : null;
  } catch {
    return null;
  }
}

/** Outside the web client: the page language when known, otherwise English. */
function fallbackTranslate(key: string, variables: Record<string, string | number> = {}): string {
  const language = pageLanguage.value ?? storedLanguage() ?? "en";
  const value = webClientTranslations[language]?.[key] ?? webClientTranslations.en?.[key] ?? key;
  return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(variables[name] ?? ""));
}

export function useWebClientT(): WebClientTranslate {
  return inject(WEB_CLIENT_T, fallbackTranslate);
}
