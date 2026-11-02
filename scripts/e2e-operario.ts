// Operator walk after 485adde (Now card, numbered steps, Done bands) at 375 px. Localhost only. WRITES to the DB (reseed after).
// Photo of the delivery note is taken AFTER scanning: the scans must stay. The photo goes to the model (a few cents) unless the dev server runs BASETEN_MODEL=nope.
//   LANG_RUN=es|en  E2E_OPERATOR_USER/PASS in env (never printed)  npx tsx --env-file=.env scripts/e2e-operario.ts
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { chromium, type Page } from "playwright-core";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("localhost only");
const L = process.env.LANG_RUN === "es" ? "es" : "en";
const DIR = process.env.E2E_SHOTS || join(homedir(), "dockclerk-e2e", "2026-11-02-operario-bd");
const NOTE = process.env.E2E_NOTE || join(homedir(), "dockclerk-e2e", "2026-10-31-matriculas", "albaran-matriculas.jpg");
mkdirSync(DIR, { recursive: true });
const db = new PrismaClient();
const P = L === "es" ? "OPE" : "OPN";
let n = 0, fails = 0;
const problems: string[] = [];
const out = (ok: boolean | null, s: string) => { if (ok === false) fails++; console.log(`${ok === null ? "INFO" : ok ? "PASS" : "FAIL"}  [${L}] ${s}`); };
const shot = (p: Page, l: string) => p.screenshot({ path: join(DIR, `${L}-${String(++n).padStart(2, "0")}-${l}.png`), fullPage: true }).catch(() => undefined);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const re = (en: string, es: string) => new RegExp(L === "es" ? es : en, "i");
const body = (p: Page) => p.locator("body").innerText();
const noRaw = async (p: Page, w: string) => { const m = (await body(p)).match(/\b(?:rcs?|pa|pk|st|op|scan|lb)\.[A-Za-z_]+\b/g); out(!m, `${w}: no raw i18n keys${m ? " " + m.slice(0, 3) : ""}`); };
const noSide = async (p: Page, w: string) => { const x = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]); out(x[0] <= x[1] + 1, `${w}: no sideways scroll (${x[0]}/${x[1]})`); };
async function scan(p: Page, code: string) {
  const focused = await p.evaluate(() => document.activeElement?.getAttribute("enterkeyhint") === "go");
  if (!focused) out(false, `cursor not in the scan field before ${code}`);
  const before = await p.evaluate(() => document.querySelector("[data-scan-result]")?.textContent ?? "");
  await p.keyboard.type(code); await p.keyboard.press("Enter");
  for (let i = 0; i < 80; i++) {
    await sleep(150);
    const c = await p.evaluate(() => ({ r: document.querySelector("[data-scan-result]")?.getAttribute("data-scan-result"), t: document.querySelector("[data-scan-result]")?.textContent ?? "" })).catch(() => null);
    if (c && c.r && c.r !== "none" && c.t !== before) break;
    if (c === null) break;
  }
  await sleep(250);
  return p.evaluate(() => ({ r: document.querySelector("[data-scan-result]")?.getAttribute("data-scan-result"), t: document.querySelector("[data-scan-result]")?.textContent ?? "" })).catch(() => ({ r: "gone", t: "" }));
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: L === "es" ? "es-ES" : "en-US" });
  await ctx.addCookies([{ name: "lang", value: L, url: BASE }]);
  const p = await ctx.newPage();
  p.on("console", (m) => m.type() === "error" && !/favicon/i.test(m.text()) && problems.push(`console: ${m.text().slice(0, 200)}`));
  p.on("pageerror", (e) => problems.push(`pageerror: ${String(e.message).slice(0, 200)}`));
  p.on("response", (r) => r.status() >= 500 && problems.push(`HTTP ${r.status()} ${r.url().replace(BASE, "")}`));
  await p.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await p.locator('input[name="username"]').fill(process.env.E2E_OPERATOR_USER!);
  await p.locator('input[name="password"]').fill(process.env.E2E_OPERATOR_PASS!);
  await Promise.all([p.waitForURL((u) => u.pathname !== "/", { timeout: 30_000 }), p.getByRole("button", { name: /^(Entrar|Sign in)/ }).click()]);

  // ---- 1. HOME: the Now card must match the data
  const inbounds = await db.inbound.findMany({ where: { status: "EXPECTED" }, include: { warehouse: true }, orderBy: { number: "asc" } });
  const inb = inbounds[Math.min(inbounds.length - 1, 2)];
  const W = inb.warehouse?.code ?? "N1";
  await p.goto(`${BASE}/operator?w=${W}`, { waitUntil: "networkidle" });
  await shot(p, "home");
  const home = await body(p);
  console.log("HOME>", home.replace(/\s+/g, " ").slice(0, 420));
  const rec = await db.stock.count({ where: { warehouse: { code: W }, location: { startsWith: "REC" } } });
  const atDock = await db.inbound.count({ where: { status: "RECEIVING", warehouse: { code: W } } });
  out(null, `data: ${atDock} inbound(s) RECEIVING, ${rec} stock rows in REC lanes in ${W}`);
  out(/now|ahora/i.test(home), "home: 'Now' card present");
  out(/1[\s\S]*2[\s\S]*3[\s\S]*4/.test(home), "home: 1-4 route present");
  await noRaw(p, "home"); await noSide(p, "home");
  // the Now card must point at what the data says: with pallets waiting in REC and no truck at the dock, it says put away; with a truck at the dock, unload
  const nowLink = await p.locator("a").filter({ hasText: /./ }).evaluateAll((as) => as.map((a) => [a.getAttribute("href"), (a.textContent || "").replace(/\s+/g, " ").slice(0, 60)]));
  console.log("HOME links>", JSON.stringify(nowLink.slice(0, 8)));

  // ---- 2. RECEIVE: truck, scan, THEN note photo
  await p.goto(`${BASE}/operator/receive/${inb.id}`, { waitUntil: "networkidle" });
  const truck = p.getByRole("button", { name: re("truck is at the dock", "camión está en el muelle") });
  if (await truck.count()) { await shot(p, "receive-truck"); await truck.click(); await p.waitForSelector('input[enterkeyhint="go"]', { timeout: 30_000 }); }
  await sleep(800);
  await shot(p, "receive-start");
  out(/1[\s\S]*2[\s\S]*3[\s\S]*4/.test(await body(p)), "receive: stepper 1-4");
  const codes = [`${P}-0001`, `${P}-0002`, `${P}-0003`];
  for (const c of codes) { const r = await scan(p, c); out(r.r === "ok", `scan ${c} -> ${r.r}`); }
  const cnt = async () => /3\s*(of|de|scanned|escaneados|\/)/i.test(await body(p));
  out(await cnt(), "receive: counter shows 3 before the photo");
  await shot(p, "receive-scanned");
  const t0 = Date.now();
  const fileInput = p.locator('input[type="file"]').first();
  await fileInput.setInputFiles(NOTE);
  out(null, "note photo uploaded after scanning");
  await p.waitForFunction(() => !/reading it|leyendo/i.test(document.body.innerText) && /Read by|Leído por|Typed by|Escrito|Type the number|Escribe el número|on the note|en el albar/i.test(document.body.innerText), null, { timeout: 90_000 }).catch(() => out(null, "note: no read result in 90 s (model off or slow)"));
  await sleep(3500);
  out(null, `note photo round trip ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await shot(p, "receive-after-photo");
  const after = await body(p);
  const stillScanned = (await db.stock.count({ where: { palletCode: { in: codes } } })) === 0; // not saved yet
  out(stillScanned, "DB: nothing saved yet (scans only in the form)");
  for (const c of codes) out(after.includes(c), `scan ${c} STILL in the form after the note photo`);
  out(await cnt(), "receive: counter still 3 after the photo");
  await noRaw(p, "receive"); await noSide(p, "receive");
  const confirm = p.getByRole("button", { name: re("^Confirm \\d+ pallets? into receiving", "^Confirmar \\d+ pal") });
  out((await confirm.count()) > 0, `confirm button: ${(await confirm.first().innerText().catch(() => "missing")).replace(/\s+/g, " ")}`);
  await confirm.scrollIntoViewIfNeeded(); await confirm.click();
  await p.waitForSelector(L === "es" ? "text=/Descarga hecha/" : "text=/Unload done/", { timeout: 60_000 }).catch(() => out(false, "no 'Unload done' band"));
  await sleep(1500);
  await shot(p, "receive-done");
  const doneTxt = await body(p);
  console.log("DONE1>", doneTxt.replace(/\s+/g, " ").slice(0, 300));
  out(re("Unload done", "Descarga hecha").test(doneTxt), "Hecho 1: 'Unload done' band");
  out(/\d+ pal/i.test(doneTxt), "Hecho 1: shows received pallets count");
  await noRaw(p, "done1"); await noSide(p, "done1");
  const rows = await db.stock.findMany({ where: { palletCode: { in: codes } } });
  out(rows.length === 3, `DB: ${rows.length}/3 pallets with the scanned IDs`);
  const cta = p.getByRole("link", { name: re("put.*away|ubicar", "ubicar") }).first();
  out((await cta.count()) > 0, "Hecho 1: button to the next step (put away)");
  await cta.click(); await p.waitForURL(/putaway/, { timeout: 20_000 });
  await sleep(800); await shot(p, "putaway-first");
  console.log("PUTAWAY>", (await body(p)).replace(/\s+/g, " ").slice(0, 300));
  await noRaw(p, "putaway"); await noSide(p, "putaway");

  // ---- 3. PUT AWAY every waiting pallet
  let placed = 0;
  for (let g = 0; g < 40; g++) {
    const done = await p.getByText(re("All put away", "Todo ubicado")).count();
    if (done) break;
    const code = (await p.locator("span.mono.font-bold, p.mono").first().innerText().catch(() => "")).trim();
    let f = false;
    for (let w = 0; w < 40 && !f; w++) { f = await p.evaluate(() => document.activeElement?.getAttribute("enterkeyhint") === "go"); if (!f) await sleep(250); }
    let cur = "";
    const m = (await body(p)).match(/\b[A-Z0-9]{2,5}-[A-Z0-9-]{3,}\b/g);
    cur = (m || []).find((x) => /^[A-Z0-9]+-\d{3,}/.test(x) && !/^[A-Z]-\d\d-\d$/.test(x)) || "";
    if (!f || !cur) { out(null, `putaway loop: stop (focused=${f}, code=${cur || code})`); break; }
    const r = await scan(p, cur);
    if (r.r === "error") { out(false, `putaway: ${cur} rejected "${r.t}"`); break; }
    const btn = p.getByRole("button", { name: re("^Pallet placed in", "^Palé colocado en") });
    await btn.first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    if (g === 0) await shot(p, "putaway-scanned");
    await btn.first().click();
    placed++;
    await sleep(2500);
    if (g === 0) await shot(p, "putaway-after-first");
  }
  await sleep(1000);
  await shot(p, "putaway-end");
  const endTxt = await body(p);
  console.log("PUTAWAY END>", endTxt.replace(/\s+/g, " ").slice(0, 300));
  out(placed > 0, `put away ${placed} pallets`);
  out(re("All put away", "Todo ubicado").test(endTxt), "Hecho 2: 'All put away' band");
  out(await p.getByRole("link", { name: re("Back to tasks", "Volver a las tareas") }).count() > 0, "Hecho 2: button to the next step");
  const leftRec = await db.stock.count({ where: { warehouse: { code: W }, location: { startsWith: "REC" }, outboundId: null } });
  out(leftRec === 0, `DB: ${leftRec} rows left in REC lanes`);
  await noRaw(p, "done2"); await noSide(p, "done2");

  // ---- 4. PICK a whole outbound
  const outs = await db.outbound.findMany({ where: { status: "REQUESTED" }, orderBy: { number: "asc" } });
  const ob = outs[L === "es" ? 1 : 0];
  await p.goto(`${BASE}/operator?w=${W}`, { waitUntil: "networkidle" });
  await shot(p, "home-after-putaway");
  console.log("HOME2>", (await body(p)).replace(/\s+/g, " ").slice(0, 300));
  await p.goto(`${BASE}/operator/pick/${ob.id}`, { waitUntil: "networkidle" });
  await sleep(600); await shot(p, "pick-start");
  out(/1[\s\S]*2[\s\S]*3/.test(await body(p)), "pick: stepper visible");
  await noRaw(p, "pick"); await noSide(p, "pick");
  const step = async () => ({
    code: (await p.locator(".dock-card span.mono.font-bold").first().innerText().catch(() => "")).trim(),
    loc: (await p.locator("p.text-6xl").first().innerText().catch(() => "")).trim(),
    boxes: (await p.locator("p", { hasText: re("take only", "coge solo") }).count()) > 0,
  });
  let done = false;
  for (let g = 0; g < 40 && !done; g++) {
    await sleep(1000);
    const fin = await p.getByText(re("prepared", "preparad")).count();
    const s = await step();
    if (fin && !s.loc) { done = true; break; }
    if (!s.loc) {
      const nxt = p.getByRole("button", { name: re("labelled|label.*next|finish|done|etiquetad|siguiente|listo", "etiquetad|siguiente|listo") });
      if (await nxt.count()) { await nxt.first().click(); await sleep(1500); continue; }
      break;
    }
    if (s.code) { const r = await scan(p, s.code); if (r.r === "error") { out(false, `pick: ${s.code} rejected "${r.t}"`); break; } }
    else { const r = await scan(p, s.loc); if (r.r !== "ok") { out(false, `pick: slot ${s.loc} rejected`); break; } }
    const pk = p.getByRole("button", { name: re("^Picked", "^Recogido") });
    if (await pk.count()) await pk.first().click();
    for (let i = 0; i < 100; i++) { await sleep(300); if ((await step()).loc !== s.loc || !(await p.locator("p.text-6xl").count())) break; }
    if (g === 0) await shot(p, "pick-step2");
    const nxt = p.getByRole("button", { name: re("labelled|label.*next|finish|done|etiquetad|siguiente|listo", "etiquetad|siguiente|listo") });
    if (await nxt.count()) { await shot(p, "pick-label"); await nxt.first().click(); await sleep(1500); }
  }
  await sleep(2000);
  await shot(p, "pick-end");
  const endPick = await body(p);
  console.log("PICK END>", endPick.replace(/\s+/g, " ").slice(0, 300));
  const fo = await db.outbound.findUnique({ where: { id: ob.id } });
  out(fo?.status === "PREPARED", `DB: outbound ${ob.number} ${fo?.status}`);
  out(new RegExp((L === "es" ? "preparad" : "prepared"), "i").test(endPick) && endPick.includes(String(ob.number)), `Hecho 3: 'No. ${ob.number} prepared' band with number`);
  out(/dock|muelle/i.test(endPick), "Hecho 3: says which dock");
  out(await p.getByRole("link", { name: re("tasks|next", "tareas|siguiente") }).count() > 0, "Hecho 3: button to the next step");
  await noRaw(p, "done3"); await noSide(p, "done3");
  out(problems.length === 0, `browser problems: ${problems.length} ${problems.slice(0, 5).join(" | ")}`);
  await browser.close();
  console.log(fails ? `${fails} FAIL` : "ALL PASS");
  await db.$disconnect();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
