// Pallet IDs (licence plates). Pure.
// Only what the seed needs for now; the rest of the contract (parseCode, ...) is added with the receiving form.

/** The code the warehouse gives a pallet that came without one: building code + 6 digits, "N1-000123". */
export function generatedCode(warehouseCode: string, n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new Error(`Pallet number must be a positive whole number (got ${n})`);
  return `${warehouseCode}-${String(n).padStart(6, "0")}`;
}
