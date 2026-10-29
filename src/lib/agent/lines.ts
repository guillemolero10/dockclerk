// Order lines of a draft. Units are the truth; the text and the pallet count are derived from them.
import { describeUnits, unitWordFor } from "@/lib/pallets/quantity";
import { readAmount, unitKind, type ConvertOutput } from "./convert";
import { amountInMessage, messageUnits, unitsGrounded, type ItemRef } from "./guard";
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
 * `text` is subject + body of the message; `converted` are the units convert_quantity vouched for this item in this conversation
 * (see `vouchConversion`); `catalog` are the customer's items, to tell which quantity of the message belongs to which line.
 */
export function checkModelUnits(line: OutboundLineDraft, text: string, converted: number[], catalog: ItemRef[] = []): OutboundLineDraft {
  if (line.wholeOptions?.length) return line; // already a doubt, with options the code computed
  const item = { sku: line.sku, description: line.description };
  if (unitsGrounded(line.units, line.unitsPerPallet, text, converted, item, catalog)) return line;
  return { ...line, unconfirmed: { fromMessage: messageUnits(line.unitsPerPallet, text, item, catalog) } };
}

/**
 * convert_quantity vouches for its result only if the model asked it to convert what the customer wrote for this item
 * ("2,5 palés" of horchata): an amount the model made up, or took from another line, does not make its units trustworthy.
 * Records the units in `converted` and says whether it did.
 */
export function vouchConversion(converted: Map<string, number[]>, item: ItemRef, out: ConvertOutput, amount: unknown, unit: unknown, text: string, catalog: ItemRef[]) {
  const n = readAmount(amount);
  if (n === null || !amountInMessage(n, unitKind(unit), text, item, catalog)) return false;
  converted.set(item.sku, [...(converted.get(item.sku) ?? []), ..."units" in out ? [out.units] : out.options.map((o) => o.units)]);
  return true;
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
