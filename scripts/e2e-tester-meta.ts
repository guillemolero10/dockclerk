// Tester of de46d02 (Meta API direct): PDA receive with the pallet-ID delivery note + load photo, in a real browser against a LOCAL server.
// Localhost only. WRITES to the database (one inbound received) and SPENDS about 0.02 $: reseed before and after.
//   E2E_OPERATOR_USER/PASS in the environment (never printed). LABEL=meta|nometa|metabad names the screenshots.
//   npx tsx --env-file=.env scripts/e2e-tester-meta.ts
// Expects: the note photo prefilled with 5 pallets, the mixed JLV-MIX-0107 and the IDs on the note; the load photo counts 12 boxes with box 7 damaged;
// the receipt and AiSpend carry the calls. Photos in E2E_NOTE and E2E_LOAD, evidence in E2E_SHOTS.
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { chromium, type Page } from "playwright-core";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3100").replace(/\/$/, "");
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) throw new Error("localhost only");
const LABEL = process.env.LABEL || "run";
const NOTE = process.env.E2E_NOTE || join(homedir(), "dockclerk-e2e", "2026-10-31-matriculas", "albaran-matriculas.jpg");
const LOAD = process.env.E2E_LOAD || join(homedir(), "dockclerk-e2e", "2026-10-30-fotos", "boxes.jpg");
const SHOTS = process.env.E2E_SHOTS || join(homedir(), "dockclerk-e2e", "2026-10-31-tester-meta");
mkdirSync(SHOTS, { recursive: true });
const db = new PrismaClient();
const problems: string[] = [];
let failed = 0;
const out = (ok: boolean | null, s: string) => { if (ok === false) failed++; console.log(`${ok === null ? "INFO" : ok ? "PASS" : "FAIL"}  ${s}`); };
let n = 0;
const shot = (p: Page, l: string) => p.screenshot({ path: join(SHOTS, `${LABEL}-${String(++n).padStart(2, "0")}-${l}.png`), fullPage: true });
const secs = (t: number) => ((Date.now() - t) / 1000).toFixed(1) + " s";
const flat = async (p: Page) => (await p.locator("body").innerText()).replace(/\s+/g, " ");
const spend = async () => {
  const r = await db.aiSpend.findMany({ orderBy: { day: "desc" }, take: 1 });
  return { calls: r[0]?.calls ?? 0, micro: r[0]?.costMicroUsd ?? 0 };
};

(async () => {
  const before = await spend();
  const inbound = await db.inbound.findFirstOrThrow({ where: { client: { code: "C001" }, status: "EXPECTED", appointment: { isNot: null } }, orderBy: { date: "asc" }, include: { warehouse: true } });
  out(null, `[${LABEL}] using inbound Nº ${inbound.number} (${inbound.warehouse?.code})`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on("console", (m) => m.type() === "error" && !/favicon/i.test(m.text()) && problems.push(`console: ${m.text().slice(0, 200)}`));
  p.on("pageerror", (e) => problems.push(`pageerror: ${String(e.message).slice(0, 200)}`));
  p.on("response", (r) => r.status() >= 500 && problems.push(`HTTP ${r.status()} ${r.url().replace(BASE, "")}`));
  await p.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await p.locator('input[name="username"]').fill(process.env.E2E_OPERATOR_USER || "operario");
  await p.locator('input[name="password"]').fill(process.env.E2E_OPERATOR_PASS!);
  await Promise.all([p.waitForURL((u) => u.pathname !== "/", { timeout: 30_000 }), p.getByRole("button", { name: /^Sign in/ }).click()]);
  await p.goto(`${BASE}/operator/receive/${inbound.id}`, { waitUntil: "networkidle" });
  const truck = p.getByRole("button", { name: /truck is at the dock/i });
  if (await truck.count()) { await truck.click(); await p.getByText("Delivery note").first().waitFor({ timeout: 30_000 }); }
  await shot(p, "start");

  // (a) the note
  let t = Date.now();
  await p.locator('input[type="file"]').nth(0).setInputFiles(NOTE);
  await p.waitForFunction(() => /read by muse spark|typed by/i.test(document.body.innerText) && !/reading it/i.test(document.body.innerText), null, { timeout: 150_000 }).catch(() => out(false, "note: not read after 150 s"));
  await p.waitForTimeout(2500);
  out(null, `note photo took ${secs(t)}`);
  await shot(p, "after-note");
  const rec1 = await db.dockReceipt.findUnique({ where: { inboundId: inbound.id } });
  const nd = (rec1?.noteData ?? []) as { sku: string; lot?: string | null; pallets?: number; units?: number; palletCodes?: string[] | null }[];
  out(null, `noteData: ${JSON.stringify(nd.map((l) => [l.sku, l.lot, l.pallets, l.units, l.palletCodes]))} · notePallets ${rec1?.notePallets} · readBy ${rec1?.readBy}`);
  const codes = nd.flatMap((l) => l.palletCodes ?? []);
  const want = ["GMV-004101", "GMV-004102", "GMV-004103", "JLV-MIX-0107"];
  out(want.every((c) => codes.includes(c)), `IDs read from the note: ${[...new Set(codes)].join(", ")}`);
  const rb = await flat(p);
  out(want.every((c) => rb.includes(c)), "PDA list shows the IDs read");
  out(/MIXED/.test(rb) && rb.includes("JLV-MIX-0107"), "PDA shows JLV-MIX-0107 as MIXED");
  const footer = rb.match(/\d+ lines? · \d+ pallets?[^C]*/)?.[0];
  out(/5 pallets/.test(footer ?? ""), `footer: ${footer}`);
  out(rec1?.notePallets === 5, `notePallets = ${rec1?.notePallets} (want 5)`);
  const w1 = await p.evaluate(() => document.documentElement.scrollWidth);
  out(w1 <= 376, `375 px after note: scrollWidth ${w1}`);

  // (b) the load
  t = Date.now();
  await p.locator('input[type="file"]').last().setInputFiles(LOAD);
  await p.waitForFunction(() => /found \d+ boxes|Counting needs|kept for the receipt/i.test(document.body.innerText), null, { timeout: 150_000 }).catch(() => out(false, "load: nothing after 150 s"));
  await p.waitForTimeout(2500);
  out(null, `load photo took ${secs(t)}`);
  await shot(p, "after-load");
  const rec2 = await db.dockReceipt.findUnique({ where: { inboundId: inbound.id } });
  const boxes = (rec2?.boxes as { damaged: boolean }[] | null) ?? [];
  const dmg = boxes.map((b, i) => (b.damaged ? i + 1 : 0)).filter(Boolean);
  out(null, `countedBy ${rec2?.countedBy} · pallets ${rec2?.countedPallets} · units ${rec2?.countedUnits} · boxes ${boxes.length} · damaged ${JSON.stringify(dmg)}`);
  out(boxes.length === 12 && dmg.length === 1 && dmg[0] === 7, `12 boxes, damaged no. 7 (got ${boxes.length}, ${JSON.stringify(dmg)})`);
  out(null, `screen: ${(await flat(p)).slice(0, 300)}`);

  // (c) confirm, receipt
  const confirm = p.getByRole("button", { name: /Confirm \d+ pallets?/i });
  out(null, `confirm button: ${await confirm.first().innerText().catch(() => "missing")}`);
  if (await confirm.count() && (await confirm.first().isEnabled())) {
    await confirm.first().click();
    await p.getByText(/pallets? received|Label these/i).first().waitFor({ timeout: 60_000 }).catch(() => out(false, "confirm: no 'received' text"));
    await shot(p, "confirmed");
    await p.goto(`${BASE}/receipts/${inbound.id}`, { waitUntil: "networkidle" });
    await shot(p, "receipt");
    const rc = await flat(p);
    console.log("RECEIPT", rc.slice(0, 1100));
    out(/Muse Spark|SAM/.test(rc), "receipt names the model(s) that read/counted");
  } else out(false, "confirm not usable");
  const after = await spend();
  out(null, `AiSpend today: +${after.calls - before.calls} calls, +${((after.micro - before.micro) / 1e6).toFixed(4)} $ (total ${after.calls} calls, ${(after.micro / 1e6).toFixed(4)} $)`);
  console.log("PROBLEMS", problems.length ? problems.join(" | ") : "none");
  out(problems.length === 0, "console/network clean");
  await browser.close();
  await db.$disconnect();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("SCRIPT ERROR", e); process.exit(1); });
