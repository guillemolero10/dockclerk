// What the clerk says about the month's bill. Pure: no database, no model.
// The figures come from src/lib/billing (loadBilling or a saved pre-invoice); this file only chooses the month,
// shapes the result for a tool and writes it in Spanish. Nothing here adds up or prices anything.
import { period, type Period } from "@/lib/billing/calendar";

export type BillStatus = "draft" | "approved" | "not prepared";

// ---------- Spanish formats ----------

/** 1284.6 → "1.284,60": thousands always grouped, so the text looks the same whatever the locale data says. */
export function numEs(n: number, min = 0, max = 2) {
  const s = n.toLocaleString("en-US", { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: false });
  const [int, dec] = s.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return dec ? `${grouped},${dec}` : grouped;
}
export const eurosEs = (cents: number) => `${numEs(cents / 100, 2, 2)} €`;
/** "2026-11-08" → "08/11" */
export const ddmm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const monthName = (ymd: string) => `${MONTHS[Number(ymd.slice(5, 7)) - 1]} de ${ymd.slice(0, 4)}`;

// ---------- Which period ----------

export type Window = { p: Period; toDate: boolean };

/**
 * No month = the current month up to today. The current month named explicitly is the same (it is not over yet).
 * A past month is the whole month. A future month, or something that is not a month, is an error.
 */
export function resolveWindow(month: unknown, todayYmd: string): Window | { error: string } {
  const current = todayYmd.slice(0, 7);
  const toDate = (): Window => ({ p: period(`${current}-01`, todayYmd), toDate: true });
  if (month === undefined || month === null || month === "") return toDate();
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { error: 'month must look like "2026-10"' };
  if (month > current) return { error: "That month has not started." };
  if (month === current) return toDate();
  return { p: period(month), toDate: false };
}

// ---------- A bill, as a tool answers it ----------

export type BillLineIn = { concept: string; label: string; quantity: number; unit: string; price: number; cents: number };
export type BillIn = {
  p: Period;
  toDate: boolean;
  status: BillStatus;
  rule?: string;
  lines: BillLineIn[];
  baseCents: number;
  vatPct: number;
  vatCents: number;
  totalCents: number;
};

const CONCEPT_ES: Record<string, string> = { in: "entradas", out: "salidas", storage: "almacenaje", handling: "manipulación" };
const UNIT_ES: Record<string, string> = { pallets: "palés", "pallet·day": "palés·día" };
const STATUS_ES: Record<BillStatus, string> = { draft: "borrador", approved: "aprobada", "not prepared": "provisional, aún sin preparar" };

function lineLabel(l: BillLineIn) {
  const base = CONCEPT_ES[l.concept] ?? l.label;
  if (l.concept !== "storage") return base;
  return /american/i.test(l.label) ? `${base} (palés americanos)` : `${base} (palés europeos)`;
}

export function shapeBill(b: BillIn) {
  const shown = b.lines.filter((l) => l.quantity !== 0 || l.cents !== 0);
  const lines = shown.map((l) => ({
    label: lineLabel(l), quantity: l.quantity, unit: UNIT_ES[l.unit] ?? l.unit, price: l.price, amount: l.cents / 100, amountText: eurosEs(l.cents),
  }));
  const span = b.toDate ? `del ${ddmm(b.p.first)} al ${ddmm(b.p.last)} (hasta hoy)` : monthName(b.p.first);
  const body = shown.length
    ? `${lines.map((l) => `${l.label} ${numEs(l.quantity)} ${l.unit} × ${numEs(l.price, 2, 4)} € = ${l.amountText}`).join("; ")}. Base ${eurosEs(b.baseCents)}, IVA ${numEs(b.vatPct)} % ${eurosEs(b.vatCents)}, total ${eurosEs(b.totalCents)}.`
    : "sin movimientos en ese periodo.";
  return {
    text: `Prefactura ${span} (${STATUS_ES[b.status]}): ${body}`,
    period: `${b.p.first}..${b.p.last}`,
    status: b.status,
    rule: b.rule ?? null,
    lines,
    base: b.baseCents / 100, baseText: eurosEs(b.baseCents),
    vatPct: b.vatPct, vat: b.vatCents / 100, vatText: eurosEs(b.vatCents),
    total: b.totalCents / 100, totalText: eurosEs(b.totalCents),
  };
}

// ---------- One entry, explained ----------

export type DetailIn = {
  inboundNumber: number | null; docRef: string | null; sku: string; lot: string | null; inDate: string;
  concept: "in" | "out" | "storage"; pallets: number; days: number | null; exitDate: string | null; palletDays: number | null; cents: number;
};

const MAX_ROWS = 8;

/** Rows of the detail that belong to one entry (inbound number) or one lot. */
export function shapeExplain(rows: DetailIn[], p: Period, filter: { inbound?: number; lot?: string }, status: BillStatus) {
  const lot = filter.lot?.trim().toLowerCase();
  const mine = rows.filter((r) => (filter.inbound !== undefined && r.inboundNumber === filter.inbound) || (lot !== undefined && lot !== "" && (r.lot ?? "").toLowerCase() === lot));
  if (!mine.length) return { error: "no charges for that entry or lot in this period", text: "", period: `${p.first}..${p.last}` };

  const storage = mine.filter((r) => r.concept === "storage");
  const out = storage.slice(0, MAX_ROWS).map((r) => ({
    concept: "storage" as const,
    sku: r.sku, lot: r.lot,
    pallets: r.pallets, days: r.days, from: r.inDate > p.first ? r.inDate : p.first, exit: r.exitDate,
    palletDays: r.palletDays, amount: r.cents / 100,
  }));
  const moves = mine.filter((r) => r.concept !== "storage").slice(0, MAX_ROWS).map((r) => ({
    concept: r.concept, sku: r.sku, lot: r.lot, pallets: r.pallets, date: r.concept === "in" ? r.inDate : r.exitDate, amount: r.cents / 100,
  }));

  const what = filter.inbound !== undefined ? `Entrada ${filter.inbound}` : `Lote ${filter.lot}`;
  const parts = [
    ...out.map((r) => `${numEs(r.pallets)} palés × ${r.days} días (desde el ${ddmm(r.from)}, ${r.exit ? `sale el ${ddmm(r.exit)}` : "sin salida"}) = ${numEs(r.palletDays ?? 0)} palés·día = ${eurosEs(Math.round(r.amount * 100))}`),
    ...moves.map((r) => `${r.concept === "in" ? "entrada" : "salida"} de ${numEs(r.pallets)} palés${r.date ? ` (${ddmm(r.date)})` : ""} = ${eurosEs(Math.round(r.amount * 100))}`),
  ];
  const totalPd = storage.reduce((a, r) => a + (r.palletDays ?? 0), 0);
  return {
    text: `${what} · ${monthName(p.first)} (${STATUS_ES[status]}): ${parts.join("; ")}.`,
    period: `${p.first}..${p.last}`,
    status,
    rows: out,
    moves,
    palletDays: Math.round(totalPd * 1e6) / 1e6,
    ...(storage.length > MAX_ROWS ? { moreRows: storage.length - MAX_ROWS } : {}),
  };
}

// ---------- Plan B: what is the customer asking about their bill? ----------

export type BillingIntent =
  | { kind: "amount"; month?: string }
  | { kind: "explain"; month?: string; inbound?: number; lot?: string }
  | { kind: "human" };

const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// Things only a person can handle: resending an invoice, claims, payments, corrections.
const CLAIM = /reclam|queja|no (nos |me )?(ha |han )?llegado|no (nos |me )?llego|no (he|hemos) recibido|reenvi|volver a (mandar|enviar)|(mandar|enviar)(me|nos)? (otra vez )?(la |una |otra |el )?(pre-?)?(factura|recibo)|mandad? (la |una )?(pre-?)?factura|pagar|\bpagos?\b|\bcobros?\b|abono|rectific|duplicad|error en|incorrect|no cuadra|de mas\b|devol|transferencia|vencim|impagad/;
const BILL_WORD = /factura|prefactura|cobr|almacenaje|pal(?:e|et)s?\s*[·.-]?\s*dias?\b|importe|cargo/;
const AMOUNT = /cuanto (llevo|llevamos|llevan|va|van|me sale|nos sale|toca|se lleva|debo|deberia)|lo que (llevo|llevamos)|llevamos? (de|en) (almacenaje|el mes)|almacenaje|pal(?:e|et)s?\s*[·.-]?\s*dias?\b|pre-?factura/;
const EXPLAIN = /por que|porque|explic|a que se debe|de donde sale|como (se )?(calcula|sale)|desglose|detalle/;
const INBOUND = /entrada\s*(?:n(?:umero|um\.?|[º°o.])?\s*)?[:#]?\s*(\d{1,7})\b/;
const LOT = /\blote\s*[:#]?\s*([a-z0-9\-_/]*\d[a-z0-9\-_/]*)/;

/** "septiembre" → "2026-09"; this month or no month named → undefined (the month so far). */
export function monthFromText(text: string, todayYmd: string): string | undefined {
  const t = plain(text);
  const [y, m] = [Number(todayYmd.slice(0, 4)), Number(todayYmd.slice(5, 7))];
  const shift = (back: number) => {
    const idx = y * 12 + (m - 1) - back;
    return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
  };
  if (/mes pasado|mes anterior/.test(t)) return shift(1);
  const named = MONTHS.findIndex((n) => new RegExp(`\\b${n}\\b`).test(t));
  if (named < 0 || named === m - 1) return undefined;
  return `${named + 1 < m ? y : y - 1}-${String(named + 1).padStart(2, "0")}`;
}

/** null = nothing to do with the bill (the other rules decide). */
export function billingIntent(text: string, todayYmd: string): BillingIntent | null {
  const t = plain(text);
  if (!BILL_WORD.test(t) && !CLAIM.test(t)) return null;
  if (CLAIM.test(t) && BILL_WORD.test(t)) return { kind: "human" };
  const month = monthFromText(t, todayYmd);
  const inbound = INBOUND.exec(t)?.[1];
  const lot = LOT.exec(t)?.[1];
  if (EXPLAIN.test(t) && (inbound || lot)) return { kind: "explain", month, ...(inbound ? { inbound: Number(inbound) } : { lot }) };
  if (AMOUNT.test(t)) return { kind: "amount", month };
  return null;
}
