// Sessions kept in the database. The cookie holds 32 random bytes and nothing else: no role, no customer id,
// nothing to edit and nothing to sign (so no secret in .env). Who the person is, what they may do and which customer
// they belong to is always read from the User row, on the server, on every request.
// The table stores only the SHA-256 of the cookie value, so a copy of the database cannot be replayed as a cookie.

import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";

export type Role = "office" | "operator" | "customer";

export type Session = {
  userId: string;
  username: string;
  name: string;
  role: Role;
  /** Set for customers only, and always taken from their User row. */
  clientId?: string;
};

const SESSION_DAYS = 7;
const production = process.env.NODE_ENV === "production";
// "__Host-" makes the browser refuse the cookie unless it is Secure, sent to this exact host and valid for the whole site.
// It needs HTTPS, so on a local http://localhost it keeps the plain name.
const COOKIE = production ? "__Host-dockclerk" : "dockclerk_session";
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/; // 32 bytes in base64url

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Where each role lands after signing in. */
export const HOME: Record<Role, string> = { office: "/office", operator: "/operator", customer: "/portal" };

/** The signed-in person, or null. Looked up once per page render. */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || !TOKEN_FORMAT.test(token)) return null;
  const row = await db.session.findUnique({
    where: { id: hashToken(token) },
    select: { expiresAt: true, user: { select: { id: true, username: true, name: true, role: true, clientId: true } } },
  });
  if (!row || row.expiresAt.getTime() <= Date.now()) return null;
  const { user } = row;
  // A customer account without a customer (the company was deleted) opens nothing.
  if (user.role === "customer" && !user.clientId) return null;
  return {
    userId: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    clientId: user.role === "customer" ? (user.clientId ?? undefined) : undefined,
  };
});

/**
 * For pages and layouts: the signed-in person if their role is one of `roles`, otherwise a redirect to "/"
 * (which sends signed-in people on to their own home, and everyone else to the login form).
 * Call it in every page that reads data: a layout alone is not enough, because layouts do not re-run on client navigation.
 */
export async function requireRole(...roles: Role[]): Promise<Session> {
  const session = await getSession();
  if (!session || !roles.includes(session.role)) redirect("/");
  return session;
}

/** For server actions and route handlers: same check, but it throws instead of redirecting. */
export async function assertRole(...roles: Role[]): Promise<Session> {
  const session = await getSession();
  if (!session || !roles.includes(session.role)) throw new Error("Not allowed.");
  return session;
}

/** Opens a session for a user who has just proved who they are. Only server actions may call it. */
export async function startSession(userId: string) {
  const jar = await cookies();
  // A new token on every login; the one this browser held before (if any) is closed.
  const previous = jar.get(COOKIE)?.value;
  if (previous && TOKEN_FORMAT.test(previous)) await db.session.deleteMany({ where: { id: hashToken(previous) } });

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.session.create({ data: { id: hashToken(token), userId, expiresAt } });
  jar.set(COOKIE, token, { httpOnly: true, secure: production, sameSite: "lax", path: "/", expires: expiresAt });

  // Housekeeping: expired sessions of anybody.
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
}

/** Closes this browser's session in the database and drops the cookie. */
export async function endSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token && TOKEN_FORMAT.test(token)) await db.session.deleteMany({ where: { id: hashToken(token) } });
  // Set with the same attributes and no lifetime: a "__Host-" cookie cannot be removed by a plain delete, which would lack Secure.
  jar.set(COOKIE, "", { httpOnly: true, secure: production, sameSite: "lax", path: "/", maxAge: 0 });
}
