// What the handheld's barcode reader types (it acts like a keyboard and ends with Enter). Pure.
import { parseCode } from "./codes";

/** Upper case, no spaces: the same cleaning for any scan. */
export const cleanScan = (raw: string) => String(raw ?? "").toUpperCase().replace(/\s+/g, "");

/** The text printed on a slot label: building code + slot ("N1-A-07-3"), because the same slot exists in every building. */
export const slotLabel = (warehouseCode: string, slot: string) => `${warehouseCode}-${slot}`;

/**
 * A slot label scanned in building `warehouseCode`. Accepts "A-07-3" (just the slot, inside its own building) and "N1-A-07-3".
 * `warehouse` is the building the label names (null if it names none); the caller refuses a label of another building.
 * Returns null if it is not a slot at all.
 */
export function parseSlotScan(raw: string, warehouseCode: string): { slot: string; warehouse: string | null } | null {
  const text = cleanScan(raw);
  const slotShape = /^(?:[A-Z]-\d{2}-\d|(?:REC|EXP)-\d{1,2})$/;
  if (slotShape.test(text)) return { slot: text, warehouse: null };
  const m = /^([A-Z0-9]{1,6})-(.+)$/.exec(text);
  if (m && slotShape.test(m[2])) return { slot: m[2], warehouse: m[1] === warehouseCode.toUpperCase() ? warehouseCode : m[1] };
  return null;
}

/** Two pallet IDs are the same pallet (case, spaces and a "(00)" prefix do not matter). Blank or invalid never match. */
export function sameCode(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = parseCode(a ?? "");
  const y = parseCode(b ?? "");
  return x.ok && y.ok && x.code !== null && x.code === y.code;
}
