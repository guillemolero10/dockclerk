// Order lines of a draft. Units are the truth; the text and the pallet count are derived from them.
import { describeUnits, unitWordFor } from "@/lib/pallets/quantity";
import { messageUnits, unitsGrounded } from "./guard";
import type { OutboundLineDraft } from "./types";

type ItemInfo = { id: string; sku: string; description: string; unitsPerPallet: number; unit: "PALLET" | "BOX" | "BAG" };

/** The same line with other units: text and pallet positions follow. Somebody chose them, so nothing is left unconfirmed. */
export function withUnits(line: OutboundLineDraft, units: number): OutboundLineDraft {
  const { unconfirmed: _chosen, ...rest } = line;
  void _chosen;
  return { ...rest, units, pallets: Math.ceil(units / line.unitsPerPallet), text: describeUnits(units, line.unitsPerPallet, line.unitWord) };
}

/**
 * The model's quantity must come from the customer's words or from convert_quantity, like the figures of a reply.
 * If not, the line is marked and the draft asks the office (a yellow `units:<SKU>` doubt), as the rules do for any ambiguity.
 * `text` is subject + body of the message; `converted` are the units convert_quantity returned for this item in this conversation.
 */
export function checkModelUnits(line: OutboundLineDraft, text: string, converted: number[]): OutboundLineDraft {
  if (line.wholeOptions?.length) return line; // already a doubt, with options the code computed
  if (unitsGrounded(line.units, line.unitsPerPallet, text, converted)) return line;
  return { ...line, unconfirmed: { fromMessage: messageUnits(line.unitsPerPallet, text) } };
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
