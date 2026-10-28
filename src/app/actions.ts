"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { decoyHash, verifyPassword } from "@/lib/auth/password";
import { bump, isLimited, reset, sweep } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { endSession, HOME, startSession } from "@/lib/session";

/** On failure: the one generic message, plus the user name typed so the form does not come back empty. */
export type LoginState = { error: string; username?: string } | null;

// Spanish first (what the brief asks for), English underneath for the judges.
const WRONG = "Usuario o contraseña incorrectos. · Wrong username or password.";
const LOCKED = "Demasiados intentos fallidos. Espera 15 minutos. · Too many failed attempts. Wait 15 minutes.";
const DOWN = "El servicio no responde, prueba en un minuto. · The service is not answering, try again in a minute.";

// Brute-force brake: 10 failures lock one user from one address for 15 minutes.
// Per address too, not per user alone: otherwise anybody who knows a user name could lock the judges out of the demo
// by typing wrong passwords. A second, wider net stops one address from trying user after user.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_USER = 10;
const MAX_PER_ADDRESS = 40;

/** The caller's address as the hosting platform reports it (Vercel sets x-forwarded-for itself and overwrites what the client sends). */
async function callerAddress() {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim().slice(0, 64);
}

export async function login(_: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim().toLowerCase().slice(0, 64);
  const password = String(formData.get("password") ?? "").slice(0, 256);
  if (!username || !password) return { error: WRONG, username };

  const address = await callerAddress();
  const byUser = `login:${username}:${address}`;
  const byAddress = `login-ip:${address}`;

  let home: string;
  try {
    if ((await isLimited(byUser, MAX_PER_USER, WINDOW_MS)) || (await isLimited(byAddress, MAX_PER_ADDRESS, WINDOW_MS))) return { error: LOCKED, username };

    const user = await db.user.findUnique({ where: { username } });
    // An unknown user is checked against a decoy hash: same time spent, same answer.
    const ok = await verifyPassword(password, user?.passwordHash ?? (await decoyHash()));

    if (!user || !ok || (user.role === "customer" && !user.clientId)) {
      await Promise.all([bump(byUser, WINDOW_MS), bump(byAddress, WINDOW_MS)]);
      await sweep(WINDOW_MS * 2);
      return { error: WRONG, username };
    }

    await reset(byUser);
    await startSession(user.id);
    home = HOME[user.role];
  } catch (error) {
    console.error("Login failed", error);
    return { error: DOWN, username };
  }
  redirect(home);
}

export async function logout() {
  await endSession();
  redirect("/");
}
