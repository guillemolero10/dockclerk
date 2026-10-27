// Plan B clerk: a rules engine for Spanish customer messages.
// It returns the same DraftSeed contract Muse Spark will return, so the approval queue does not care
// which one ran. It also backs the live demo if the model is slow or unavailable.
import type { Client, Message } from "@prisma/client";
import { madridDayRange } from "@/lib/format";
import { checkStock, findConsignees, findItem, inboundsThisMonth, lastShipmentTo, norm } from "./tools";
import type { Doubt, DraftSeed, OutboundLineDraft, OutboundPayload, Step } from "./types";

const HOUR = 60 * 60 * 1000;
const WEEKDAYS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

/** "Marta Pérez (Juguetes Levante)" → "Marta". Company-only senders get no name. */
function firstName(fromName: string) {
  return fromName.includes("(") ? fromName.split(/[ (]/)[0] : null;
}

function hello(fromName: string) {
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
    .map((l) => (l.pallets < l.requested
      ? `${l.pallets} palés de ${l.sku} (de los ${l.requested} pedidos, es lo que tenéis en stock; el resto queda pendiente)`
      : `${l.pallets} palés de ${l.sku}`))
    .join(" y ");
  const when = payload.deliverBy ? `, entrega ${deliveryText(payload)}` : "";
  return `${hello(fromName)} confirmado: ${what} para ${payload.consigneeName ?? "el destino indicado"}${when}. Un saludo, Almacenes del Vinalopó.`;
}

/** "12 palés de PELUCHE-30", "4 de horchata", "15 de blando" → quantity + product fragment. */
function quantitySegments(text: string) {
  const t = norm(text).replace(/litro y medio/g, "1,5").replace(/\bref\.\s*/g, "");
  const re = /(\d+)\s*(?:pales?|palets?)?\s+de\s+(.+?)(?=\s+(?:para|a|y|del pedido)\s|[,.;!?]|$)/g;
  return [...t.matchAll(re)].map((m) => ({ pallets: Number(m[1]), fragment: m[2] }));
}

function channelLabel(m: Message) {
  return m.channel === "EMAIL" ? "email" : m.channel === "WHATSAPP" ? "WhatsApp" : "portal request";
}

function human(reason: string, steps: Step[]): DraftSeed {
  return { kind: "NEEDS_HUMAN", payload: { reason }, doubts: [], steps: [...steps, { kind: "ask", text: `needs you · ${reason}` }], reply: null };
}

export async function draftMessage(message: Message & { client: Client | null }): Promise<DraftSeed[]> {
  const body = message.body ?? "";
  const t = norm(body);
  const steps: Step[] = [{ kind: "read", text: `${channelLabel(message)} · ${message.client?.name ?? message.fromName}` }];

  // 1. Messages the clerk should not act on alone.
  if (!message.client) {
    const sales = /tarifa|oferta|presentamos/.test(t);
    steps.push({ kind: "tool", text: `find_customer("${message.fromName}") → no match` });
    return [human(sales ? "sales email from a supplier, no action needed" : "unknown sender, not a customer in the software", steps)];
  }
  const client = message.client;
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
    const what = last.lines.map((l) => `${l.pallets} palés de ${l.item.sku}`).join(" y ");
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
      : t.split(/\?|\by\b/).map((fragment) => ({ pallets: 0, fragment })).filter((s) => s.fragment.trim().length > 2);
    const answers: string[] = [];
    const seen = new Set<string>();
    for (const s of asked) {
      const item = await findItem(client.id, s.fragment);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      const stock = await checkStock(client.id, item.id);
      steps.push({ kind: "tool", text: `check_stock(${item.sku}) → ${stock.pallets} pallets` });
      const short = s.pallets > stock.pallets;
      if (short) steps.push({ kind: "ask", text: `${item.sku}: asks ${s.pallets}, only ${stock.pallets} in stock` });
      answers.push(`${stock.pallets} palés de ${item.sku} (${stock.units.toLocaleString("es-ES")} uds)${s.pallets ? (short ? `: faltarían ${s.pallets - stock.pallets}` : ": hay suficiente") : ""}`);
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
      steps.push({ kind: "tool", text: `check_stock(${item.sku}) → ${stock.pallets} pallets` });
      if (s.pallets > stock.pallets) steps.push({ kind: "ask", text: `${item.sku}: ${s.pallets} asked, only ${stock.pallets} in stock` });
      lines.push({ itemId: item.id, sku: item.sku, description: item.description, pallets: s.pallets, requested: s.pallets, unitsPerPallet: item.unitsPerPallet, available: stock.pallets });
    }
    if (!lines.length) return [human("order for products I could not identify", steps)];

    const consignees = await findConsignees(body);
    steps.push({
      kind: consignees.length === 1 ? "tool" : "ask",
      text: `find_consignee → ${consignees.length === 0 ? "no match" : consignees.length === 1 ? consignees[0].name : `${consignees.length} matches: ${consignees.map((c) => c.city).join(" / ")}`}`,
    });
    if (!consignees.length) return [human("order with a destination I do not recognise", steps)];

    const delivery = parseDelivery(body);
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
    for (const l of lines.filter((l) => l.requested > l.available)) {
      // Never promise what is not on the shelf: default to what is there, let the office decide.
      if (l.available > 0) l.pallets = l.available;
      doubts.push({
        field: `pallets:${l.sku}`,
        question: `${l.sku}: ${l.requested} asked, ${l.available} in stock`,
        options: [
          ...(l.available > 0 ? [{ label: `Ship the ${l.available} in stock`, value: String(l.available) }] : []),
          { label: `Ship ${l.requested} anyway`, value: String(l.requested) },
        ],
      });
    }
    steps.push({
      kind: doubts.length ? "ask" : "ok",
      text: doubts.length ? `draft outbound ready · ${doubts.length === 1 ? "1 thing" : `${doubts.length} things`} to check` : "draft outbound ready",
    });
    return [{ kind: "CREATE_OUTBOUND", payload, doubts, steps, reply: orderReply(payload, message.fromName) }];
  }

  // 6. Anything else goes to a person, never guessed.
  steps.push({ kind: "tool", text: "classify → unclear request" });
  return [human("I am not sure what they are asking for", steps)];
}
