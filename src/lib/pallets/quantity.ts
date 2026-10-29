// Quantities, the way people say them and the way the warehouse counts them.
//
// Units (boxes, bags) are the truth. Pallets are derived: a pallet holds `perPallet` units,
// "2,5 palés" is just 2.5 × perPallet units, and what does not fill a pallet is a loose pallet.
// Pure functions: no database, no model, so the same words always give the same numbers.

export type Quantity = { amount: number; unit: "pallets" | "units" };

export type UnitsResult = { units: number } | { error: string; options: number[] };

export type UnitSplit = {
  /** Whole pallets. */
  full: number;
  /** Units left over that do not fill a pallet. */
  loose: number;
  /** Pallets as a decimal, e.g. 2.5. */
  equivalent: number;
  /** Pallet positions needed to hold it: ⌈units / perPallet⌉. */
  slots: number;
};

/** Plural word for the item's unit, as the customer says it. */
export function unitWordFor(unit: "PALLET" | "BOX" | "BAG") {
  return unit === "BOX" ? "cajas" : unit === "BAG" ? "sacos" : "unidades";
}

const near = (x: number) => Math.abs(x - Math.round(x)) < 1e-6;

/** Converts what the customer asked for into whole units, or says which two whole numbers are close. */
export function toUnits(amount: number, unit: "pallets" | "units", perPallet: number): UnitsResult {
  if (!Number.isFinite(amount) || amount <= 0) return { error: "quantity must be greater than zero", options: [] };
  if (!Number.isInteger(perPallet) || perPallet <= 0) return { error: "units per pallet must be a positive whole number", options: [] };
  const raw = unit === "pallets" ? amount * perPallet : amount;
  if (near(raw)) return { units: Math.round(raw) };
  const lo = Math.floor(raw);
  const hi = Math.ceil(raw);
  return { error: "not a whole number of units", options: lo > 0 ? [lo, hi] : [hi] };
}

export function splitUnits(units: number, perPallet: number): UnitSplit {
  const full = Math.floor(units / perPallet);
  return { full, loose: units - full * perPallet, equivalent: units / perPallet, slots: Math.ceil(units / perPallet) };
}

const singular = (word: string) => (word.endsWith("s") ? word.slice(0, -1) : word);

/** "2 palés + 20 cajas", "3 palés", "20 cajas", "1 palé + 1 caja". */
export function describeUnits(units: number, perPallet: number, unitWord = "cajas") {
  const { full, loose } = splitUnits(units, perPallet);
  const pallets = full > 0 ? `${full} ${full === 1 ? "palé" : "palés"}` : "";
  const rest = loose > 0 || full === 0 ? `${loose} ${loose === 1 ? singular(unitWord) : unitWord}` : "";
  return [pallets, rest].filter(Boolean).join(" + ");
}

// ---------- reading text ----------

const WORDS: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, veinte: 20,
};

/** Lowercase, no accents, single spaces. */
const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

function parseNumber(text: string) {
  if (text in WORDS) return WORDS[text];
  if (/^\d{1,3}(\.\d{3})+$/.test(text)) return Number(text.replace(/\./g, "")); // 1.360 = mil trescientos sesenta
  return Number(text.replace(",", "."));
}

const NUM = `(?:\\d{1,3}(?:\\.\\d{3})+|\\d+(?:[.,]\\d+)?|${Object.keys(WORDS).join("|")})`;
const PALLET = "pal(?:e|et)s?"; // the Spanish word, with or without final t, singular or plural (accents are gone by now)
const PALLET_ONE = "pal(?:e|et)";
const UNITS = "(?:cajas?|sacos?|bultos?|unidades|uds?)";
const MONTHS = "(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)";

const SCAN = new RegExp(
  "(?<![a-z0-9,.-])(?:" +
    `(media docena de) ${PALLET}\\b` + // 1: half a dozen pallets
    `|(?:medio|media) ${PALLET}\\b` + // half a pallet
    `|(?:(${NUM}) ?${PALLET}\\b|${PALLET_ONE}\\b)( y medio\\b)?` + // 2: number, 3: "and a half"; a bare "palé" is one
    `|(${NUM}) ?${UNITS}\\b` + // 4: boxes, bags
    `|(\\d+(?:[.,]\\d+)?)(?= de (?!${MONTHS}\\b))` + // 5: a bare number before "de" means pallets ("3 de noviembre" is a date)
  ")",
  "g",
);

/** Every quantity in a text, in order, with where it sits (indexes in the plain text). */
export function scanQuantities(text: string) {
  const t = plain(text);
  const found: (Quantity & { start: number; end: number })[] = [];
  for (const m of t.matchAll(SCAN)) {
    const start = m.index!;
    const end = start + m[0].length;
    const whole = m[0];
    if (m[1]) found.push({ amount: 6, unit: "pallets", start, end });
    else if (/^(medio|media) /.test(whole)) found.push({ amount: 0.5, unit: "pallets", start, end });
    else if (m[4]) found.push({ amount: parseNumber(m[4]), unit: "units", start, end });
    else if (m[5]) found.push({ amount: parseNumber(m[5]), unit: "pallets", start, end });
    else found.push({ amount: (m[2] ? parseNumber(m[2]) : 1) + (m[3] ? 0.5 : 0), unit: "pallets", start, end });
  }
  return found;
}

/**
 * First quantity in a text: "2,5 palés", "2 palés y medio", "medio palé", "palé y medio",
 * "media docena de palés", "130 cajas", "40 sacos". A bare number before "de" ("4 de horchata") is pallets.
 * Negative numbers are not read. Plan B for the rules; Muse Spark does the same with convert_quantity.
 */
export function readQuantity(text: string): Quantity | null {
  const first = scanQuantities(text)[0];
  return first ? { amount: first.amount, unit: first.unit } : null;
}
