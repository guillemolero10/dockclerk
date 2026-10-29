// Plan B clerk: a rules engine for Spanish customer messages.
// It returns the same DraftSeed contract Muse Spark will return, so the approval queue does not care
// which one ran. It also backs the live demo if the model is slow or unavailable.
import type { Client, Message } from "@prisma/client";
import { ymdOf } from "@/lib/billing/calendar";
import { db } from "@/lib/db";
import { madridDayRange } from "@/lib/format";
import { billingIntent } from "./bill-format";
import { billSoFar, explainCharge } from "./bill-tools";
import { checkStock, findConsignees, findItem, inboundsThisMonth, lastShipmentTo, norm } from "./tools";
import { describeUnits, scanQuantities, toUnits, unitWordFor } from "@/lib/pallets/quantity";
import { buildLine, withUnits } from "./lines";
import { tradeName } from "./words";
import { convertLog, convertQuantity } from "./convert";
import type { Doubt, DraftSeed, OutboundLineDraft, OutboundPayload, Step } from "./types";

const HOUR = 60 * 60 * 1000;
const WEEKDAYS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

/** "Marta Pérez (Juguetes Levante)" → "Marta". Company-only senders get no name. */
function firstName(fromName: string) {
  return fromName.includes("(") ? fromName.split(/[ (]/)[0] : null;
}

export function hello(fromName: string) {
  const name = firstName(fromName);
  return name ? `Hola ${name},` : "Hola,";
}

/** When the customer wants it: "mañana antes de las 10", "el jueves", "a primera hora"... */
export function parseDelivery(text: string): { at: Date; phrase: string } | null {
  const t = norm(text);
  const morning = t.includes("por la manana");
  const plain = t.replace(/por la manana/g, "");
  let days: number | null = null;
  if (plain.includes("pasado manana")) days = 2;
  else if (/\bmanana\b/.test(plain)) days = 1;
  else if (t.includes("semana que viene")) days = 7;
  else {
    const wd = WEEKDAYS.findIndex((d) => new RegExp(`\\b${d}\\b`).test(t));
    if (wd >= 0) {
      const ymd = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });
      const todayWd = new Date(`${ymd}T12:00:00Z`).getUTCDay();
      days = ((wd - todayWd + 7) % 7) || 7;
    }
  }
  if (days === null) return null;

  const before = t.match(/antes de las (\d{1,2})/);
  const [hour, phrase] = before
    ? [Number(before[1]), `antes de las ${before[1].padStart(2, "0")}:00`]
    : t.includes("primera hora")
      ? [8, "a primera hora"]
      : morning
        ? [10, "por la mañana"]
        : [12, ""];
  const dayStart = madridDayRange(new Date(madridDayRange().start.getTime() + days * 24 * HOUR + 12 * HOUR)).start;
  return { at: new Date(dayStart.getTime() + hour * HOUR), phrase };
}

function deliveryText(payload: OutboundPayload) {
  if (!payload.deliverBy) return "";
  const day = new Date(payload.deliverBy)
    .toLocaleDateString("es-ES", { weekday: "long", day: "numeric", timeZone: "Europe/Madrid" })
    .replace(",", "");
  return `el ${day}${payload.deliverPhrase ? `, ${payload.deliverPhrase}` : ""}`;
}

/** Customer-facing confirmation, rebuilt on approval in case the office changed destination or quantities. */
export function orderReply(payload: OutboundPayload, fromName: string) {
  const what = payload.lines
    .map((l) => (l.units < l.requestedUnits
      ? `${l.text} de ${l.sku} (de los ${describeUnits(l.requestedUnits, l.unitsPerPallet, l.unitWord)} pedidos, es lo que tenéis en stock; el resto queda pendiente)`
      : `${l.text} de ${l.sku}`))
    .join(" y ");
  const when = payload.deliverBy ? `, entrega ${deliveryText(payload)}` : "";
  return `${hello(fromName)} confirmado: ${what} para ${payload.consigneeName ?? "el destino indicado"}${when}. Un saludo, Almacenes del Vinalopó.`;
}

/** "12 palés de PELUCHE-30", "2,5 palés de X", "130 cajas de Y", "4 de horchata" → quantity + product fragment. */
function quantitySegments(text: string) {
  const t = norm(text).replace(/litro y medio/g, "1,5").replace(/\bref\.\s*/g, "");
  const found: { amount: number; unit: "pallets" | "units"; fragment: string }[] = [];
  for (const q of scanQuantities(t)) {
    const m = /^\s+de\s+(.+?)(?=\s+(?:para|a|y|del pedido)\s|[,.;!?]|$)/.exec(t.slice(q.end));
    if (m && q.amount > 0) found.push({ amount: q.amount, unit: q.unit, fragment: m[1] });
  }
  return found;
}

/** Units for a quantity of an item: whole units, or the two nearest whole numbers when it does not fit. */
function unitsOf(q: { amount: number; unit: "pallets" | "units" }, perPallet: number) {
  const r = toUnits(q.amount, q.unit, perPallet);
  if ("units" in r) return { units: r.units, options: undefined };
  return { units: r.options[0], options: r.options };
}

function channelLabel(m: Message) {
  return m.channel === "EMAIL" ? "email" : m.channel === "WHATSAPP" ? "WhatsApp" : m.channel === "FLOOR" ? "voice note from the floor" : "portal request";
}

export function human(reason: string, steps: Step[]): DraftSeed {
  return { kind: "NEEDS_HUMAN", payload: { reason }, doubts: [], steps: [...steps, { kind: "ask", text: `needs you · ${reason}` }], reply: null };
}

export async function draftMessage(message: Message & { client: Client | null }): Promise<DraftSeed[]> {
  const body = message.body ?? "";
  const t = norm(body);
  const steps: Step[] = [{ kind: "read", text: `${channelLabel(message)} · ${message.client?.name ?? message.fromName}` }];

  // 1. Messages the clerk should not act on alone.
  if (message.channel === "FLOOR") {
    steps.push({ kind: "tool", text: "classify → incident reported on the warehouse floor" });
    return [human("note from the warehouse floor, check it with the operator", steps)];
  }
  if (!message.client) {
    const sales = /tarifa|oferta|presentamos/.test(t);
    steps.push({ kind: "tool", text: `find_customer("${message.fromName}") → no match` });
    return [human(sales ? "sales email from a supplier, no action needed" : "unknown sender, not a customer in the software", steps)];
  }
  const client = message.client;
  // Questions about the customer's own bill that code can answer; claims, resends and payments go to a person.
  const intent = billingIntent(body, ymdOf(new Date()));
  if (intent?.kind === "human") {
    steps.push({ kind: "tool", text: "classify → invoice claim, resend or payment" });
    return [human("invoice claim, resend or payment, outside the warehouse software", steps)];
  }
  if (intent) {
    // Only ever the sender's own bill: a question that names another customer goes to a person.
    const others = await db.client.findMany({ where: { id: { not: client.id } }, select: { name: true } });
    if (others.some((o) => t.includes(tradeName(o.name)))) {
      steps.push({ kind: "tool", text: "classify → billing question about another customer" });
      return [human("asks about another customer's bill, a person must answer", steps)];
    }
    steps.push({ kind: "tool", text: `classify → billing question (${intent.kind === "amount" ? "bill so far" : "explain a charge"})` });
    const r = intent.kind === "amount" ? await billSoFar(client.id, intent.month) : await explainCharge(client.id, intent);
    for (const text of r.log) steps.push({ kind: "tool", text });
    if (r.failed) return [human(String(r.data.error ?? "could not read the bill"), steps)];
    const text = String(r.data.text);
    const provisional = r.data.status !== "approved" ? " Es una prefactura en borrador, no una factura." : "";
    steps.push({ kind: "ok", text: "reply drafted with the bill figures" });
    return [{
      kind: "REPLY_ONLY", payload: { answer: text }, doubts: [], steps,
      reply: `${hello(message.fromName)} ${text.charAt(0).toLowerCase()}${text.slice(1)}${provisional} Un saludo.`,
    }];
  }
  if (t.includes("factura")) {
    steps.push({ kind: "tool", text: "classify → billing question" });
    return [human("billing question, outside the warehouse software", steps)];
  }
  if (/en vez de|cambio de pedido|cambiar el pedido/.test(t)) {
    steps.push({ kind: "tool", text: "classify → change to an existing order" });
    return [human("asks to change an existing order, edit it in the software", steps)];
  }
  if (/recoger|matricula/.test(t)) {
    steps.push({ kind: "tool", text: "classify → customer's own truck collecting goods" });
    return [human("customer truck pickup, book a dock slot", steps)];
  }

  // 2. Shipment status.
  if (/ha salido|ya salio|donde esta/.test(t)) {
    steps.push({ kind: "tool", text: "classify → shipment status" });
    const consignees = await findConsignees(body);
    steps.push({ kind: "tool", text: `find_consignee → ${consignees.map((c) => c.code).join(", ") || "none"}` });
    const last = consignees.length ? await lastShipmentTo(client.id, consignees.map((c) => c.id)) : null;
    if (!last) return [human("no recent shipment to that destination, check before answering", steps)];
    const state = last.status === "SHIPPED" || last.status === "CLOSED" ? "salió" : "todavía no ha salido; sale";
    const date = last.date.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", timeZone: "Europe/Madrid" });
    const what = last.lines.map((l) => `${describeUnits(l.units, l.item.unitsPerPallet, unitWordFor(l.item.unit))} de ${l.item.sku}`).join(" y ");
    steps.push({ kind: "tool", text: `last_shipment → Nº ${last.number} · ${last.status.toLowerCase()} · ${date}` });
    steps.push({ kind: "ok", text: "reply drafted" });
    return [{
      kind: "REPLY_ONLY", payload: { answer: `Nº ${last.number}: ${what}, ${state} el ${date}` }, doubts: [], steps,
      reply: `${hello(message.fromName)} el pedido Nº ${last.number} para ${last.consignee?.name} (${what}) ${state} el ${date}. Un saludo.`,
    }];
  }

  // 3. Inbounds this month.
  if (t.includes("entradas") && t.includes("mes")) {
    steps.push({ kind: "tool", text: "classify → inbound history" });
    const list = await inboundsThisMonth(client.id);
    steps.push({ kind: "tool", text: `list_inbounds(this month) → ${list.length}` });
    steps.push({ kind: "ok", text: "reply drafted" });
    const lines = list.map((i) => `${i.date.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", timeZone: "Europe/Madrid" }).padStart(5, "0")} ${i.lines.map((l) => `${l.item.sku} (${l.pallets} palés)`).join(", ") || "prevista"}`);
    return [{
      kind: "REPLY_ONLY", payload: { answer: `${list.length} inbounds this month` }, doubts: [], steps,
      reply: `${hello(message.fromName)} este mes habéis tenido ${list.length} entradas: ${lines.join("; ")}. Un saludo.`,
    }];
  }

  const segments = quantitySegments(body);

  // 4. Stock questions, with or without quantities ("¿tenéis suficiente stock?").
  if (/cuant[oa]s?\b.*\b(queda|quedan|hay)\b|suficiente stock/.test(t)) {
    steps.push({ kind: "tool", text: "classify → stock question" });
    const asked = segments.length
      ? segments
      : t.split(/\?|\by\b/).map((fragment) => ({ amount: 0, unit: "pallets" as const, fragment })).filter((s) => s.fragment.trim().length > 2);
    const answers: string[] = [];
    const seen = new Set<string>();
    for (const s of asked) {
      const item = await findItem(client.id, s.fragment);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      const stock = await checkStock(client.id, item.id);
      const wanted = s.amount ? unitsOf(s, item.unitsPerPallet).units : 0;
      steps.push({ kind: "tool", text: `check_stock(${item.sku}) → ${stock.text} (${stock.units} units)` });
      const short = wanted > stock.units;
      if (short) steps.push({ kind: "ask", text: `${item.sku}: asks ${wanted} units, only ${stock.units} in stock` });
      answers.push(`${stock.text} de ${item.sku} (${stock.units.toLocaleString("es-ES")} uds)${wanted ? (short ? `: faltarían ${describeUnits(wanted - stock.units, item.unitsPerPallet, stock.unitWord)}` : ": hay suficiente") : ""}`);
    }
    if (!answers.length) return [human("stock question about a product I could not identify", steps)];
    steps.push({ kind: "ok", text: "reply drafted with live stock" });
    return [{
      kind: "REPLY_ONLY", payload: { answer: answers.join(" · ") }, doubts: [], steps,
      reply: `${hello(message.fromName)} ahora mismo tenéis ${answers.join("; ")}. Un saludo.`,
    }];
  }

  // 5. New outbound order.
  if (segments.length) {
    steps.push({ kind: "tool", text: "classify → new outbound order" });
    const lines: OutboundLineDraft[] = [];
    for (const s of segments) {
      const item = await findItem(client.id, s.fragment);
      steps.push({ kind: "tool", text: `find_item("${s.fragment}") → ${item ? item.sku : "no match"}` });
      if (!item) continue;
      const stock = await checkStock(client.id, item.id);
      const { units, options } = unitsOf(s, item.unitsPerPallet);
      steps.push({ kind: "tool", text: `check_stock(${item.sku}) → ${stock.text} (${stock.units} units)` });
      steps.push({ kind: options ? "ask" : "tool", text: convertLog(item.sku, s.amount, s.unit, convertQuantity(item, s.amount, s.unit)) });
      if (units > stock.units) steps.push({ kind: "ask", text: `${item.sku}: ${units} units asked, only ${stock.units} in stock` });
      lines.push(buildLine(item, units, stock.units, options));
    }
    if (!lines.length) return [human("order for products I could not identify", steps)];

    const consignees = await findConsignees(body);
    steps.push({
      kind: consignees.length === 1 ? "tool" : "ask",
      text: `find_consignee → ${consignees.length === 0 ? "no match" : consignees.length === 1 ? consignees[0].name : `${consignees.length} matches: ${consignees.map((c) => c.city).join(" / ")}`}`,
    });
    if (!consignees.length) return [human("order with a destination I do not recognise", steps)];

    const delivery = parseDelivery(body);
    return [outboundDraft(message, client, lines, consignees, delivery, steps)];
  }

  // 6. Anything else goes to a person, never guessed.
  steps.push({ kind: "tool", text: "classify → unclear request" });
  return [human("I am not sure what they are asking for", steps)];
}

/**
 * Turns an understood order into a draft for the office: an ambiguous hub or short stock
 * become yellow doubts, never silent guesses. Shared by the rules and the Muse Spark agent.
 */
export function outboundDraft(
  message: Message,
  client: Client,
  lines: OutboundLineDraft[],
  consignees: { id: string; name: string; city: string }[],
  delivery: { at: Date; phrase: string } | null,
  steps: Step[],
): DraftSeed {
  if (delivery) steps.push({ kind: "tool", text: `parse_date → ${delivery.at.toLocaleString("en-GB", { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" })}` });

  const payload: OutboundPayload = {
    clientId: client.id,
    clientName: client.name,
    consigneeId: consignees[0].id,
    consigneeName: consignees[0].name,
    deliverBy: delivery?.at.toISOString() ?? null,
    deliverPhrase: delivery?.phrase ?? "",
    clientDocRef: message.subject ? `${message.channel === "EMAIL" ? "Email" : "Msg"}: ${message.subject}` : null,
    lines,
  };
  const doubts: Doubt[] = [];
  if (consignees.length > 1) {
    doubts.push({
      field: "consigneeId",
      question: `Which ${consignees[0].name.split("–")[0].trim()} hub?`,
      options: consignees.map((c) => ({ label: `${c.name.split("–")[1]?.trim() ?? c.name} · ${c.city}`, value: c.id })),
    });
  }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.requestedUnits > l.availableUnits) {
      // Never promise what is not on the shelf: default to what is there, let the office decide.
      if (l.availableUnits > 0) lines[i] = withUnits(l, l.availableUnits);
      doubts.push({
        field: `units:${l.sku}`,
        question: `${l.sku}: ${describeUnits(l.requestedUnits, l.unitsPerPallet, l.unitWord)} asked, ${describeUnits(l.availableUnits, l.unitsPerPallet, l.unitWord)} in stock${l.unconfirmed ? " (and that quantity is not in the message: check it)" : ""}`,
        options: [
          ...(l.availableUnits > 0 ? [{ label: `Ship the ${describeUnits(l.availableUnits, l.unitsPerPallet, l.unitWord)} in stock`, value: String(l.availableUnits) }] : []),
          { label: `Ship ${describeUnits(l.requestedUnits, l.unitsPerPallet, l.unitWord)} anyway`, value: String(l.requestedUnits) },
        ],
      });
    } else if (l.wholeOptions?.length) {
      doubts.push({
        field: `units:${l.sku}`,
        question: `${l.sku}: that is not a whole number of ${l.unitWord}`,
        options: l.wholeOptions.map((u) => ({ label: describeUnits(u, l.unitsPerPallet, l.unitWord), value: String(u) })),
      });
    } else if (l.unconfirmed) {
      // Muse Spark's quantity is neither in the message nor in a convert_quantity result: a person checks it.
      const said = l.unconfirmed.fromMessage;
      doubts.push({
        field: `units:${l.sku}`,
        question: `${l.sku}: ${describeUnits(l.units, l.unitsPerPallet, l.unitWord)} is not in the message, check the quantity`,
        options: [
          ...(said !== null && said !== l.units ? [{ label: `Ship ${describeUnits(said, l.unitsPerPallet, l.unitWord)} (what the message says)`, value: String(said) }] : []),
          { label: `Ship ${describeUnits(l.units, l.unitsPerPallet, l.unitWord)} (as the assistant read it)`, value: String(l.units) },
        ],
      });
    }
  }
  steps.push({
    kind: doubts.length ? "ask" : "ok",
    text: doubts.length ? `draft outbound ready · ${doubts.length === 1 ? "1 thing" : `${doubts.length} things`} to check` : "draft outbound ready",
  });
  return { kind: "CREATE_OUTBOUND", payload, doubts, steps, reply: orderReply(payload, message.fromName) };
}
