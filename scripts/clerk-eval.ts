// Mini evaluation of the inbox clerk on messages NOT written for the rules engine: rules vs Muse Spark Open.
// 17 invented messages (seed customers, no real data), each with the expected outcome. Stock figures are read
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
import { figures } from "../src/lib/agent/guard";
import { ymdOf, period } from "../src/lib/billing/calendar";
import { loadBilling } from "../src/lib/billing/load";
import type { DraftSeed } from "../src/lib/agent/types";
import { spend } from "../src/lib/ai/client";
import { db } from "../src/lib/db";

type Expect =
  // `lines` are pallets (units / units per pallet); `units` are exact units; `options` are the values of the yellow doubt per SKU.
  | { kind: "CREATE_OUTBOUND"; lines?: Record<string, number>; units?: Record<string, number>; options?: Record<string, string>; to: string; doubts: number }
  // `skus`: the reply carries the live stock of each. `bill`: the reply carries the figures of loadBilling (month so far, or the storage of one entry).
  | { kind: "REPLY_ONLY"; skus?: string[]; bill?: "amount" | "explain" }
  | { kind: "NEEDS_HUMAN" };

/** Things only the database knows, resolved once before the cases run. */
type Ctx = { inbound: number | null };

type Case = { id: string; client: string; channel: "EMAIL" | "WHATSAPP" | "PORTAL"; from: string; body: string | ((ctx: Ctx) => string); expect: Expect; why: string };

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
  // Quantities and the month's bill (palés/picos and pre-invoices). The figures never come from the model: units from convert_quantity, euros from bill_so_far.
  { id: "Q1", client: "C001", channel: "EMAIL", from: "Marta Pérez (Juguetes Levante)", why: "2,5 pallets → 100 units (2 palés + 20 cajas)",
    body: "Mandad 2,5 palés de PELUCHE-30 a SuperBahía Alicante el viernes",
    expect: { kind: "CREATE_OUTBOUND", units: { "PELUCHE-30": 100 }, to: "Alicante", doubts: 0 } },
  { id: "Q2", client: "C004", channel: "WHATSAPP", from: "Toni (Bebidas Montgó)", why: "'2 palés y medio' in words → 250 units",
    body: "Toni aquí. Mandadme 2 palés y medio de horchata a SuperBahía Alicante el lunes",
    expect: { kind: "CREATE_OUTBOUND", units: { "HORCH-1L": 250 }, to: "Alicante", doubts: 0 } },
  { id: "Q3", client: "C002", channel: "EMAIL", from: "Compras Serra Mariola", why: "1,5 pallets of 55 bags: yellow doubt 82/83",
    body: "Mandad 1,5 palés de PP natural a Inyectados Castalla el viernes",
    expect: { kind: "CREATE_OUTBOUND", units: { "PP-NAT": 82 }, options: { "PP-NAT": "82,83" }, to: "Castalla", doubts: 1 } },
  { id: "F1", client: "C001", channel: "EMAIL", from: "Marta Pérez (Juguetes Levante)", why: "how much so far this month: figures equal to loadBilling",
    body: "Buenas, ¿cuánto llevo de almacenaje este mes?",
    expect: { kind: "REPLY_ONLY", bill: "amount" } },
  { id: "F2", client: "C001", channel: "PORTAL", from: "Marta Pérez (Juguetes Levante)", why: "why this charge for one entry: the rows of that entry",
    body: (ctx) => `¿Por qué me cobráis tantos palés·día de la entrada ${ctx.inbound}?`,
    expect: { kind: "REPLY_ONLY", bill: "explain" } },
  { id: "F3", client: "C001", channel: "EMAIL", from: "Marta Pérez (Juguetes Levante)", why: "the seeded invoice message: a person",
    body: "Hola, no nos ha llegado la factura de septiembre, ¿nos la podéis reenviar?",
    expect: { kind: "NEEDS_HUMAN" } },
];

async function grade(c: Case, client: Client, d: DraftSeed, ctx: Ctx): Promise<string | null> {
  const e = c.expect;
  if (d.kind !== e.kind) return `kind ${d.kind}, expected ${e.kind}`;
  if (e.kind === "CREATE_OUTBOUND" && d.kind === "CREATE_OUTBOUND") {
    if (e.lines) {
      const got = Object.fromEntries(d.payload.lines.map((l) => [l.sku, l.requestedUnits / l.unitsPerPallet]));
      if (JSON.stringify(Object.entries(got).sort()) !== JSON.stringify(Object.entries(e.lines).sort())) return `lines ${JSON.stringify(got)}`;
    }
    if (e.units) {
      const got = Object.fromEntries(d.payload.lines.map((l) => [l.sku, l.requestedUnits]));
      if (JSON.stringify(Object.entries(got).sort()) !== JSON.stringify(Object.entries(e.units).sort())) return `units ${JSON.stringify(got)}`;
    }
    for (const [sku, values] of Object.entries(e.options ?? {})) {
      const doubt = d.doubts.find((x) => x.field === `units:${sku}`);
      if (!doubt || doubt.options.map((o) => o.value).join() !== values) return `doubt for ${sku}: ${doubt ? doubt.options.map((o) => o.value).join() : "missing"}, expected ${values}`;
    }
    if (!(d.payload.consigneeName ?? "").includes(e.to)) return `destination ${d.payload.consigneeName}`;
    if (d.doubts.length !== e.doubts) return `${d.doubts.length} yellow doubts, expected ${e.doubts}`;
  }
  if (e.kind === "REPLY_ONLY" && d.kind === "REPLY_ONLY") {
    const text = d.reply.replace(/(\d)\.(?=\d{3}\b)/g, "$1");
    for (const sku of e.skus ?? []) {
      const item = await db.item.findFirstOrThrow({ where: { clientId: client.id, sku } });
      const { full: pallets } = await checkStock(client.id, item.id);
      if (!new RegExp(`(?<![\\d,.])${pallets}(?![\\d])`).test(text)) return `reply lacks ${sku} = ${pallets} pallets`;
    }
  }
  if (e.kind === "REPLY_ONLY" && d.kind === "REPLY_ONLY" && e.bill) {
    // The expected figures are computed here from the records, with the same function the tool uses.
    const today = ymdOf(new Date());
    const live = await loadBilling(client.id, period(`${today.slice(0, 7)}-01`, today));
    const said = new Set(figures(d.reply));
    const need = e.bill === "amount"
      ? { total: String(live.result.totalCents / 100), "pallet·days": String(live.result.palletDays) }
      : Object.fromEntries(live.result.detail.filter((r) => r.concept === "storage" && r.inboundNumber === ctx.inbound).map((r, i) => [`row ${i + 1} pallet·days`, String(r.palletDays)]));
    if (!Object.keys(need).length) return "no storage rows for that entry (is the seed there?)";
    const missing = Object.entries(need).filter(([, v]) => !said.has(v)).map(([k, v]) => `${k} ${v}`);
    if (missing.length) return `reply lacks ${missing.join(", ")}`;
  }
  return null;
}

async function main() {
  const onlyRules = process.argv[2] === "rules";
  const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];
  const cases = CASES.filter((c) => (!only || c.id === only));
  const clients = await db.client.findMany();
  // The entry of the seeded "23 → 21 + 2" case (C001, PUZZLE-500), found from the records so the case never goes stale.
  const todayYmd = ymdOf(new Date());
  const c001 = clients.find((x) => x.code === "C001")!;
  const sowed = (await loadBilling(c001.id, period(`${todayYmd.slice(0, 7)}-01`, todayYmd))).result.detail.find((r) => r.concept === "storage" && r.sku === "PUZZLE-500" && r.exitDate);
  const ctx: Ctx = { inbound: sowed?.inboundNumber ?? null };
  const score = { rules: { ok: 0, ms: 0 }, muse: { ok: 0, ms: 0, errors: 0 } };
  const before = { ...spend };

  console.log(`${"case".padEnd(4)} ${"rules".padEnd(46)} ${onlyRules ? "" : "Muse Spark Open"}`);
  for (const c of cases) {
    const client = clients.find((x) => x.code === c.client)!;
    const message = { id: c.id, channel: c.channel, fromName: c.from, fromAddress: null, clientId: client.id, subject: null, body: typeof c.body === "function" ? c.body(ctx) : c.body, audioUrl: null, attachmentUrl: null, receivedAt: new Date(), status: "NEW", client } as Message & { client: Client };

    const t0 = Date.now();
    const [r] = await draftMessage(message);
    score.rules.ms += Date.now() - t0;
    const rulesMiss = await grade(c, client, r, ctx);
    if (!rulesMiss) score.rules.ok++;

    let museCell = "";
    if (!onlyRules) {
      const t1 = Date.now();
      try {
        const [m] = await draftWithMuse(message);
        score.muse.ms += Date.now() - t1;
        const miss = await grade(c, client, m, ctx);
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
  // Exit 1 when any case fails (the model's errors count as failures too, they are not "correct").
  if (score.rules.ok < n || (!onlyRules && score.muse.ok < n)) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
