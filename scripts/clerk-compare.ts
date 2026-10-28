// Runs the five demo-video messages through the rules engine and through Muse Spark Open and prints both side by side.
// Read-only: it never saves drafts, approves anything or writes outbounds. It only calls the model (costs a few cents).
//
//   npx tsx --env-file=.env scripts/clerk-compare.ts            both engines
//   npx tsx --env-file=.env scripts/clerk-compare.ts muse       only Muse Spark Open
//   npx tsx --env-file=.env scripts/clerk-compare.ts rules      only the rules (no model call, no cost)
//   npx tsx --env-file=.env scripts/clerk-compare.ts clerk      the real entry point (runClerk): model first, rules if it fails.
//        Rehearse plan B: BASETEN_MODEL=nope or AGENT_TIMEOUT_MS=3500 or BASETEN_BASE_URL=https://x.invalid/v1 in front of the command.
//
//   --all      also the other ten messages of the inbox (extra traffic of the seed)
//   --only=1   only the message whose label starts with 1 (also 5b)     --repeat=3   run each message several times (stability)
//
// Needs the database (the hackathon wifi may block it: use mobile data) and BASETEN_API_KEY in .env.
// It prints no keys. Add `--json` to get the raw result of every message.

import { spend } from "../src/lib/ai/client";
import { runClerk } from "../src/lib/agent";
import { draftMessage } from "../src/lib/agent/rules";
import { draftWithMuse } from "../src/lib/agent/muse";
import type { DraftSeed } from "../src/lib/agent/types";
import { db } from "../src/lib/db";

// The five messages of the video (same text as prisma/seed.ts) + one control: the ambiguous one from a known customer.
const DEMO = [
  { label: "1 email pedido libre", match: "mañana mandad 12 palés" },
  { label: "2 voz WhatsApp (transcrita)", match: "agua de litro y medio" },
  { label: "3 stock PELUCHE-30", match: "me quedan de PELUCHE-30" },
  { label: "4 portal", match: "gel de 750" },
  { label: "5 ambiguo (número desconocido)", match: "lo de siempre" },
];

function summary(d: DraftSeed) {
  const base = { kind: d.kind, doubts: d.doubts.map((x) => x.question), reply: d.reply };
  if (d.kind === "CREATE_OUTBOUND") {
    const p = d.payload;
    return { ...base, to: p.consigneeName, deliverBy: p.deliverBy, phrase: p.deliverPhrase, lines: p.lines.map((l) => `${l.text} ${l.sku} (asked ${l.requestedUnits}, stock ${l.availableUnits} units)`) };
  }
  if (d.kind === "REPLY_ONLY") return { ...base, answer: d.payload.answer };
  return { ...base, reason: d.payload.reason };
}

async function main() {
  const which = ["muse", "rules", "clerk"].includes(process.argv[2]) ? process.argv[2] : "both";
  const raw = process.argv.includes("--json");
  const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const only = arg("only");
  const repeat = Math.max(1, Number(arg("repeat")) || 1);
  const results: unknown[] = [];

  const all = await db.message.findMany({ include: { client: true }, orderBy: { receivedAt: "asc" } });
  const cases = DEMO.map((c) => ({ ...c, message: all.find((m) => (m.body ?? "").includes(c.match)) }));
  // Control: the ambiguous text sent by a known customer, to see whether the model invents an order.
  const levante = all.find((m) => m.client?.code === "C001");
  const ambiguous = all.find((m) => (m.body ?? "").includes("lo de siempre"));
  if (levante && ambiguous) cases.push({ label: "5b ambiguo (cliente conocido)", match: "", message: { ...ambiguous, client: levante.client, clientId: levante.clientId } });

  if (process.argv.includes("--all")) {
    const demo = new Set(cases.map((c) => c.message?.id));
    all.filter((m) => !demo.has(m.id)).forEach((m, i) => cases.push({ label: `x${i + 1} ${(m.body ?? "").slice(0, 38)}…`, match: "", message: m }));
  }

  for (const c of cases.filter((c) => !only || c.label.startsWith(only)).flatMap((c) => Array.from({ length: repeat }, () => c))) {
    if (!c.message) {
      console.log(`\n### ${c.label}: not found in the database (reseed?)`);
      continue;
    }
    console.log(`\n### ${c.label}  [${c.message.channel} · ${c.message.client?.code ?? "sin cliente"}]\n> ${c.message.body}`);
    const row: Record<string, unknown> = { label: c.label };

    if (which === "clerk") {
      const t0 = Date.now();
      const [d] = await runClerk(c.message);
      row.clerk = { ms: Date.now() - t0, ...summary(d), steps: d.steps.map((s) => s.text) };
      console.log(`-- runClerk (${Date.now() - t0} ms):`, JSON.stringify(summary(d)));
      console.log("   steps:", d.steps.map((s) => `${s.kind}:${s.text}`).join(" | "));
      results.push(row);
      continue;
    }
    if (which !== "muse") {
      const t0 = Date.now();
      const [d] = await draftMessage(c.message);
      row.rules = { ms: Date.now() - t0, ...summary(d), steps: d.steps.map((s) => s.text) };
      console.log(`-- rules (${Date.now() - t0} ms):`, JSON.stringify(summary(d), null, 1));
    }
    if (which !== "rules" && c.message.client) {
      const before = { ...spend };
      const t0 = Date.now();
      try {
        const [d] = await draftWithMuse({ ...c.message, client: c.message.client });
        const ms = Date.now() - t0;
        const use = { calls: spend.calls - before.calls, tokensIn: spend.prompt - before.prompt, tokensOut: spend.completion - before.completion, reasoning: spend.reasoning - before.reasoning, costUsd: +(spend.costUsd - before.costUsd).toFixed(5) };
        row.muse = { ms, ...use, ...summary(d), steps: d.steps.map((s) => s.text) };
        console.log(`-- Muse Spark Open (${ms} ms, ${use.calls} calls, ${use.tokensIn}+${use.tokensOut} tok, $${use.costUsd}):`, JSON.stringify(summary(d), null, 1));
        console.log("   steps:", d.steps.map((s) => `${s.kind}:${s.text}`).join(" | "));
      } catch (error) {
        row.muse = { ms: Date.now() - t0, error: String(error) };
        console.log(`-- Muse Spark Open FAILED after ${Date.now() - t0} ms:`, String(error).slice(0, 300));
      }
    } else if (which !== "rules") {
      console.log("-- Muse Spark Open: not called (unknown sender goes to a person without a model, see agent/index.ts)");
    }
    results.push(row);
  }
  console.log(`\nTotal model spend: ${spend.calls} calls · ${spend.prompt} in + ${spend.completion} out tokens · $${spend.costUsd.toFixed(4)}`);
  if (raw) console.log(JSON.stringify(results, null, 1));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
