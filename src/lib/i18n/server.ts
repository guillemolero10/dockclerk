import { cache } from "react";
import { cookies, headers } from "next/headers";
import { dictionary } from "./dictionaries";
import { LANG_COOKIE, langFromHeader, makeTranslate, toLang, type Lang } from "./core";

/** The language of this request: the `lang` cookie, else the browser's Accept-Language, else English. */
export const getLang = cache(async (): Promise<Lang> => {
  const fromCookie = toLang((await cookies()).get(LANG_COOKIE)?.value);
  if (fromCookie) return fromCookie;
  return langFromHeader((await headers()).get("accept-language"));
});

/** `t` for server components, server actions and route handlers. */
export async function getT() {
  const lang = await getLang();
  return { t: makeTranslate(dictionary(lang)), lang };
}
