import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";

/**
 * The customer behind the portal. Its id comes only from the signed-in user's own row in the database,
 * never from the cookie, the URL or the AI, so every query below is scoped to one customer
 * whatever the browser asks for.
 */
export async function requireCustomer() {
  const session = await requireRole("customer");
  const client = session.clientId ? await db.client.findUnique({ where: { id: session.clientId } }) : null;
  if (!client) redirect("/");
  return client;
}
