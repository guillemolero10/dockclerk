"use server";

import { cookies } from "next/headers";
import { LANG_COOKIE, toLang } from "./core";

/** Remembers the chosen language for a year. The page re-renders in it. */
export async function setLang(lang: string) {
  const value = toLang(lang);
  if (!value) return;
  (await cookies()).set(LANG_COOKIE, value, { maxAge: 365 * 24 * 60 * 60, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
}
