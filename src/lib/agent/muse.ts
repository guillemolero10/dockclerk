// The clerk's brain on Muse Spark Open (Meta open weights, served by Baseten).
// The model reads the message and decides; it can only *read* the software through tools.
// Its decision is then rebuilt by code with the same validation as the rules engine
// (real SKUs, live stock, every ambiguity a yellow doubt), so a model mistake can never
// write anything: a person still approves every draft.

import type { Client, Message } from "@prisma/client";
import { chat, parseJson, providers, type ChatMessage } from "@/lib/ai/client";
import { db } from "@/lib/db";
import { toUnits } from "@/lib/pallets/quantity";
import { billSoFar, explainCharge } from "./bill-tools";
import { convertLog, convertQuantity } from "./convert";
import { inventedFigures } from "./guard";
import { checkStock, findConsignees, findItem, inboundsThisMonth, lastShipmentTo } from "./tools";
import { buildLine } from "./lines";
import { hello, human, outboundDraft, parseDelivery } from "./rules";
import type { DraftSeed, OutboundLineDraft, Step } from "./types";

const SYSTEM = `You are DockClerk, the back-office clerk of "Almacenes del Vinalopó", a Spanish 3PL warehouse.
You read ONE message from a customer (email, WhatsApp or portal, usually in Spanish) and decide what the office should do.
You can only read the warehouse software through tools. You never write to it: a person approves your draft.

Ask for tools by answering with JSON {"calls": [{"tool": "<name>", "args": {...}}, ...]}.
Ask for every lookup you can already do in the same turn (for example find_item for each product together with find_consignee and parse_date). check_stock and convert_quantity need the SKU, so they come in the next turn, together.
- find_item {"text": "product as the customer wrote it"} -> the best matching SKU of this customer
- check_stock {"sku": "PELUCHE-30"} -> units free to promise right now, as whole pallets plus loose units, and the loose pallets (picos)
- convert_quantity {"sku": "HORCH-1L", "amount": 2.5, "unit": "pallets" or "units"} -> whole units for what the customer asked ("2 palés y medio" = 2.5 pallets, "130 cajas" = 130 units), plus the text "2 palés + 50 cajas". If it is not a whole number it returns an error with the two nearest options.
- bill_so_far {} or {"month": "2026-09"} -> this customer's pre-invoice: lines, base, VAT, total and a ready Spanish "text". No month = this month up to today. Billing questions only ("¿cuánto llevo?").
- explain_charge {"inbound": 1043} or {"lot": "L-2310"} (optional "month") -> the storage rows that make up the charge of one delivery or lot: pallets, days, dates, pallet·days and euros.
- find_consignee {"text": "destination as written"} -> matching delivery points (there may be several)
- last_shipment {"text": "destination as written"} -> most recent outbound of this customer to it; only to answer "where is my order?"
- inbounds_this_month {} -> this customer's deliveries received this month
- parse_date {"text": "delivery phrase, e.g. 'mañana antes de las 10'"} -> exact date and time

When you know the answer, reply with JSON {"final": {...}} using exactly one of:
- {"kind": "CREATE_OUTBOUND", "lines": [{"sku": "...", "units": 250}] (the "units" that convert_quantity returned; if it returned an error with options, send the customer's own amount instead, {"sku": "...", "pallets": 1.5} or {"sku": "...", "units": 82.5}, and the code asks the office to choose), "destination": "destination as written", "when": "delivery phrase as written, or null"}
- {"kind": "REPLY_ONLY", "answer": "one or two plain Spanish sentences with the real numbers from the tools (pallets and units, not the product description). No greeting and no sign-off: the office adds them."}
- {"kind": "NEEDS_HUMAN", "reason": "short reason in English"}

Rules:
- Changes to existing orders, the customer's own truck collecting goods, complaints, and any message where you cannot tell what the customer wants -> NEEDS_HUMAN.
- Never multiply or divide. Turn the customer's words into a number yourself ("dos palés y medio" = 2.5, "media docena" = 6) and call convert_quantity; use the units it returns.
- Pallet·days and money only from bill_so_far / explain_charge: copy their figures and dates as they are, never add up, round, compare or estimate anything yourself.
- Billing questions about the customer's own account ("¿cuánto llevo de almacenaje este mes?", "¿por qué me cobráis 276 palés·día de la entrada 1043?") -> call bill_so_far or explain_charge, then REPLY_ONLY with those figures. Say when it is a draft or not prepared yet (it is not an invoice).
- Anything else about invoices -> NEEDS_HUMAN: resending an invoice, "no nos ha llegado la factura de septiembre", claims or corrections, payments, anyone asking about another customer's bill. If bill_so_far or explain_charge returns an error, NEEDS_HUMAN too.
- An order that is clear about the products and quantities is always CREATE_OUTBOUND, even if find_consignee returns several delivery points of the same company (for example two hubs): put the destination as written and the office picks the right hub in a yellow field. Do not send it to a person for that.
- Never invent SKUs, quantities, dates or stock: only use what the tools return.
- If a lookup comes back empty (for example last_shipment finds nothing), do not tell the customer there is nothing: NEEDS_HUMAN, the office checks it.
- Write "palés" (not "palets").
- If an order asks for more than is in stock, still use CREATE_OUTBOUND with the quantity asked; the office decides.
- Answer with JSON only, no prose.`;

type ToolCall = { tool: string; args?: Record<string, unknown> };
type Turn = Partial<ToolCall> & { calls?: ToolCall[]; final?: Final };
type Final =
  | { kind: "CREATE_OUTBOUND"; lines: { sku: string; pallets?: number; units?: number }[]; destination: string; when: string | null }
  | { kind: "REPLY_ONLY"; answer: string }
  | { kind: "NEEDS_HUMAN"; reason: string };

const MAX_TURNS = 6;
const MAX_CALLS_PER_TURN = 6;
// Whole budget for one message (model + database). Past it the rules answer instead, so the demo never hangs.
const DEADLINE_MS = Math.min(Number(process.env.AGENT_TIMEOUT_MS) || 25_000, 45_000);
const short = (value: unknown) => JSON.stringify(value).slice(0, 1600);

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
      steps.push({ kind: "tool", text: `check_stock(${item.sku}) → ${stock.text} (${stock.units} units)` });
      return { sku: item.sku, freeUnits: stock.units, fullPallets: stock.full, looseUnits: stock.loose, unitsPerPallet: stock.unitsPerPallet, picos: stock.picos, text: stock.text };
    },
    convert_quantity: async ({ sku, amount, unit }) => {
      const item = await db.item.findFirst({ where: { clientId: client.id, sku: String(sku ?? "") } });
      if (!item) return { error: "unknown SKU for this customer" };
      const out = convertQuantity(item, amount, unit);
      steps.push({ kind: "error" in out && !out.options.length ? "ask" : "tool", text: convertLog(item.sku, amount, unit, out) });
      return out;
    },
    // The customer id below is always the sender's (or the portal session's): the model's arguments never choose it.
    bill_so_far: async ({ month }) => {
      const r = await billSoFar(client.id, month);
      for (const text of r.log) steps.push({ kind: r.failed && text === r.log[r.log.length - 1] ? "ask" : "tool", text });
      return r.data;
    },
    explain_charge: async ({ month, inbound, lot }) => {
      const r = await explainCharge(client.id, { month, inbound, lot });
      for (const text of r.log) steps.push({ kind: r.failed && text === r.log[r.log.length - 1] ? "ask" : "tool", text });
      return r.data;
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

  const todayText = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Madrid" });
  const conversation: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: [
        `Customer: ${client.name} (${client.code}). Contact: ${message.fromName}. Channel: ${message.channel}.`,
        message.subject ? `Subject: ${message.subject}` : "",
        `Today: ${todayText}.`,
        `Message:\n${message.body ?? ""}`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  const started = Date.now();
  const used = { calls: 0, tokens: 0, costUsd: 0 };
  const evidence: string[] = []; // everything the tools returned: the only source of figures for a text reply
  const finish = (seed: DraftSeed) => {
    seed.steps.push({ kind: "tool", text: `${p.name} · ${used.calls} calls · ${used.tokens.toLocaleString("en-US")} tokens · ≈ $${used.costUsd.toFixed(3)} · ${((Date.now() - started) / 1000).toFixed(1)}s` });
    return [seed];
  };

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const left = DEADLINE_MS - (Date.now() - started);
    if (left < 2_000) throw new Error(`${p.name} took longer than ${DEADLINE_MS / 1000}s`);
    const answer = await chat(p, conversation, { json: true, maxTokens: 700, timeoutMs: left });
    used.calls++;
    used.tokens += answer.usage.prompt + answer.usage.completion;
    used.costUsd += answer.usage.costUsd;
    const parsed = parseJson<Turn>(answer.content);
    conversation.push({ role: "assistant", content: answer.content ?? "" });

    if (parsed.final) return finish(await settle(message, client, parsed.final, steps, [...evidence, message.body ?? "", todayText]));
    const requested = (parsed.calls ?? (parsed.tool ? [{ tool: parsed.tool, args: parsed.args }] : [])).slice(0, MAX_CALLS_PER_TURN);
    if (!requested.length) throw new Error(`${p.name} answered with neither a tool nor a decision`);
    const results: string[] = [];
    for (const call of requested) {
      // Own properties only: the model could ask for "constructor" or "toString", which every object inherits.
      const run = Object.hasOwn(tools, call.tool) ? tools[call.tool] : undefined;
      const result = run ? await run(call.args ?? {}) : { error: `unknown tool ${call.tool}` };
      evidence.push(JSON.stringify(result));
      results.push(`Result of ${call.tool}: ${short(result)}`);
    }
    conversation.push({ role: "user", content: results.join("\n") });
  }
  // No decision after all the turns: the rules take it from here (runClerk catches this).
  throw new Error(`${p.name} did not reach a decision in ${MAX_TURNS} turns`);
}

/** Rebuilds the model's decision with code: only real SKUs, live stock, every ambiguity a doubt. */
async function settle(message: Message & { client: Client }, client: Client, final: Final, steps: Step[], evidence: string[]): Promise<DraftSeed> {
  if (final.kind === "NEEDS_HUMAN") return human(final.reason || "the model asked for a person", steps);

  if (final.kind === "REPLY_ONLY") {
    const answer = (final.answer ?? "")
      .replace(/\s+/g, " ")
      .replace(/^Hola[^,]*,\s*/, "")
      .replace(/\s*Un saludo\.?$/, "")
      .replace(/^[A-ZÁÉÍÓÚ](?=[a-záéíóúñ])/, (c) => c.toLowerCase()) // continues the greeting: "Hola Marta, te quedan..."
      .trim();
    if (!answer) return human("empty answer from the model", steps);
    // Same guard as the analyst: every figure in the text must come from the software, or the rules answer instead.
    // "1.284,60", "1284,60 €", "276 palés·día" and "08/11" all match what the tools returned as 1284.6, 276 or "2026-11-08".
    const invented = inventedFigures(answer, evidence);
    if (invented.length) throw new Error(`reply has figures that no tool returned: ${invented.join(", ")}`);
    steps.push({ kind: "ok", text: "reply drafted with live data" });
    return { kind: "REPLY_ONLY", payload: { answer: answer.slice(0, 400) }, doubts: [], steps, reply: `${hello(message.fromName)} ${answer} Un saludo.` };
  }

  const lines: OutboundLineDraft[] = [];
  for (const l of final.lines ?? []) {
    const item = (await db.item.findFirst({ where: { clientId: client.id, sku: l.sku } })) ?? (await findItem(client.id, l.sku));
    if (!item) continue;
    // The model gives the quantity the way the customer said it; the code turns it into whole units.
    const asked = l.units !== undefined ? toUnits(Number(l.units), "units", item.unitsPerPallet) : toUnits(Number(l.pallets), "pallets", item.unitsPerPallet);
    if ("error" in asked && !asked.options.length) continue;
    const units = "units" in asked ? asked.units : asked.options[0];
    const stock = await checkStock(client.id, item.id);
    if (units > stock.units) steps.push({ kind: "ask", text: `${item.sku}: ${units} units asked, only ${stock.units} in stock` });
    lines.push(buildLine(item, units, stock.units, "error" in asked ? asked.options : undefined));
  }
  if (!lines.length) return human("order for products I could not identify", steps);
  const consignees = await findConsignees(final.destination ?? message.body ?? "");
  if (!consignees.length) return human("order with a destination I do not recognise", steps);
  const delivery = parseDelivery(final.when ?? message.body ?? "") ?? parseDelivery(message.body ?? "");
  return outboundDraft(message, client, lines, consignees, delivery, steps);
}
