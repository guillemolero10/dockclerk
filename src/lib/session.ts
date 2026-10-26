import { cookies } from "next/headers";

// Demo-only role switcher: there is no real login in the hackathon build.
// The customer's clientId always comes from this server-side cookie, never from the AI or the URL.
export type Role = "office" | "operator" | "customer";

export type Session = { role: Role; clientId?: string };

const COOKIE = "dockclerk_session";

export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export async function setSession(session: Session) {
  (await cookies()).set(COOKIE, JSON.stringify(session), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
}
