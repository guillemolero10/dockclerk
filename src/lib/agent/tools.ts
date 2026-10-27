// The clerk's tools: read-only lookups against the warehouse software.
// The rules engine calls them today; Muse Spark will call the same functions through tool calling.
import { db } from "@/lib/db";
import { madridDayRange } from "@/lib/format";

/** Lowercase, no accents, single spaces: "Bahía" and "bahia" compare equal. */
export function norm(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Destinations named in the text. Specific aliases ("Turia Quart") win over the bare chain name. */
export async function findConsignees(text: string) {
  const t = norm(text);
  const all = await db.consignee.findMany();
  const byAlias = all.filter((c) => c.aliases.some((a) => t.includes(norm(a))));
  if (byAlias.length > 0) return byAlias;
  return all.filter((c) => t.includes(norm(c.name.split("–")[0])));
}

const GENERIC = new Set(["caja", "cajas", "pack", "saco", "uds", "unidades", "granza", "surtida", "surtidos", "juego", "con"]);

function keywords(sku: string, description: string) {
  const words = norm(`${sku.replace(/-/g, " ")} ${description.replace(/\(.*?\)/g, "")}`)
    .split(/[^a-z0-9,]+/)
    .filter((w) => (w.length >= 3 || /\d/.test(w)) && !GENERIC.has(w));
  return [...new Set(words)];
}

// "litro y medio" is how people say 1,5 L.
const SYNONYMS: [RegExp, string][] = [[/litro y medio/g, "1,5"]];

/** Same word up to the ending: "toallas" ~ "toalla", "naranja" ~ "nar". */
function similar(a: string, b: string) {
  return a.startsWith(b.slice(0, 5)) || b.startsWith(a.slice(0, 5));
}

/** Best item of this customer for a free-text fragment such as "gel de 750" or "toallas blancas". */
export async function findItem(clientId: string, fragment: string) {
  let t = norm(fragment);
  for (const [re, rep] of SYNONYMS) t = t.replace(re, rep);
  const items = await db.item.findMany({ where: { clientId } });
  let best: (typeof items)[number] | null = null;
  let bestScore = 0;
  for (const item of items) {
    if (t.includes(norm(item.sku))) return item;
    const words = t.split(/[^a-z0-9,]+/).filter((w) => w.length >= 3 || /\d/.test(w));
    const score = keywords(item.sku, item.description).filter((k) => words.some((w) => similar(w, k))).length;
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Pallets and units of an item free to promise right now: what is on the shelves and not
 * picked yet, minus what open outbounds still have to pick (it stays on the shelf until then).
 */
export async function checkStock(clientId: string, itemId: string) {
  const [unpicked, ordered, pickedForOpen] = await Promise.all([
    db.stock.aggregate({ where: { clientId, itemId, outboundId: null }, _sum: { pallets: true, units: true } }),
    db.outboundLine.aggregate({ where: { itemId, outbound: { clientId, status: "REQUESTED" } }, _sum: { pallets: true, units: true } }),
    db.stock.aggregate({ where: { clientId, itemId, outbound: { status: "REQUESTED" } }, _sum: { pallets: true, units: true } }),
  ]);
  const stillToPick = {
    pallets: Math.max(0, (ordered._sum.pallets ?? 0) - (pickedForOpen._sum.pallets ?? 0)),
    units: Math.max(0, (ordered._sum.units ?? 0) - (pickedForOpen._sum.units ?? 0)),
  };
  return {
    pallets: Math.max(0, (unpicked._sum.pallets ?? 0) - stillToPick.pallets),
    units: Math.max(0, (unpicked._sum.units ?? 0) - stillToPick.units),
  };
}

/** Most recent shipment of this customer to a destination, if any in the last 10 days. */
export async function lastShipmentTo(clientId: string, consigneeIds: string[]) {
  const since = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  return db.outbound.findFirst({
    where: { clientId, consigneeId: { in: consigneeIds }, date: { gte: since } },
    orderBy: { date: "desc" },
    include: { consignee: true, lines: { include: { item: true } } },
  });
}

/** Inbounds of this customer in the current month. */
export async function inboundsThisMonth(clientId: string) {
  const firstOfMonth = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" }).slice(0, 8) + "01";
  const monthStart = madridDayRange(new Date(`${firstOfMonth}T12:00:00Z`)).start;
  return db.inbound.findMany({
    where: { clientId, date: { gte: monthStart } },
    orderBy: { date: "asc" },
    include: { lines: { include: { item: true } } },
  });
}
