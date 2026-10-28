"use server";

import { revalidatePath } from "next/cache";
import type { Message } from "@prisma/client";
import { runClerk } from "@/lib/agent";
import type { OutboundPayload, Step } from "@/lib/agent/types";
import { db } from "@/lib/db";
import { describeUnits } from "@/lib/pallets/quantity";
import { requireCustomer } from "@/lib/portal";
import { consume } from "@/lib/rate-limit";

export type AskResult = { kind: "answer" | "forwarded"; text: string; steps: Step[] };

/**
 * The portal assistant. Questions about the customer's own goods are answered at once;
 * orders and anything else go to the office queue, where a person approves them.
 * The customer id comes from the session, so the tools can only ever see this customer's data.
 */
export async function askClerk(question: string): Promise<AskResult> {
  const client = await requireCustomer();
  const body = question.trim().slice(0, 1000);
  if (!body) throw new Error("Write your question or request.");
  // Every question can call the paid model: 30 an hour per customer, answered in the chat rather than as an error.
  if (!(await consume(`portal-ask:${client.id}`, 30, 60 * 60 * 1000))) {
    return { kind: "answer", text: "Has hecho muchas consultas seguidas. Espera un rato o escribe a la oficina directamente.", steps: [] };
  }
  const fromName = `${client.contact ?? client.name} (${client.name})`;

  const preview: Message & { client: typeof client } = {
    id: "portal-preview", channel: "PORTAL", fromName, fromAddress: null, clientId: client.id, subject: null, body,
    audioUrl: null, attachmentUrl: null, receivedAt: new Date(), status: "NEW", client,
  };
  const [draft] = await runClerk(preview);

  if (draft.kind === "REPLY_ONLY") return { kind: "answer", text: draft.reply, steps: draft.steps };

  await db.message.create({ data: { channel: "PORTAL", clientId: client.id, fromName, body } });
  revalidatePath("/office", "layout");

  if (draft.kind === "CREATE_OUTBOUND") {
    const order = draft.payload as OutboundPayload;
    const what = order.lines.map((l) => `${describeUnits(l.requestedUnits, l.unitsPerPallet, l.unitWord)} de ${l.sku}`).join(" y ");
    const where = draft.doubts.some((d) => d.field === "consigneeId") ? `${order.consigneeName?.split("–")[0].trim()} (la oficina confirmará la plataforma)` : order.consigneeName;
    const when = order.deliverPhrase ? `, ${order.deliverPhrase}` : "";
    const short = order.lines.filter((l) => l.requestedUnits > l.availableUnits);
    const stockNote = short.length ? ` Ojo: de ${short.map((l) => `${l.sku} ahora hay ${describeUnits(l.availableUnits, l.unitsPerPallet, l.unitWord)}`).join(", ")}; la oficina te dirá cómo lo hacemos.` : "";
    return {
      kind: "forwarded",
      text: `Recibido. He preparado tu pedido para la oficina: ${what} para ${where}${when}.${stockNote} Te confirmamos aquí en cuanto lo aprueben.`,
      steps: draft.steps,
    };
  }
  return { kind: "forwarded", text: "Recibido. Se lo he pasado a la oficina y te contestarán por aquí lo antes posible.", steps: draft.steps };
}
