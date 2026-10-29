// Figures guard: a reply may only contain numbers that a tool returned (or that are in the message / today's date).
// Pure, so it can be tested without a database or a model.
//
// Spanish text writes "1.284,60 €" and "08/11"; tools return JSON such as 1284.6 and "2026-11-08".
// Both sides are reduced to the same canonical form (String(Number(x))) before they are compared.
//
// The same idea guards the quantities Muse Spark puts in an order: `unitsGrounded` says whether a number of units can be
// tied to what the customer wrote *for that item* or to a convert_quantity result (the code, not the model, did that arithmetic).
// A number only counts as a quantity if the message reads it as one (palés, cajas, "120 PELUCHE-30"); "gel de 750" (ml),
// a plate, a phone, a time or the 30 of a SKU are not quantities.

import { scanQuantities, toUnits, type Quantity } from "@/lib/pallets/quantity";
import { itemScore, norm, SYNONYMS } from "./words";

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

/** The message without the numbers that are not quantities: SKU codes (PELUCHE-30; unless `keepSkus`), times, dates and order references. */
function withoutNoise(text: string, keepSkus = false) {
  return (keepSkus ? text : text.replace(/\p{L}+[-_]\d+\p{L}*\d*/gu, " ")) // PELUCHE-30, HORCH-1L
    .replace(/\d{1,2}[/:]\d{1,2}(?:[/:]\d{2,4})?/g, " ") // 08/11, 10:30
    .replace(new RegExp(`\\d{1,2} de (?:${MONTHS})`, "gi"), " ") // 3 de noviembre
    .replace(/\bl(?:a|as) \d{1,2}\b|\b\d{1,2} ?h\b/gi, " ") // antes de las 10, 10h
    .replace(/\b(?:pedido|ped|ref|albar[aá]n|n[º°]|n[uú]m(?:ero)?)\.?:? ?\d+/gi, " "); // pedido 4523, nº 12
}

const DIGITS: Record<string, number> = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 };
const TENS: Record<string, number> = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const EN_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

/**
 * Words the quantity reader does not know, said the way it does (plain text in, plain text out): "treinta y cinco" is 35,
 * "europalets" are palets, and an English order ("two pallets of PELUCHE-30", "2 and a half pallets") reads like the Spanish one.
 * Only the guard needs this: it must not call a quantity "invented" just because it is written differently.
 */
function sameWords(t: string) {
  const digit = "un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve";
  const tens = Object.keys(TENS).join("|");
  const en = Object.keys(EN_NUMBERS).join("|");
  return t
    .replace(new RegExp(`\\bveinti(${digit})\\b`, "g"), (_, u: string) => String(20 + DIGITS[u]))
    .replace(new RegExp(`\\b(${tens}) y (${digit})\\b`, "g"), (_, d: string, u: string) => String(TENS[d] + DIGITS[u]))
    .replace(new RegExp(`\\b(${tens})\\b`, "g"), (d) => String(TENS[d]))
    .replace(/\bcien\b/g, "100")
    .replace(/\beuro-?(?=pal)/g, "")
    .replace(new RegExp(`\\b(${en})\\b(?= (?:and a half )?(?:pallets?|boxes|box|cases?|bags?|units?)\\b)`, "g"), (w) => String(EN_NUMBERS[w]))
    .replace(/(\d+(?:[.,]\d+)?) and a half (pallets?)\b/g, "$1 $2 y medio")
    .replace(/\bhalf a (?=pallet\b)/g, "medio ")
    .replace(/\bpallet(s?)\b/g, "palet$1")
    .replace(/\b(?:boxes|box|cases?)\b/g, "cajas")
    .replace(/\bbags?\b/g, "sacos")
    .replace(/\bunits?\b/g, "unidades")
    .replace(/\bof\b/g, "de");
}

/** What the guard reads: plain text, no dates, times or references; SKU codes stay (they name an item); "litro y medio" is 1,5. */
function readingText(text: string) {
  let t = norm(withoutNoise(sameWords(norm(text)), true)).replace(/\bref\.\s*/g, ""); // "la ref. PELUCHE-30"
  for (const [re, rep] of SYNONYMS) t = t.replace(re, rep);
  return norm(t);
}

/** Where a quantity's item name ends: the destination ("a Alicante", "para ..."), a punctuation mark (but not the comma of 1,5). */
const CUT = /\s(?:para|a|al|hacia|en|que|pero|antes|el)\s|[,.;:!?](?!\d)/;

/** The one item of the customer that the words name best, or null if none does or two do equally well. */
function bestItem(words: string, catalog: ItemRef[]): string | null {
  let best = 0;
  let owner: string | null = null;
  let tie = false;
  for (const item of catalog) {
    const score = itemScore(words, item);
    if (score > best) {
      best = score;
      owner = item.sku;
      tie = false;
    } else if (score === best && score > 0) tie = true;
  }
  return best > 0 && !tie ? owner : null;
}

/**
 * The item a quantity is "de": "10 palés [de mazapán] y 5 de polvorones". Only when it is clear: the quantity is followed by "de",
 * the words after it name exactly one item and they are not a list ("10 palés de mazapán y polvorones": is it 10 each or 10 between them?).
 * Otherwise null: the code cannot tell, so it does not block.
 */
function ownerOf(rest: string, catalog: ItemRef[]): string | null {
  const m = /^\s+de\s+([\s\S]*)$/.exec(rest);
  if (!m) return null;
  const owners = m[1].split(CUT)[0].split(/\s(?:y|e)\s/).map((part) => bestItem(part.trim(), catalog));
  return owners[0] && owners.filter(Boolean).length === 1 ? owners[0] : null;
}

/** Every quantity of the (reading) text, with the SKU it clearly belongs to, or null. */
function ownedQuantities(t: string, catalog: ItemRef[]) {
  const found = scanQuantities(t);
  return found.map((q, i) => ({ amount: q.amount, unit: q.unit, owner: catalog.length ? ownerOf(t.slice(q.end, found[i + 1]?.start ?? t.length), catalog) : null }));
}

/** "120 PELUCHE-30", "120 x PELUCHE-30", "PELUCHE-30: 120", "PELUCHE-30 x 120": a bare number tied to the item's own code is units of it. */
function bareUnits(t: string, sku: string): Quantity[] {
  const code = norm(sku).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const whole = "(\\d{1,3}(?:\\.\\d{3})+|\\d+)(?!\\d|[.,]\\d)";
  const before = new RegExp(`(?<![a-z0-9,.-])${whole}\\s*(?:x\\s*)?${code}(?![a-z0-9])`, "g");
  const after = new RegExp(`(?<![a-z0-9])${code}\\s*(?:[:=×]|x\\b)\\s*${whole}`, "g");
  return [...t.matchAll(before), ...t.matchAll(after)].map((m) => ({ amount: Number(m[1].replace(/\./g, "")), unit: "units" as const }));
}

/** An item as the guard knows it: enough to tell which words of a message name it. */
export type ItemRef = { sku: string; description: string };

/**
 * The quantities the message states that can be this item's.
 *  - those clearly "de" this item ("10 palés de mazapán"); if there are none, those that clearly belong to no item;
 *    a quantity clearly of another item ("5 de polvorones") is not available, so two lines cannot swap their numbers;
 *  - bare numbers tied to its SKU ("120 PELUCHE-30").
 * Without `item` (or `catalog`) nothing can be tied to a line, and every quantity of the message is available.
 */
export function messageQuantities(text: string, item?: ItemRef, catalog: ItemRef[] = []): Quantity[] {
  const t = readingText(text);
  const owned = ownedQuantities(t, catalog);
  if (!item) return owned.map(({ amount, unit }) => ({ amount, unit }));
  const mine = owned.filter((q) => q.owner === item.sku);
  const usable = mine.length ? mine : owned.filter((q) => q.owner === null);
  return [...usable.map(({ amount, unit }) => ({ amount, unit })), ...bareUnits(t, item.sku)];
}

/**
 * Can `units` be tied to what the customer wrote or to a convert_quantity result?
 *  1. convert_quantity of this item returned it (`converted`; muse.ts only records it when the amount asked was the customer's own);
 *  2. the code's own reading of the message gives it for this item ("2 palés y medio" of a 100-per-pallet item is 250,
 *     "130 cajas" is 130, "120 PELUCHE-30" is 120).
 * A figure that is merely somewhere in the message does not count: "gel de 750" is 750 ml, not 750 cajas.
 */
export function unitsGrounded(units: number, perPallet: number, text: string, converted: number[] = [], item?: ItemRef, catalog: ItemRef[] = []): boolean {
  if (converted.includes(units)) return true;
  return messageQuantities(text, item, catalog).some((q) => {
    const r = toUnits(q.amount, q.unit, perPallet);
    return "units" in r && r.units === units;
  });
}

/** Is this amount (as the model sent it to convert_quantity) something the customer wrote for this item? */
export function amountInMessage(amount: number, unit: "pallets" | "units", text: string, item?: ItemRef, catalog: ItemRef[] = []): boolean {
  return messageQuantities(text, item, catalog).some((q) => q.unit === unit && Math.abs(q.amount - amount) < 1e-6);
}

/** What the message itself says for this item, in whole units, when it says exactly one thing (so the office can be offered it). */
export function messageUnits(perPallet: number, text: string, item?: ItemRef, catalog: ItemRef[] = []): number | null {
  const all = new Set<number>();
  for (const q of messageQuantities(text, item, catalog)) {
    const r = toUnits(q.amount, q.unit, perPallet);
    if ("units" in r) all.add(r.units);
    else return null; // a quantity that is not whole: the message does not say one number
  }
  return all.size === 1 ? [...all][0] : null;
}
