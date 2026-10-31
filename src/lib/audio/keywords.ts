// Words handed to the voice model as `keywords` so it spells our customers and articles right ("Bebidas Montgó", not "bebidas mogo").
// Meta rejects the whole request with a 400 if one keyword is longer than 30 characters (tested 31/10/2026; 200 short ones are fine).

const GENERIC = ["palés", "palé", "cajas", "albarán", "lote", "muelle", "carretilla", "horchata"];
export const MAX_KEYWORD = 30;
export const MAX_KEYWORDS = 100;

export function voiceKeywords(hints: string[] = []): string[] {
  const clean = [...GENERIC, ...hints].map((h) => h.replace(/\s+/g, " ").trim()).filter((h) => h.length >= 3 && h.length <= MAX_KEYWORD);
  return [...new Set(clean)].slice(0, MAX_KEYWORDS);
}
