// What a customer may see of the clerk's log. The office sees every line (model, tokens, cost);
// the portal does not: how much a message cost us or how much AI budget is left is not the customer's business.

import type { Step } from "./types";

// The model line ("… · 3 calls · 2,114 tokens · ≈ $0.004 · 4.2s"), the daily-limit line ("… ($3.00 of $3.00)")
// and anything else that carries a dollar amount or a token count. Euros stay: they are the customer's own bill.
const COST_LINE = /tokens?\b|≈\s*\$|\$\s?\d|\d\s?\$|daily AI limit|céntimo/i;

export function stepsForCustomer(steps: Step[]): Step[] {
  return steps.filter((s) => !COST_LINE.test(s.text));
}
