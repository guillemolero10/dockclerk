// Figures guard: a reply may only contain numbers that a tool returned (or that are in the message / today's date).
// Pure, so it can be tested without a database or a model.
//
// Spanish text writes "1.284,60 €" and "08/11"; tools return JSON such as 1284.6 and "2026-11-08".
// Both sides are reduced to the same canonical form (String(Number(x))) before they are compared.

/** "1.360" (Spanish thousands) is 1360 and "2,5" is 2.5. Every number of the text, canonical. */
export function figures(text: string): string[] {
  const t = text.replace(/(\d)\.(?=\d{3}(?!\d))/g, "$1");
  return (t.match(/\d+(?:,\d+)?/g) ?? []).map((n) => String(Number(n.replace(",", "."))));
}

/** Figures that count as known: the Spanish reading plus plain dot-decimals as JSON writes them (0.125, 30.24). */
export function knownFigures(texts: string[]): Set<string> {
  const known = new Set<string>();
  for (const text of texts) {
    for (const n of figures(text)) known.add(n);
    for (const m of text.matchAll(/(?<![\d.,])\d+\.\d+(?!\d|,\d|\.\d)/g)) known.add(String(Number(m[0])));
  }
  return known;
}

/** Figures of the answer that no source contains: empty means the answer is safe to show. */
export function inventedFigures(answer: string, sources: string[]): string[] {
  const known = knownFigures(sources);
  return figures(answer).filter((n) => !known.has(n));
}
