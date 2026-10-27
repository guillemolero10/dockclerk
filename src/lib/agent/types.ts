// Contract between the clerk (rules today, Muse Spark tomorrow) and the approval queue.
// Whatever produces drafts must return exactly this shape.

export type StepKind = "read" | "tool" | "ok" | "ask";

/** One line of the agent trace shown in the console panel. */
export type Step = { kind: StepKind; text: string };

/** A field the clerk is not sure about. The office picks one option before approving.
 * "consigneeId": which destination. "pallets:<SKU>": how many to ship when stock is short. */
export type Doubt = {
  field: "consigneeId" | `pallets:${string}`;
  question: string;
  options: { label: string; value: string }[];
};

export type OutboundLineDraft = {
  itemId: string;
  sku: string;
  description: string;
  pallets: number;
  /** What the customer asked for; pallets can end lower if stock is short. */
  requested: number;
  unitsPerPallet: number;
  /** Pallets the customer has in stock right now, to warn before approving. */
  available: number;
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
