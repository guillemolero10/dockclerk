// How the clerk matches the customer's words to the customer's items. Pure (no database), so the guard can use it too.

/** Lowercase, no accents, single spaces: "Bahía" and "bahia" compare equal. */
export function norm(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** The name people use for a company: "Bebidas Montgó, S.A." → "bebidas montgo" (no legal form, no punctuation). */
export function tradeName(name: string) {
  return norm(name)
    .replace(/,?\s*\b(s\.?\s?a\.?\s?u|s\.?\s?l\.?\s?u|s\.?\s?l|s\.?\s?a|s\.?\s?coop)\.?\s*$/, "")
    .replace(/[.,]+$/, "")
    .trim();
}

/** Whether a text names this company. Names that are too short once the legal form is gone ("S.L.", "Ca Sa") never match. */
export function mentionsCompany(text: string, name: string) {
  const trade = tradeName(name);
  return trade.length >= 4 && norm(text).includes(trade);
}

const GENERIC = new Set(["caja", "cajas", "pack", "saco", "uds", "unidades", "granza", "surtida", "surtidos", "juego", "con"]);

/** The words that name an item: its SKU parts and its description without what is in brackets. */
export function keywords(sku: string, description: string) {
  const words = norm(`${sku.replace(/-/g, " ")} ${description.replace(/\(.*?\)/g, "")}`)
    .split(/[^a-z0-9,]+/)
    .filter((w) => (w.length >= 3 || /\d/.test(w)) && !GENERIC.has(w));
  return [...new Set(words)];
}

// "litro y medio" is how people say 1,5 L.
export const SYNONYMS: [RegExp, string][] = [[/litro y medio/g, "1,5"]];

/** Same word up to the ending: "toallas" ~ "toalla", "naranja" ~ "nar". */
export function similar(a: string, b: string) {
  return a.startsWith(b.slice(0, 5)) || b.startsWith(a.slice(0, 5));
}

/** Score of a fragment that contains the item's SKU: nothing a keyword count can reach. */
export const SKU_SCORE = 100;

/**
 * How well a normalised fragment ("polvorones surtidos", "gel de 750") names an item: SKU_SCORE if it contains the SKU,
 * otherwise the number of the item's keywords it mentions. 0 = not this item.
 */
export function itemScore(fragment: string, item: { sku: string; description: string }) {
  if (fragment.includes(norm(item.sku))) return SKU_SCORE;
  const words = fragment.split(/[^a-z0-9,]+/).filter((w) => w.length >= 3 || /\d/.test(w));
  return keywords(item.sku, item.description).filter((k) => words.some((w) => similar(w, k))).length;
}
