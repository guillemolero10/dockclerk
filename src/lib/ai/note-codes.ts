// Pallet IDs the model read off a delivery note, cleaned before anyone sees them. Pure.
// The model may only copy what is printed; whatever does not look like a pallet ID is dropped, never repaired or invented.

import { parseCode } from "@/lib/pallets/codes";

/**
 * Valid IDs only (parseCode), no repeats inside one line, none equal to the lot or the document number
 * (a model that copies the wrong column), and no more than the line has pallets (when known).
 * The same ID under two different lines is kept on purpose: it is one mixed pallet.
 */
export function cleanPalletCodes(raw: unknown, line: { pallets: number | null; lot: string | null }, docRef: string | null): string[] | null {
  if (!Array.isArray(raw)) return null;
  const forbidden = new Set([line.lot, docRef].map((v) => (v ? parseCode(v) : null)).flatMap((p) => (p && p.ok && p.code ? [p.code] : [])));
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string" && typeof value !== "number") continue;
    const parsed = parseCode(String(value));
    if (!parsed.ok || !parsed.code || forbidden.has(parsed.code) || out.includes(parsed.code)) continue;
    out.push(parsed.code);
  }
  const limit = line.pallets && line.pallets > 0 ? Math.floor(line.pallets) : null;
  const kept = limit ? out.slice(0, limit) : out;
  return kept.length ? kept : null;
}
