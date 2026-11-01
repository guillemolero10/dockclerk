// Tiny translation core, shared by server and client. No library: flat dictionaries, `{name}` interpolation and
// plural keys. A key ending in `_p` holds "singular|plural" and picks by `vars.n` (1 is singular).

import type { Key } from "./dictionaries";

export type Lang = "en" | "es";
export const LANGS: readonly Lang[] = ["en", "es"];
export const LANG_COOKIE = "lang";

export type Vars = Record<string, string | number>;
export type Dict = Record<string, string>;
export type Translate = (key: Key, vars?: Vars) => string;

/** "es", "es-ES" and "ES" are Spanish; anything else is English. */
export const toLang = (value: string | null | undefined): Lang | null =>
  value === "en" || value === "es" ? value : null;

/** First language of an Accept-Language header: Spanish if it starts with "es", otherwise English. */
export function langFromHeader(header: string | null | undefined): Lang {
  const first = (header ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("es") ? "es" : "en";
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
