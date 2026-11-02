// Pick "Saving..." line (50fcc78) at 375 px + operator home skips NO_SHOW dock bookings. Localhost only. WRITES to the DB (reseed after).
//   LANG_RUN=es|en  E2E_OPERATOR_USER/PASS in env (never printed)  npx tsx --env-file=.env scripts/e2e-saving.ts
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { chromium, type Page } from "playwright-core";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("localhost only");
const L = process.env.LANG_RUN === "es" ? "es" : "en";
const DIR = process.env.E2E_SHOTS || join(homedir(), "dockclerk-e2e", "2026-11-02-saving");
mkdirSync(DIR, { recursive: true });
const db = new PrismaClient();
let n = 0, fails = 0;
const out = (ok: boolean | null, s: string) => { if (ok === false) fails++; console.log(`${ok === null ? "INFO" : ok ? "PASS" : "FAIL"}  [${L}] ${s}`); };
const shot = (p: Page, l: string) => p.screenshot({ path: join(DIR, `${L}-${String(++n).padStart(2, "0")}-${l}.png`), fullPage: true }).catch(() => undefined);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SAVING = L === "es" ? /Guardando/ : /Saving/;
const GO = L === "es" ? /Ve a .*escanea el palé/i : /Go to .*scan/i;
const CONFIRM = L === "es" ? /Pulsa el botón amarillo/i : /Tap the yellow button/i;
const now = (p: Page) => p.locator("p.bg-dock-yellow").first().innerText().then((s) => s.replace(/\s+/g, " ").trim()).catch(() => "(none)");

async function scanTyped(p: Page, code: string) { await p.keyboard.type(code); await p.keyboard.press("Enter"); }
async function firstStep(p: Page, id: string) {
  await p.goto(`${BASE}/operator/pick/${id}`, { waitUntil: "networkidle" }); await sleep(600);
  return {
    loc: (await p.locator("p.text-6xl").first().innerText().catch(() => "")).trim(),
    code: (await p.locator(".dock-card span.mono.font-bold").first().innerText().catch(() => "")).trim(),
    boxes: (await p.locator("p", { hasText: L === "es" ? /coge solo/i : /take only/i }).count()) > 0,
  };
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: L === "es" ? "es-ES" : "en-US" });
  await ctx.addCookies([{ name: "lang", value: L, url: BASE }]);
  const p = await ctx.newPage();
  await p.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await p.locator('input[name="username"]').fill(process.env.E2E_OPERATOR_USER!);
  await p.locator('input[name="password"]').fill(process.env.E2E_OPERATOR_PASS!);
  await Promise.all([p.waitForURL((u) => u.pathname !== "/", { timeout: 30_000 }), p.getByRole("button", { name: /^(Entrar|Sign in)/ }).click()]);

  // find REQUESTED outbounds whose first step is a whole pallet with an ID
  const outs = await db.outbound.findMany({ where: { status: "REQUESTED" }, orderBy: { number: "asc" }, take: 8 });
  const cand: { id: string; st: Awaited<ReturnType<typeof firstStep>> }[] = [];
  for (const o of outs) { const st = await firstStep(p, o.id); if (st.code && !st.boxes) cand.push({ id: o.id, st }); if (cand.length === 2) break; }
  out(cand.length >= 2, `found ${cand.length} outbounds with a whole pallet with ID as first step`);
  if (cand.length < 2) { await browser.close(); process.exit(1); }

  // ---- A. slow POST: the line must say Saving while pending
  {
    const { id, st } = cand[0];
    await firstStep(p, id);
    out(GO.test(await now(p)), `A0 before scan: "${await now(p)}"`);
    await p.route("**/*", async (route) => {
      const r = route.request();
      if (r.method() === "POST" && r.headers()["next-action"]) await sleep(4000);
      return route.continue();
    });
    await scanTyped(p, st.code);
    await sleep(1200);
    const t1 = await now(p);
    await shot(p, "A-saving");
    out(SAVING.test(t1), `A1 just after scan (POST delayed 4 s): "${t1}"`);
    out(!CONFIRM.test(t1), `A2 no "tap the yellow button" text while saving`);
    out((await p.getByRole("button", { name: L === "es" ? /^Recogido/ : /^Picked/ }).count()) === 0, "A3 no yellow confirm button for a whole pallet with ID");
    await sleep(6000);
    await p.unroute("**/*");
    const row = await db.stock.findFirst({ where: { palletCode: st.code }, select: { outboundId: true } });
    out(row?.outboundId === id, `A4 pallet ${st.code} saved to the outbound`);
    await shot(p, "A-after");
  }

  // ---- B. refusal: another operator took the pallet first
  {
    const { id, st } = cand[1];
    await firstStep(p, id);
    const other = await db.outbound.findFirst({ where: { id: { not: id }, status: "REQUESTED" } });
    await db.stock.updateMany({ where: { palletCode: st.code }, data: { outboundId: other!.id } });
    await p.route("**/*", async (route) => {
      const r = route.request();
      if (r.method() === "POST" && r.headers()["next-action"]) await sleep(2500);
      return route.continue();
    });
    await scanTyped(p, st.code);
    await sleep(800);
    const t1 = await now(p);
    await shot(p, "B-saving");
    out(SAVING.test(t1), `B1 while pending: "${t1}"`);
    await sleep(5000);
    await p.unroute("**/*");
    const t2 = await now(p);
    const err = await p.locator('[role="alert"], p.text-dock-red').first().innerText().catch(() => "");
    await shot(p, "B-refused");
    out(!!err, `B2 error shown: "${err.slice(0, 120)}"`);
    out(GO.test(t2) && t2.includes(st.code), `B3 after refusal the line is back to scan: "${t2}"`);
    out(!SAVING.test(t2) && !CONFIRM.test(t2), "B4 not stuck in Saving / no yellow-button text");
    // the field must take another scan (cursor back)
    const focused = await p.evaluate(() => document.activeElement?.getAttribute("enterkeyhint") === "go");
    out(focused, "B5 cursor back in the scan field");
    await db.stock.updateMany({ where: { palletCode: st.code }, data: { outboundId: null } });
    await scanTyped(p, st.code); await sleep(3500);
    const row = await db.stock.findFirst({ where: { palletCode: st.code }, select: { outboundId: true } });
    out(row?.outboundId === id, `B6 rescan after the other operator's pick is undone works (${row?.outboundId === id})`);
  }

  // ---- C. manual confirm keeps the yellow button; boxes step (when there is one) too
  {
    const { id } = cand[0];
    const o3 = await db.outbound.findMany({ where: { status: "REQUESTED" }, orderBy: { number: "asc" }, take: 12 });
    const o = o3.find((x) => x.id !== cand[0].id && x.id !== cand[1].id)!;
    await firstStep(p, o.id);
    await p.getByRole("button", { name: L === "es" ? /confirmar a mano/i : /confirm by hand/i }).click().catch(() => undefined);
    await sleep(500);
    const t = await now(p); await shot(p, "C-manual");
    const btn = await p.getByRole("button", { name: L === "es" ? /^Recogido/ : /^Picked/ }).count();
    out(btn > 0 && !SAVING.test(t), `C1 manual confirm: yellow button present, Now = "${t}"`);
    // boxes step anywhere?
    let boxes = 0;
    for (const x of o3) { await p.goto(`${BASE}/operator/pick/${x.id}`, { waitUntil: "networkidle" }); if ((await p.locator("p", { hasText: L === "es" ? /coge solo/i : /take only/i }).count()) > 0) { boxes++; await shot(p, "C-boxes-first"); } }
    out(null, `outbounds with a boxes step as the current step: ${boxes}`);
    void id;
  }
  await browser.close();
  console.log(fails ? `FAILS: ${fails}` : "ALL PASS");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
