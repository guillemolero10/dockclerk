// Pallet IDs (licence plates). Pure.
// Only what the seed needs for now; the rest of the contract (parseCode, ...) is added with the receiving form.

/** The code the warehouse gives a pallet that came without one: building code + 6 digits, "N1-000123". */
export function generatedCode(warehouseCode: string, n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new Error(`Pallet number must be a positive whole number (got ${n})`);
  return `${warehouseCode}-${String(n).padStart(6, "0")}`;
}

const VALID = /^[A-Z0-9][A-Z0-9-]{3,23}$/;

/**
 * A pallet ID typed or scanned (the scanner on the handheld types it like a keyboard).
 * Upper case, no spaces, the "(00)" application identifier of a barcode dropped. Blank = no ID (the warehouse labels it).
 */
export function parseCode(raw: string): { ok: true; code: string | null } | { ok: false; error: string } {
  const code = String(raw ?? "").toUpperCase().replace(/\s+/g, "").replace(/^\(00\)/, "");
  if (!code) return { ok: true, code: null };
  if (!VALID.test(code)) return { ok: false, error: `Pallet ID "${code.slice(0, 30)}" is not valid: 4 to 24 letters, digits or dashes.` };
  return { ok: true, code };
}

/** The first `count` codes of the numbers `start`, `start + 1`… that are not in `taken` (and are added to it). Returns the codes and how many numbers it went through. */
export function freshCodes(warehouseCode: string, start: number, count: number, taken: Set<string>) {
  const codes: string[] = [];
  let used = 0;
  while (codes.length < count) {
    const code = generatedCode(warehouseCode, start + used++);
    if (taken.has(code)) continue;
    taken.add(code);
    codes.push(code);
  }
  return { codes, used };
}
