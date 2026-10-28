// Order lines of a draft. Units are the truth; the text and the pallet count are derived from them.
import { describeUnits, unitWordFor } from "@/lib/pallets/quantity";
import type { OutboundLineDraft } from "./types";

type ItemInfo = { id: string; sku: string; description: string; unitsPerPallet: number; unit: "PALLET" | "BOX" | "BAG" };

/** The same line with other units: text and pallet positions follow. */
export function withUnits(line: OutboundLineDraft, units: number): OutboundLineDraft {
  return { ...line, units, pallets: Math.ceil(units / line.unitsPerPallet), text: describeUnits(units, line.unitsPerPallet, line.unitWord) };
}

export function buildLine(item: ItemInfo, units: number, availableUnits: number, wholeOptions?: number[]): OutboundLineDraft {
  const unitWord = unitWordFor(item.unit);
  return {
    itemId: item.id, sku: item.sku, description: item.description,
    units, requestedUnits: units, availableUnits, unitsPerPallet: item.unitsPerPallet, unitWord,
    text: describeUnits(units, item.unitsPerPallet, unitWord), pallets: Math.ceil(units / item.unitsPerPallet),
    ...(wholeOptions?.length ? { wholeOptions } : {}),
  };
}
