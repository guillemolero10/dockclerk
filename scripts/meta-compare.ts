// Delivery-note reading: Muse Spark on the Meta Model API (muse-spark-1.3) against Muse Spark Open on Baseten.
// Same code path as the app (readDeliveryNote), so what you see here is what the PDA gets.
// Local only, no database, invented notes. It SPENDS model money (≈ 0.006 $ per reading, 16 readings ≈ 0.10 $).
//
//   npx tsx --env-file=.env scripts/meta-compare.ts            (2 runs per note and model)
//   RUNS=1 npx tsx --env-file=.env scripts/meta-compare.ts
//   FALLBACK=1 RUNS=0 ...                                       (Meta key broken on purpose: the reading must still come, from Baseten)
//   LOAD=1 npx tsx --env-file=.env scripts/meta-compare.ts     (also the load photo: SAM 3.1 + damage check, and Muse Spark alone)
//
// Needs META_API_KEY and BASETEN_API_KEY (never printed). Exit code 1 if a model fails to read a note.

import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { spend } from "../src/lib/ai/client";
import { countLoad, readDeliveryNote, type NoteReading } from "../src/lib/ai/vision";

const E2E = join(homedir(), "dockclerk-e2e");
type Line = { sku: string; lot: string | null; pallets: number | null; units: number; codes: string[] | null };
type Note = { name: string; file: string; customer: string; items: [string, string][]; docRef: string; totalPallets: number; lines: Line[] };

const TOYS: [string, string][] = [["MUNECA-CL", "Muñeca clásica con vestido"], ["PELUCHE-30", "Peluche oso 30 cm"], ["PELUCHE-50", "Peluche oso 50 cm"], ["PUZZLE-500", "Puzzle 500 piezas"]];
const MIX = "JLV-MIX-0107";
const matriculas: Pick<Note, "customer" | "items" | "docRef" | "totalPallets" | "lines"> = {
  customer: "Juguetes Levante, S.L.",
  items: TOYS,
  docRef: "ALB-2610-0388",
  totalPallets: 5,
  lines: [
    { sku: "PUZZLE-500", lot: "L2610A", pallets: 1, units: 48, codes: ["GMV-004101"] },
    { sku: "PUZZLE-500", lot: "L2610A", pallets: 1, units: 48, codes: ["GMV-004102"] },
    { sku: "PUZZLE-500", lot: "L2610A", pallets: 1, units: 48, codes: ["GMV-004103"] },
    { sku: "PELUCHE-30", lot: "L2610B", pallets: 1, units: 20, codes: [MIX] },
    { sku: "PUZZLE-500", lot: "L2610C", pallets: null, units: 30, codes: [MIX] },
    { sku: "PELUCHE-30", lot: "L2610B", pallets: 1, units: 36, codes: null },
  ],
};

const NOTES: Note[] = [
  { name: "A albaran.jpg (clean, Montgó)", file: join(E2E, "2026-10-30-fotos/albaran.jpg"), customer: "Bebidas Montgó, S.A.", items: [["AGUA-15", "Agua mineral 1,5 L"], ["HORCH-1L", "Horchata 1 L"]], docRef: "AL-2026-08817", totalPallets: 6, lines: [{ sku: "AGUA-15", lot: "L2610A", pallets: 4, units: 336, codes: null }, { sku: "HORCH-1L", lot: "H2610B", pallets: 2, units: 200, codes: null }] },
  { name: "B albaran2.jpg (clean, Aitana)", file: join(E2E, "2026-10-30-fotos/albaran2.jpg"), customer: "Cosmética Aitana, S.L.", items: [["CREMA-50", "Crema hidratante 50 ml"], ["GEL-750", "Gel de baño 750 ml"]], docRef: "CA-77412", totalPallets: 5, lines: [{ sku: "CREMA-50", lot: "C2610", pallets: 3, units: 270, codes: null }, { sku: "GEL-750", lot: "G2610", pallets: 2, units: 140, codes: null }] },
  { name: "C albaran-matriculas.jpg (IDs, mixed pallet)", file: join(E2E, "2026-10-31-matriculas/albaran-matriculas.jpg"), ...matriculas },
  { name: "D albaran-matriculas-foto.jpg (tilted, noisy, q55)", file: join(E2E, "2026-10-31-meta/albaran-matriculas-foto.jpg"), ...matriculas },
];

const RUNS = Number(process.env.RUNS ?? 2);
const sameCodes = (a: string[] | null | undefined, b: string[] | null) => JSON.stringify(a?.length ? a : null) === JSON.stringify(b);

function score(note: Note, r: (NoteReading & { lines: NoteReading["lines"] }) | null) {
  if (!r) return { fields: 0, total: 1, invented: 0, notes: ["no reading"] };
  const notes: string[] = [];
  let fields = 0;
  const total = 2 + note.lines.length * 5;
  let invented = 0;
  if (r.docRef === note.docRef) fields++; else notes.push(`docRef ${r.docRef}`);
  if (r.totalPallets === note.totalPallets) fields++; else notes.push(`total ${r.totalPallets}`);
  if (r.lines.length !== note.lines.length) notes.push(`${r.lines.length} lines (expected ${note.lines.length})`);
  note.lines.forEach((want, i) => {
    const got = r.lines[i];
    if (!got) return;
    const checks: [string, boolean][] = [["sku", got.sku === want.sku], ["lot", got.lot === want.lot], ["pallets", got.pallets === want.pallets], ["units", got.units === want.units], ["codes", sameCodes(got.palletCodes, want.codes)]];
    for (const [k, ok] of checks) { if (ok) fields++; else notes.push(`L${i + 1}.${k} ${JSON.stringify((got as Record<string, unknown>)[k === "codes" ? "palletCodes" : k])}`); }
    if (want.codes === null && got.palletCodes?.length) invented++;
  });
  return { fields, total, invented, notes };
}

type Row = { note: string; model: string; run: number; secs: number; costUsd: number; fields: number; total: number; invented: number; notes: string[] };

(async () => {
  if (!process.env.META_API_KEY || !process.env.BASETEN_API_KEY) {
    console.error("Needs META_API_KEY and BASETEN_API_KEY in the environment (use --env-file=.env).");
    process.exit(2);
  }
  const metaKey = process.env.META_API_KEY;
  const rows: Row[] = [];
  let failed = 0;
  for (const note of NOTES) {
    if (!existsSync(note.file)) { console.error(`missing ${note.file}`); process.exit(2); }
    const image = { mime: "image/jpeg", base64: readFileSync(note.file).toString("base64") };
    for (let run = 1; run <= RUNS; run++) {
      for (const model of ["meta", "baseten"] as const) {
        // providers.vision() reads the environment on every call: no META_API_KEY = Baseten.
        if (model === "meta") process.env.META_API_KEY = metaKey; else delete process.env.META_API_KEY;
        const before = spend.costUsd;
        const t = Date.now();
        const reading = await readDeliveryNote(image, { customer: note.customer, items: note.items.map(([sku, description]) => ({ sku, description })) });
        const s = score(note, reading);
        const row = { note: note.name, model: model === "meta" ? "muse-spark-1.3 (Meta)" : "Muse Spark Open (Baseten)", run, secs: (Date.now() - t) / 1000, costUsd: spend.costUsd - before, ...s };
        rows.push(row);
        console.log(`${row.note.padEnd(52)} ${row.model.padEnd(26)} #${run} ${row.fields}/${row.total} fields, invented IDs ${row.invented}, ${row.secs.toFixed(1)} s, $${row.costUsd.toFixed(4)}${row.notes.length ? "  WRONG: " + row.notes.join("; ") : ""}`);
      }
    }
  }
  console.log("\nSummary (all notes, all runs)");
  for (const model of ["muse-spark-1.3 (Meta)", "Muse Spark Open (Baseten)"]) {
    const m = rows.filter((r) => r.model === model);
    if (!m.length) continue;
    const f = m.reduce((a, r) => a + r.fields, 0);
    const t = m.reduce((a, r) => a + r.total, 0);
    const none = m.filter((r) => r.notes[0] === "no reading").length;
    failed += none;
    const secs = m.map((r) => r.secs).sort((a, b) => a - b);
    console.log(`${model.padEnd(28)} ${f}/${t} fields (${((100 * f) / t).toFixed(1)} %), no reading ${none}/${m.length}, invented IDs ${m.reduce((a, r) => a + r.invented, 0)}, median ${secs[Math.floor(secs.length / 2)].toFixed(1)} s, max ${secs[secs.length - 1].toFixed(1)} s, $${(m.reduce((a, r) => a + r.costUsd, 0) / m.length).toFixed(4)} per note`);
  }
  if (process.env.FALLBACK === "1") {
    process.env.META_API_KEY = "broken-on-purpose";
    const note = NOTES[0];
    const t = Date.now();
    const r = await readDeliveryNote({ mime: "image/jpeg", base64: readFileSync(note.file).toString("base64") }, { customer: note.customer, items: note.items.map(([sku, description]) => ({ sku, description })) });
    const ok = score(note, r).fields === 12;
    console.log(`${ok ? "PASS" : "FAIL"}  FALLBACK Meta key broken -> read by Baseten: ${r ? "12/12 fields" : "no reading"} in ${((Date.now() - t) / 1000).toFixed(1)} s`);
    if (!ok) failed++;
    process.env.META_API_KEY = metaKey;
  }
  if (process.env.LOAD === "1") {
    // boxes.jpg: 12 boxes on 1 pallet, box 7 (reading order) damaged. SAM path = SAM boxes + spotDamage by the vision model;
    // Muse-only path = SAM turned off (the plan B when Modal is down).
    const load = { mime: "image/jpeg", base64: readFileSync(join(E2E, "2026-10-30-fotos/boxes.jpg")).toString("base64") };
    const samKey = process.env.SAM_API_KEY;
    for (const sam of [true, false]) {
      for (const model of ["meta", "baseten"] as const) {
        if (model === "meta") process.env.META_API_KEY = metaKey; else delete process.env.META_API_KEY;
        if (sam) process.env.SAM_API_KEY = samKey; else delete process.env.SAM_API_KEY;
        const before = spend.costUsd;
        const t = Date.now();
        const r = await countLoad(load);
        const dmg = r?.boxes.map((b, i) => (b.damaged ? i + 1 : 0)).filter(Boolean);
        console.log(`LOAD ${sam ? "SAM + damage check" : "vision model alone"} ${model === "meta" ? "(damage by Meta)" : "(damage by Baseten)"}: by ${r?.by}, ${r?.boxes.length} boxes, ${r?.pallets} pallet(s), damaged ${JSON.stringify(dmg)}, ${((Date.now() - t) / 1000).toFixed(1)} s, $${(spend.costUsd - before).toFixed(4)}`);
      }
    }
  }
  console.log(`total spent in this run ≈ $${spend.costUsd.toFixed(3)}`);
  process.exit(failed ? 1 : 0);
})();
