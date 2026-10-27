// The clerk's brain on Muse Spark Open (Meta open weights, served by Baseten).
// The model reads the message and decides; it can only *read* the software through tools.
// Its decision is then rebuilt by code with the same validation as the rules engine
// (real SKUs, live stock, every ambiguity a yellow doubt), so a model mistake can never
// write anything: a person still approves every draft.

import type { Client, Message } from "@prisma/client";
import { chat, parseJson, providers, type ChatMessage } from "@/lib/ai/client";
import { db } from "@/lib/db";
import { checkStock, findConsignees, findItem, inboundsThisMonth, lastShipmentTo } from "./tools";
import { hello, human, outboundDraft, parseDelivery } from "./rules";
import type { DraftSeed, OutboundLineDraft, Step } from "./types";

const SYSTEM = `You are DockClerk, the back-office clerk of "Almacenes del Vinalopó", a Spanish 3PL warehouse.
You read ONE message from a customer (email, WhatsApp or portal, usually in Spanish) and decide what the office should do.
You can only read the warehouse software through tools. You never write to it: a person approves your draft.

Call one tool at a time by answering with JSON {"tool": "<name>", "args": {...}}:
- find_item {"text": "product as the customer wrote it"} -> the best matching SKU of this customer
- check_stock {"sku": "PELUCHE-30"} -> pallets and units free to promise right now
- find_consignee {"text": "destination as written"} -> matching delivery points (there may be several)
- last_shipment {"text": "destination as written"} -> most recent outbound of this customer to it
- inbounds_this_month {} -> this customer's deliveries received this month
- parse_date {"text": "delivery phrase, e.g. 'mañana antes de las 10'"} -> exact date and time

When you know the answer, reply with JSON {"final": {...}} using exactly one of:
- {"kind": "CREATE_OUTBOUND", "lines": [{"sku": "...", "pallets": 12}], "destination": "destination as written", "when": "delivery phrase as written, or null"}
- {"kind": "REPLY_ONLY", "answer": "reply in Spanish for the customer: starts with 'Hola <first name>,', gives the real numbers from the tools, ends with 'Un saludo.'"}
- {"kind": "NEEDS_HUMAN", "reason": "short reason in English"}

Rules:
- Billing, changes to existing orders, the customer's own truck collecting goods, complaints and anything unclear -> NEEDS_HUMAN.
- Never invent SKUs, quantities, dates or stock: only use what the tools return.
- If an order asks for more than is in stock, still use CREATE_OUTBOUND with the quantity asked; the office decides.
- Answer with JSON only, no prose.`;

type ToolCall = { tool: string; args?: Record<string, unknown> };
type Final =
  | { kind: "CREATE_OUTBOUND"; lines: { sku: string; pallets: number }[]; destination: string; when: string | null }
  | { kind: "REPLY_ONLY"; answer: string }
  | { kind: "NEEDS_HUMAN"; reason: string };

const MAX_TURNS = 8;
const short = (value: unknown) => JSON.stringify(value).slice(0, 900);

export async function draftWithMuse(message: Message & { client: Client }): Promise<DraftSeed[]> {
  const p = providers.agent();
  if (!p) throw new Error("Muse Spark Open is not configured");
  const client = message.client;
  const steps: Step[] = [
    { kind: "read", text: `${message.channel.toLowerCase()} · ${client.name}` },
    { kind: "tool", text: `brain → ${p.name} (${p.model})` },
  ];

  const tools: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    find_item: async ({ text }) => {
      const item = await findItem(client.id, String(text ?? ""));
      steps.push({ kind: "tool", text: `find_item("${text}") → ${item ? item.sku : "no match"}` });
      return item ? { sku: item.sku, description: item.description, unitsPerPallet: item.unitsPerPallet } : { match: null };
    },
    check_stock: async ({ sku }) => {
      const item = await db.item.findFirst({ where: { clientId: client.id, sku: String(sku ?? "") } });
      if (!item) return { error: "unknown SKU for this customer" };
      const stock = await checkStock(client.id, item.id);
      steps.push({ kind: "tool", text: `check_stock(${item.sku}) → ${stock.pallets} pallets` });
      return { sku: item.sku, pallets: stock.pallets, units: stock.units };
    },
    find_consignee: async ({ text }) => {
      const found = await findConsignees(String(text ?? ""));
      steps.push({ kind: found.length === 1 ? "tool" : "ask", text: `find_consignee("${text}") → ${found.map((c) => c.city).join(" / ") || "no match"}` });
      return found.map((c) => ({ code: c.code, name: c.name, city: c.city }));
    },
    last_shipment: async ({ text }) => {
      const found = await findConsignees(String(text ?? ""));
      const last = found.length ? await lastShipmentTo(client.id, found.map((c) => c.id)) : null;
      steps.push({ kind: "tool", text: `last_shipment → ${last ? `Nº ${last.number} · ${last.status.toLowerCase()}` : "none"}` });
      return last
        ? { number: last.number, status: last.status, date: last.date.toISOString().slice(0, 10), to: last.consignee?.name, lines: last.lines.map((l) => ({ sku: l.item.sku, pallets: l.pallets })) }
        : { shipment: null };
    },
    inbounds_this_month: async () => {
      const list = await inboundsThisMonth(client.id);
      steps.push({ kind: "tool", text: `list_inbounds(this month) → ${list.length}` });
      return list.map((i) => ({ number: i.number, date: i.date.toISOString().slice(0, 10), status: i.status, lines: i.lines.map((l) => ({ sku: l.item.sku, pallets: l.pallets })) }));
    },
    parse_date: async ({ text }) => {
      const parsed = parseDelivery(String(text ?? ""));
      return parsed ? { at: parsed.at.toISOString(), phrase: parsed.phrase } : { date: null };
    },
  };

  const conversation: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: [
        `Customer: ${client.name} (${client.code}). Contact: ${message.fromName}. Channel: ${message.channel}.`,
        message.subject ? `Subject: ${message.subject}` : "",
        `Today: ${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Madrid" })}.`,
        `Message:\n${message.body ?? ""}`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const answer = await chat(p, conversation, { json: true, maxTokens: 700 });
    const parsed = parseJson<ToolCall & { final?: Final }>(answer.content);
    conversation.push({ role: "assistant", content: answer.content ?? "" });

    if (parsed.final) return [await settle(message, client, parsed.final, steps)];
    const run = tools[parsed.tool];
    const result = run ? await run(parsed.args ?? {}) : { error: `unknown tool ${parsed.tool}` };
    conversation.push({ role: "user", content: `Result of ${parsed.tool}: ${short(result)}` });
  }
  return [human("the model did not reach a decision", steps)];
}

/** Rebuilds the model's decision with code: only real SKUs, live stock, every ambiguity a doubt. */
async function settle(message: Message & { client: Client }, client: Client, final: Final, steps: Step[]): Promise<DraftSeed> {
  if (final.kind === "NEEDS_HUMAN") return human(final.reason || "the model asked for a person", steps);

  if (final.kind === "REPLY_ONLY") {
    const reply = final.answer?.trim() || "";
    if (!reply) return human("empty answer from the model", steps);
    steps.push({ kind: "ok", text: "reply drafted with live data" });
    return { kind: "REPLY_ONLY", payload: { answer: reply.replace(/^Hola[^,]*,\s*/, "").slice(0, 200) }, doubts: [], steps, reply: reply.startsWith("Hola") ? reply : `${hello(message.fromName)} ${reply}` };
  }

  const lines: OutboundLineDraft[] = [];
  for (const l of final.lines ?? []) {
    const item = (await db.item.findFirst({ where: { clientId: client.id, sku: l.sku } })) ?? (await findItem(client.id, l.sku));
    if (!item || !(l.pallets > 0)) continue;
    const stock = await checkStock(client.id, item.id);
    if (l.pallets > stock.pallets) steps.push({ kind: "ask", text: `${item.sku}: ${l.pallets} asked, only ${stock.pallets} in stock` });
    lines.push({ itemId: item.id, sku: item.sku, description: item.description, pallets: l.pallets, requested: l.pallets, unitsPerPallet: item.unitsPerPallet, available: stock.pallets });
  }
  if (!lines.length) return human("order for products I could not identify", steps);
  const consignees = await findConsignees(final.destination ?? message.body ?? "");
  if (!consignees.length) return human("order with a destination I do not recognise", steps);
  const delivery = parseDelivery(final.when ?? message.body ?? "") ?? parseDelivery(message.body ?? "");
  return outboundDraft(message, client, lines, consignees, delivery, steps);
}
