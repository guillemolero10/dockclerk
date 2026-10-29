// Figures guard: a reply may only contain numbers that a tool returned (or that are in the message / today's date).
// Pure, so it can be tested without a database or a model.
//
// Spanish text writes "1.284,60 €" and "08/11"; tools return JSON such as 1284.6 and "2026-11-08".
// Both sides are reduced to the same canonical form (String(Number(x))) before they are compared.
//
// The same idea guards the quantities Muse Spark puts in an order: `unitsGrounded` says whether a number of units can be
// tied to the customer's message or to a convert_quantity result (the code, not the model, did that arithmetic).

import { scanQuantities, toUnits } from "@/lib/pallets/quantity";

/** "1.360" (Spanish thousands) is 1360 and "2,5" is 2.5. Every number of the text, canonical. */
export function figures(text: string): string[] {
  const t = text.replace(/(\d)\.(?=\d{3}(?!\d))/g, "$1");
  return (t.match(/\d+(?:,\d+)?/g) ?? []).map((n) => String(Number(n.replace(",", "."))));
}

/** Figures that count as known: the Spanish reading plus plain dot-decimals as JSON writes them (0.125, 30.24). */
export function knownFigures(texts: string[]): Set<string> {
  const known = new Set<string>();
  for (const text of texts) {
    for (const n of figures(text)) known.add(n);
    for (const m of text.matchAll(/(?<![\d.,])\d+\.\d+(?!\d|,\d|\.\d)/g)) known.add(String(Number(m[0])));
  }
  return known;
}

/** Figures of the answer that no source contains: empty means the answer is safe to show. */
export function inventedFigures(answer: string, sources: string[]): string[] {
  const known = knownFigures(sources);
  return figures(answer).filter((n) => !known.has(n));
}

const MONTHS = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre";

/** The message without the numbers that are not quantities: SKU codes (PELUCHE-30), times, dates and order references. */
function withoutNoise(text: string) {
  return text
    .replace(/\p{L}+[-_]\d+\p{L}*\d*/gu, " ") // PELUCHE-30, HORCH-1L
    .replace(/\d{1,2}[/:]\d{1,2}(?:[/:]\d{2,4})?/g, " ") // 08/11, 10:30
    .replace(new RegExp(`\\d{1,2} de (?:${MONTHS})`, "gi"), " ") // 3 de noviembre
    .replace(/\bl(?:a|as) \d{1,2}\b|\b\d{1,2} ?h\b/gi, " ") // antes de las 10, 10h
    .replace(/\b(?:pedido|ped|ref|albar[aá]n|n[º°]|n[uú]m(?:ero)?)\.?:? ?\d+/gi, " "); // pedido 4523, nº 12
}

/**
 * Can `units` be tied to what the customer wrote or to a convert_quantity result?
 *  1. convert_quantity of this item returned it (`converted`);
 *  2. the code's own reading of the message gives it ("2 palés y medio" of a 100-per-pallet item is 250);
 *  3. the number is written in the message as it is ("necesito 120 PELUCHE-30"), apart from SKUs, times and dates,
 *     and unless the message says it as pallets ("3 palés" is not 3 boxes).
 */
export function unitsGrounded(units: number, perPallet: number, text: string, converted: number[] = []): boolean {
  if (converted.includes(units)) return true;
  const clean = withoutNoise(text);
  const found = scanQuantities(clean);
  for (const q of found) {
    const r = toUnits(q.amount, q.unit, perPallet);
    if ("units" in r && r.units === units) return true;
  }
  const written = String(units);
  if (!figures(clean).includes(written)) return false;
  const asPallets = found.some((q) => q.unit === "pallets" && String(q.amount) === written);
  const asUnits = found.some((q) => q.unit === "units" && String(q.amount) === written);
  return !asPallets || asUnits;
}

/** What the message itself says, in whole units, when it states exactly one quantity (so it cannot belong to another line). */
export function messageUnits(perPallet: number, text: string): number | null {
  const found = scanQuantities(withoutNoise(text));
  if (found.length !== 1) return null;
  const r = toUnits(found[0].amount, found[0].unit, perPallet);
  return "units" in r ? r.units : null;
}
