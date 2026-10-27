import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

/**
 * The customer behind the portal. Its id comes only from the server-side session cookie,
 * so every query below is scoped to one customer whatever the browser or the AI asks for.
 */
export async function requireCustomer() {
  const session = await getSession();
  if (session?.role !== "customer" || !session.clientId) redirect("/");
  const client = await db.client.findUnique({ where: { id: session.clientId } });
  if (!client) redirect("/");
  return client;
}
