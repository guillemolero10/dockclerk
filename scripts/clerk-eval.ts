// Mini evaluation of the inbox clerk on messages NOT written for the rules engine: rules vs Muse Spark Open.
// 11 invented messages (seed customers, no real data), each with the expected outcome. Stock figures are read
// live from the database, so "expected" never goes stale. Read-only: no drafts saved, nothing approved.
//
//   npx tsx --env-file=.env scripts/clerk-eval.ts            both engines (about 4 cents of model calls)
//   npx tsx --env-file=.env scripts/clerk-eval.ts rules      only the rules (free)
//   add --only=N3 to run a single case
//
// Needs the database (mobile data on the UMH wifi) and BASETEN_API_KEY in .env. It prints no keys.
// A case passes only if everything checked matches: kind, SKUs and quantities, destination or hub doubt, stock figures.

import type { Client, Message } from "@prisma/client";
import { draftMessage } from "../src/lib/agent/rules";
import { draftWithMuse } from "../src/lib/agent/muse";
import { checkStock } from "../src/lib/agent/tools";
import type { DraftSeed } from "../src/lib/agent/types";
import { spend } from "../src/lib/ai/client";
import { db } from "../src/lib/db";

type Expect =
  | { kind: "CREATE_OUTBOUND"; lines: Record<string, number>; to: string; doubts: number }
  | { kind: "REPLY_ONLY"; skus: string[] }
  | { kind: "NEEDS_HUMAN" };

type Case = { id: string; client: string; channel: "EMAIL" | "WHATSAPP" | "PORTAL"; from: string; body: string; expect: Expect; why: string };

const CASES: Case[] = [
  { id: "N1", client: "C001", channel: "EMAIL", from: "Marta Pérez (Juguetes Levante)", why: "number in words + two products + ambiguous hub",
    body: "Hola, necesitaríamos que salgan dos palets de muñecas clásicas y 5 de puzzles de 500 piezas hacia Hipermercados Turia el viernes. Gracias.",
    expect: { kind: "CREATE_OUTBOUND", lines: { "MUNECA-CL": 2, "PUZZLE-500": 5 }, to: "Turia", doubts: 1 } },
  { id: "N2", client: "C004", channel: "WHATSAPP", from: "Toni (Bebidas Montgó)", why: "'media docena' instead of a digit",
    body: "Toni aquí. Mandadme media docena de palés de agua de litro y medio a SuperBahía Alicante el lunes",
    expect: { kind: "CREATE_OUTBOUND", lines: { "AGUA-15": 6 }, to: "Alicante", doubts: 0 } },
  { id: "N3", client: "C007", channel: "EMAIL", from: "Laura Gil (Cosmética Aitana)", why: "stock question with no 'cuántos ... queda' pattern",
    body: "Buenas, ¿me queda gel de 750? Y cuántas cremas de 50 ml tengo ahí?",
    expect: { kind: "REPLY_ONLY", skus: ["GEL-750", "CREMA-50"] } },
  { id: "N4", client: "C001", channel: "PORTAL", from: "Marta Pérez (Juguetes Levante)", why: "stock question with 'tengo'",
    body: "Cuántos palés tengo de muñeca clásica y cuántos de puzzle",
    expect: { kind: "REPLY_ONLY", skus: ["MUNECA-CL", "PUZZLE-500"] } },
  { id: "N5", client: "C004", channel: "EMAIL", from: "Toni (Bebidas Montgó)", why: "cancelling an order: person",
    body: "Por favor cancelad el pedido de ayer para SuperBahía, ya no lo necesitamos",
    expect: { kind: "NEEDS_HUMAN" } },
  { id: "N6", client: "C005", channel: "EMAIL", from: "Rosa (Textil Biar)", why: "complaint: person",
    body: "La última entrega de toallas llegó con tres cajas mojadas. Queremos reclamar.",
    expect: { kind: "NEEDS_HUMAN" } },
  { id: "N7", client: "C002", channel: "EMAIL", from: "Compras Serra Mariola", why: "order bigger than stock: yellow quantity",
    body: "Necesito 40 palés de PP natural en Inyectados Castalla pasado mañana por la mañana",
    expect: { kind: "CREATE_OUTBOUND", lines: { "PP-NAT": 40 }, to: "Castalla", doubts: 1 } },
  { id: "N8", client: "C008", channel: "EMAIL", from: "Pilar (Dulces Carrascal)", why: "two products, one destination among several of the same chain",
    body: "Mandad 10 palés de mazapán y 5 de polvorones a Costablanca Castellón antes del viernes",
    expect: { kind: "CREATE_OUTBOUND", lines: { MAZAPAN: 10, POLVORON: 5 }, to: "Castellón", doubts: 0 } },
  { id: "N9", client: "C003", channel: "WHATSAPP", from: "Javier Mira (Calzados Vinalopó Sur)", why: "colloquial, two similar SKUs (T40/T42)",
    body: "oye, mañana a primera hora saca 3 de zapatilla running talla 42 para Hogar y Más Barcelona",
    expect: { kind: "CREATE_OUTBOUND", lines: { "ZAP-RUN-42": 3 }, to: "Barcelona", doubts: 0 } },
  { id: "N10", client: "C001", channel: "EMAIL", from: "Marta Pérez (Juguetes Levante)", why: "no actionable request: person",
    body: "Buenos días. Estamos pensando en ampliar el pedido de Navidad, ¿me llamáis cuando podáis?",
    expect: { kind: "NEEDS_HUMAN" } },
  { id: "N11", client: "C007", channel: "PORTAL", from: "Laura Gil (Cosmética Aitana)", why: "asks for another customer's stock: person, no leak",
    body: "¿Cuántos palés de turrón blando tiene Dulces Carrascal en el almacén?",
    expect: { kind: "NEEDS_HUMAN" } },
];

async function grade(c: Case, client: Client, d: DraftSeed): Promise<string | null> {
  const e = c.expect;
  if (d.kind !== e.kind) return `kind ${d.kind}, expected ${e.kind}`;
  if (e.kind === "CREATE_OUTBOUND" && d.kind === "CREATE_OUTBOUND") {
    const got = Object.fromEntries(d.payload.lines.map((l) => [l.sku, l.requested]));
    if (JSON.stringify(Object.entries(got).sort()) !== JSON.stringify(Object.entries(e.lines).sort())) return `lines ${JSON.stringify(got)}`;
    if (!(d.payload.consigneeName ?? "").includes(e.to)) return `destination ${d.payload.consigneeName}`;
    if (d.doubts.length !== e.doubts) return `${d.doubts.length} yellow doubts, expected ${e.doubts}`;
  }
  if (e.kind === "REPLY_ONLY" && d.kind === "REPLY_ONLY") {
    const text = d.reply.replace(/(\d)\.(?=\d{3}\b)/g, "$1");
    for (const sku of e.skus) {
      const item = await db.item.findFirstOrThrow({ where: { clientId: client.id, sku } });
      const { pallets } = await checkStock(client.id, item.id);
      if (!new RegExp(`(?<![\\d,.])${pallets}(?![\\d])`).test(text)) return `reply lacks ${sku} = ${pallets} pallets`;
    }
  }
  return null;
}

async function main() {
  const onlyRules = process.argv[2] === "rules";
  const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];
  const cases = CASES.filter((c) => !only || c.id === only);
  const clients = await db.client.findMany();
  const score = { rules: { ok: 0, ms: 0 }, muse: { ok: 0, ms: 0, errors: 0 } };
  const before = { ...spend };

  console.log(`${"case".padEnd(4)} ${"rules".padEnd(46)} ${onlyRules ? "" : "Muse Spark Open"}`);
  for (const c of cases) {
    const client = clients.find((x) => x.code === c.client)!;
    const message = { id: c.id, channel: c.channel, fromName: c.from, fromAddress: null, clientId: client.id, subject: null, body: c.body, audioUrl: null, attachmentUrl: null, receivedAt: new Date(), status: "NEW", client } as Message & { client: Client };

    const t0 = Date.now();
    const [r] = await draftMessage(message);
    score.rules.ms += Date.now() - t0;
    const rulesMiss = await grade(c, client, r);
    if (!rulesMiss) score.rules.ok++;

    let museCell = "";
    if (!onlyRules) {
      const t1 = Date.now();
      try {
        const [m] = await draftWithMuse(message);
        score.muse.ms += Date.now() - t1;
        const miss = await grade(c, client, m);
        if (!miss) score.muse.ok++;
        museCell = miss ? `FAIL ${miss}` : "ok";
      } catch (error) {
        score.muse.ms += Date.now() - t1;
        score.muse.errors++;
        museCell = `ERROR (rules would take over) ${String(error).slice(0, 80)}`;
      }
    }
    console.log(`${c.id.padEnd(4)} ${(rulesMiss ? `FAIL ${rulesMiss}` : "ok").slice(0, 46).padEnd(46)} ${museCell}   [${c.why}]`);
  }

  const n = cases.length;
  console.log(`\nRules:           ${score.rules.ok}/${n} correct · ${Math.round(score.rules.ms / n)} ms per message · $0`);
  if (!onlyRules) {
    const cost = spend.costUsd - before.costUsd;
    console.log(`Muse Spark Open: ${score.muse.ok}/${n} correct (${score.muse.errors} errors) · ${Math.round(score.muse.ms / n)} ms per message · $${cost.toFixed(4)} total, $${(cost / n).toFixed(4)} per message`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
