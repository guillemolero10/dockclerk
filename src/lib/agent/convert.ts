// convert_quantity: the customer's words become whole units here, in code. The model never multiplies.
import { describeUnits, splitUnits, toUnits, unitWordFor } from "@/lib/pallets/quantity";

export type ConvertItem = { sku: string; unitsPerPallet: number; unit: "PALLET" | "BOX" | "BAG" };

/** anything starting with "pal" (pallets, palés) → pallets; anything else ("units", "cajas", "boxes") → units. */
export function unitKind(value: unknown): "pallets" | "units" {
  return /^pal/i.test(String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim()) ? "pallets" : "units";
}

/** The model may send 2.5, "2,5" or "2.5": a number, or null if it is not one. */
export function readAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const s = value.trim().replace(",", ".");
  return /^-?\d+(?:\.\d+)?$/.test(s) ? Number(s) : null;
}

export type ConvertOutput =
  | { sku: string; units: number; fullPallets: number; looseUnits: number; palletEquivalent: number; unitWord: string; unitsPerPallet: number; text: string }
  | { error: string; options: { units: number; text: string }[] };

export function convertQuantity(item: ConvertItem, amount: unknown, unit: unknown): ConvertOutput {
  const n = readAmount(amount);
  if (n === null) return { error: "amount must be a number", options: [] };
  const kind = unitKind(unit);
  const word = unitWordFor(item.unit);
  const r = toUnits(n, kind, item.unitsPerPallet);
  if ("error" in r) {
    const label = kind === "pallets" ? "pallets" : "units";
    return {
      error: r.options.length ? `${n} ${label} is not a whole number of ${word}` : r.error,
      options: r.options.map((units) => ({ units, text: describeUnits(units, item.unitsPerPallet, word) })),
    };
  }
  const s = splitUnits(r.units, item.unitsPerPallet);
  return {
    sku: item.sku, units: r.units, fullPallets: s.full, looseUnits: s.loose, palletEquivalent: Math.round(s.equivalent * 1e6) / 1e6,
    unitWord: word, unitsPerPallet: item.unitsPerPallet, text: describeUnits(r.units, item.unitsPerPallet, word),
  };
}

/** The line shown in the draft log: convert_quantity(HORCH-1L, 2.5 pallets) → 2 palés + 50 cajas */
export function convertLog(sku: string, amount: unknown, unit: unknown, out: ConvertOutput) {
  const n = readAmount(amount) ?? String(amount);
  const what = `${n} ${unitKind(unit) === "pallets" ? "pallets" : "units"}`;
  if ("error" in out) return `convert_quantity(${sku}, ${what}) → ${out.options.length ? `not whole: ${out.options.map((o) => o.units).join(" or ")} units` : out.error}`;
  return `convert_quantity(${sku}, ${what}) → ${out.text}`;
}
