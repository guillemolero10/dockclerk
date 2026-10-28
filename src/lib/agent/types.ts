// Contract between the clerk (rules today, Muse Spark tomorrow) and the approval queue.
// Whatever produces drafts must return exactly this shape.

export type StepKind = "read" | "tool" | "ok" | "ask";

/** One line of the agent trace shown in the console panel. */
export type Step = { kind: StepKind; text: string };

/** A field the clerk is not sure about. The office picks one option before approving.
 * "consigneeId": which destination. "units:<SKU>": how many units to ship, when the quantity does not
 * come out in whole units or stock is short (option values are units). */
export type Doubt = {
  field: "consigneeId" | `units:${string}`;
  question: string;
  options: { label: string; value: string }[];
};

/** Units are the truth; pallets are derived (see src/lib/pallets/quantity.ts). */
export type OutboundLineDraft = {
  itemId: string;
  sku: string;
  description: string;
  /** Units to ship, a whole number above zero. */
  units: number;
  /** What the customer asked for, in units; `units` can end lower if stock is short. */
  requestedUnits: number;
  /** Units the customer has free right now, to warn before approving. */
  availableUnits: number;
  unitsPerPallet: number;
  /** "cajas", "sacos": how the customer counts this item. */
  unitWord: string;
  /** `units` as people say it: "2 palés + 50 cajas". */
  text: string;
  /** Pallet positions the shipment takes: ⌈units / unitsPerPallet⌉. */
  pallets: number;
  /** Set when the words did not give whole units (1,5 palés of 55 sacos): the two nearest whole numbers. */
  wholeOptions?: number[];
};

export type OutboundPayload = {
  clientId: string;
  clientName: string;
  consigneeId: string | null;
  consigneeName: string | null;
  deliverBy: string | null; // ISO date-time
  /** How the customer said it, for the reply: "antes de las 10:00", "por la mañana" or "". */
  deliverPhrase: string;
  clientDocRef: string | null;
  lines: OutboundLineDraft[];
};

export type ReplyPayload = { answer: string };
export type HumanPayload = { reason: string };

export type DraftSeed =
  | { kind: "CREATE_OUTBOUND"; payload: OutboundPayload; doubts: Doubt[]; steps: Step[]; reply: string }
  | { kind: "REPLY_ONLY"; payload: ReplyPayload; doubts: []; steps: Step[]; reply: string }
  | { kind: "NEEDS_HUMAN"; payload: HumanPayload; doubts: []; steps: Step[]; reply: null };
