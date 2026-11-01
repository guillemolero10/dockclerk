"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { makeTranslate, type Dict, type Lang, type Translate } from "./core";

type Value = { lang: Lang; t: Translate };
const Ctx = createContext<Value | null>(null);

/** Gives client components the language and the dictionary the server picked for this request. */
export function I18nProvider({ lang, dict, children }: { lang: Lang; dict: Dict; children: ReactNode }) {
  const value = useMemo(() => ({ lang, t: makeTranslate(dict) }), [lang, dict]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useT(): Value {
  const value = useContext(Ctx);
  if (!value) throw new Error("useT needs the I18nProvider");
  return value;
}
