// Tiny translation core, shared by server and client. No library: flat dictionaries, `{name}` interpolation and
// plural keys. A key ending in `_p` holds "singular|plural" and picks by `vars.n` (1 is singular).

import type { Key } from "./dictionaries";

export type Lang = "en" | "es";
export const LANGS: readonly Lang[] = ["en", "es"];
export const LANG_COOKIE = "lang";

export type Vars = Record<string, string | number>;
export type Dict = Record<string, string>;
export type Translate = (key: Key, vars?: Vars) => string;

/** Only "en" or "es" (the cookie value); anything else is no choice. */
export const toLang = (value: string | null | undefined): Lang | null =>
  value === "en" || value === "es" ? value : null;

/**
 * Language from an Accept-Language header: the first of its languages that is English or Spanish, in the browser's order,
 * so "ca-ES,ca;q=0.9,es;q=0.8" (Valencian/Catalan first) gets Spanish. Nothing of either → English.
 */
export function langFromHeader(header: string | null | undefined): Lang {
  for (const part of (header ?? "").split(",")) {
    const tag = part.split(";")[0].trim().toLowerCase();
    if (tag.startsWith("es")) return "es";
    if (tag.startsWith("en")) return "en";
  }
  return "en";
}

/** The locale for Intl in each language. */
export const LOCALE: Record<Lang, string> = { en: "en-GB", es: "es-ES" };

export function makeTranslate(dict: Dict): Translate {
  return (key, vars) => {
    let text: string | undefined = dict[key];
    if (text === undefined) return key; // a missing key shows itself instead of breaking the page
    if (key.endsWith("_p")) {
      const [one, other] = text.split("|");
      text = Number(vars?.n) === 1 ? one : (other ?? one);
    }
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
  };
}
