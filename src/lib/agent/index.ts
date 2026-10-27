// One entry point for the clerk: Muse Spark Open when it is configured and answers,
// the rules engine otherwise (also the plan B if the model fails during the demo).

import type { Client, Message } from "@prisma/client";
import { providers } from "@/lib/ai/client";
import { draftWithMuse } from "./muse";
import { draftMessage } from "./rules";
import type { DraftSeed } from "./types";

export async function runClerk(message: Message & { client: Client | null }): Promise<DraftSeed[]> {
  // Unknown senders and floor notes always go to a person; no model needed to say so.
  if (providers.agent() && message.client && message.channel !== "FLOOR") {
    try {
      return await draftWithMuse({ ...message, client: message.client });
    } catch (error) {
      console.error("Muse Spark Open failed, using the rules", error);
      const drafts = await draftMessage(message);
      drafts[0].steps.splice(1, 0, { kind: "ask", text: "model unavailable → rules engine (plan B)" });
      return drafts;
    }
  }
  const drafts = await draftMessage(message);
  drafts[0].steps.splice(1, 0, { kind: "tool", text: "brain → rules engine (plan B, no model key)" });
  return drafts;
}
