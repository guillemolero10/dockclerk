// PDA "reader first" walk (ScanField) at 375 px, simulating a handheld barcode reader: keyboard.type(code) + Enter, never clicking in the field.
// Localhost only. WRITES to the database (a delivery, a put-away, an outbound picked): reseed afterwards. Spends no model money (no photos).
//
//   set E2E_OFFICE_*/E2E_OPERATOR_*/E2E_CLIENT_* in the environment (never printed), BASETEN_MODEL=nope on the dev server.
//   LANG_RUN=en  npx tsx --env-file=.env scripts/e2e-lector.ts     full walk in English (inbound #1, outbound #1)
//   LANG_RUN=es  npx tsx --env-file=.env scripts/e2e-lector.ts     lighter walk in Spanish (inbound #2, outbound #2), no raw i18n keys
// Evidence in E2E_SHOTS (default ~/dockclerk-e2e/2026-11-01-lector-bd).
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { chromium, type Page } from "playwright-core";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("localhost only");
const L = process.env.LANG_RUN === "es" ? "es" : "en";
const DIR = process.env.E2E_SHOTS || join(homedir(), "dockclerk-e2e", "2026-11-01-lector-bd");
for (const k of ["E2E_OFFICE_USER", "E2E_OFFICE_PASS", "E2E_OPERATOR_USER", "E2E_OPERATOR_PASS", "E2E_CLIENT_USER", "E2E_CLIENT_PASS"]) if (!process.env[k]) throw new Error(`missing ${k}`);
mkdirSync(DIR, { recursive: true });

const db = new PrismaClient();
const idx = L === "es" ? 1 : 0;
const P = L === "es" ? "TSE" : "TST";
let n = 0;
let fails = 0;
const problems: string[] = [];
const out = (ok: boolean | null, s: string) => {
  if (ok === false) fails++;
  console.log(`${ok === null ? "INFO" : ok ? "PASS" : "FAIL"}  [${L}] ${s}`);
};
const shot = (p: Page, label: string) => p.screenshot({ path: join(DIR, `${L}-${String(++n).padStart(2, "0")}-${label}.png`), fullPage: true }).catch(() => undefined);
const watch = (p: Page, who: string) => {
  p.on("console", (m) => m.type() === "error" && !/favicon/i.test(m.text()) && problems.push(`[${who}] console: ${m.text().slice(0, 200)}`));
  p.on("pageerror", (e) => problems.push(`[${who}] pageerror: ${String(e.message).slice(0, 200)}`));
  p.on("response", (r) => r.status() >= 500 && problems.push(`[${who}] HTTP ${r.status()} ${r.url().replace(BASE, "")}`));
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function login(p: Page, user: string, pass: string) {
  await p.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await p.locator('input[name="username"]').fill(user);
  await p.locator('input[name="password"]').fill(pass);
  await Promise.all([p.waitForURL((u) => u.pathname !== "/", { timeout: 30_000 }), p.getByRole("button", { name: /^(Entrar|Sign in)/ }).click()]);
}
const scanInput = (p: Page) => p.locator('input[enterkeyhint="go"]').first();
const status = (p: Page) => p.locator("[data-scan-result]").first();
/** The reader: types the code and Enter with NO click first. Reports whether the cursor was already in the scan field. */
async function scan(p: Page, code: string, label: string) {
  const focused = await p.evaluate(() => document.activeElement?.getAttribute("enterkeyhint") === "go");
  if (!focused) out(false, `${label}: cursor was NOT in the scan field before scanning ${code}`);
  const before = await p.evaluate(() => document.querySelector("[data-scan-result]")?.textContent ?? "");
  await p.keyboard.type(code);
  await p.keyboard.press("Enter");
  // wait for the status to show something new (or the page to change)
  for (let i = 0; i < 80; i++) {
    await sleep(150);
    const cur = await p.evaluate(() => ({ r: document.querySelector("[data-scan-result]")?.getAttribute("data-scan-result"), t: document.querySelector("[data-scan-result]")?.textContent ?? "" })).catch(() => null);
    if (cur && cur.r && cur.r !== "none" && cur.t !== before) break;
    if (cur === null) break; // navigation
  }
  await sleep(250);
  const res = await status(p).evaluate((e) => ({ r: e.getAttribute("data-scan-result"), t: e.textContent ?? "" })).catch(() => ({ r: "gone", t: "" }));
  const back = await p.evaluate(() => document.activeElement?.getAttribute("enterkeyhint") === "go").catch(() => false);
  return { ...res, focusBack: back };
}
const expectRes = (r: { r: string | null; t: string }, kind: "ok" | "error", what: string) => out(r.r === kind, `${what} -> ${r.r} "${r.t.slice(0, 90)}"`);
const noRawKeys = async (p: Page, where: string) => {
  const txt = await p.locator("body").innerText();
  const raw = txt.match(/\b(?:rcs|pa|pk|scan|lb|op|rc)\.[A-Za-z_]+\b/g);
  out(!raw, `${where}: no raw i18n keys${raw ? " " + raw.slice(0, 3).join(",") : ""}`);
};
const noSideScroll = async (p: Page, where: string) => {
  const w = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  out(w.sw <= w.iw + 1, `${where}: no sideways scroll at ${w.iw}px (content ${w.sw}px)`);
};
const phone = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const re = (en: string, es: string) => new RegExp(L === "es" ? es : en, "i");

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ ...phone, locale: L === "es" ? "es-ES" : "en-US" });
  await ctx.addCookies([{ name: "lang", value: L, url: BASE }]);
  const p = await ctx.newPage();
  watch(p, "pda");
  await login(p, process.env.E2E_OPERATOR_USER!, process.env.E2E_OPERATOR_PASS!);
  out(new URL(p.url()).pathname.startsWith("/operator"), `operator landed on ${new URL(p.url()).pathname}`);

  // ---------------------------------------------------------------- 1. RECEIVE
  const inbounds = await db.inbound.findMany({ where: { status: "EXPECTED" }, include: { warehouse: true }, orderBy: { number: "asc" } });
  const inb = inbounds[idx];
  if (!inb) throw new Error("no EXPECTED inbound; reseed");
  const W = inb.warehouse?.code ?? "N1";
  await p.goto(`${BASE}/operator/receive/${inb.id}`, { waitUntil: "networkidle" });
  const truck = p.getByRole("button", { name: re("truck is at the dock", "camión está en el muelle") });
  if (await truck.count()) {
    await truck.click();
    await p.waitForSelector('input[enterkeyhint="go"]', { timeout: 30_000 });
  }
  await sleep(800);
  await shot(p, "receive-start");
  const codes = [`${P}-0001`, `${P}-0002`, `${P}-0003`];
  const r1 = await scan(p, codes[0], "receive");
  expectRes(r1, "ok", `scan ${codes[0]}`);
  out(r1.focusBack, "receive: cursor back in the field after a scan");
  expectRes(await scan(p, codes[1], "receive"), "ok", `scan ${codes[1]}`);
  expectRes(await scan(p, codes[2], "receive"), "ok", `scan ${codes[2]}`);
  const dup = await scan(p, codes[1], "receive");
  expectRes(dup, "error", `repeat ${codes[1]} (must be red)`);
  const inside = await db.stock.findFirst({ where: { palletCode: { not: null }, location: { not: { startsWith: "REC" } } }, select: { palletCode: true } });
  if (inside?.palletCode) expectRes(await scan(p, inside.palletCode, "receive"), "error", `already inside ${inside.palletCode} (red)`);
  const counter = await p.locator("body").innerText();
  out(/3 (of|de) /.test(counter) || /3 (scanned|escaneados)/.test(counter), `receive: counter shows 3`);
  await shot(p, "receive-scanned");
  await noSideScroll(p, "receive");
  if (L === "en") await noRawKeys(p, "receive");

  // Known risk: photos after scanning reset ReceiveForm? Look at what the photo block is and whether it re-keys.
  // since 485adde the photos are numbered steps with an "optional" tag (no <details>): step 1 (note) and step 3 (damage)
  const optTags = await p.getByText(re("optional", "opcional")).count();
  out(optTags >= 2, `receive: the photo steps are tagged optional (${optTags} tags)`);

  const confirm = p.getByRole("button", { name: re("^Confirm \\d+ pallets? into receiving", "^Confirmar \\d+ pal") });
  await confirm.scrollIntoViewIfNeeded();
  await confirm.click();
  await p.waitForSelector("text=/" + (L === "es" ? "recibid|Etiquet" : "received|Label") + "/i", { timeout: 40_000 }).catch(() => undefined);
  for (let i = 0; i < 60 && (await db.stock.count({ where: { palletCode: { in: codes } } })) < 3; i++) await sleep(1000);
  await sleep(1500);
  await shot(p, "receive-done");
  const rows = await db.stock.findMany({ where: { palletCode: { in: codes } }, select: { palletCode: true, location: true, warehouseId: true } });
  out(rows.length === 3 && rows.every((r) => r.location.startsWith("REC")), `DB: ${rows.length}/3 Stock rows with the scanned IDs, in ${[...new Set(rows.map((r) => r.location))].join(",")}`);
  const labelsLink = p.locator('a[href^="/labels"]').first();
  out(null, `receive: /labels link after receiving: ${(await labelsLink.count()) > 0 ? "shown" : "not shown (all IDs were scanned, nothing to print; it only appears for generated IDs)"}`);
  if (L === "en") await noRawKeys(p, "receive done");

  // ---------------------------------------------------------------- 2. PUT AWAY
  await p.goto(`${BASE}/operator/putaway?w=${W}&code=${codes[0]}`, { waitUntil: "networkidle" });
  await sleep(500);
  const suggestion = (await p.locator("p.text-6xl").first().innerText().catch(() => "")).trim();
  out(!!suggestion, `putaway: suggested slot ${suggestion || "(none)"}`);
  await shot(p, "putaway-1");
  // slot before pallet -> red
  if (suggestion) expectRes(await scan(p, suggestion, "putaway"), "error", "slot scanned before the pallet (red)");
  expectRes(await scan(p, codes[0], "putaway"), "ok", `pallet ${codes[0]}`);
  if (suggestion) {
    const placed = await scan(p, suggestion, "putaway");
    out(placed.r === "ok" || placed.r === "gone", `suggested slot ${suggestion} -> ${placed.r}`);
    await sleep(2500);
    const s = await db.stock.findFirst({ where: { palletCode: codes[0] } });
    out(s?.location === suggestion, `DB: ${codes[0]} now in ${s?.location}`);
  }

  // 2nd pallet: a free slot that is not the suggestion -> "Leave it in X?"
  await p.goto(`${BASE}/operator/putaway?w=${W}&code=${codes[1]}`, { waitUntil: "networkidle" });
  await sleep(500);
  const sug2 = (await p.locator("p.text-6xl").first().innerText().catch(() => "")).trim();
  expectRes(await scan(p, codes[1], "putaway"), "ok", `pallet ${codes[1]}`);
  const occupied = await db.stock.findFirst({ where: { warehouse: { code: W }, location: { not: { startsWith: "REC" } }, NOT: { location: { startsWith: "EXP" } } }, select: { location: true } });
  if (occupied) expectRes(await scan(p, occupied.location, "putaway"), "error", `occupied slot ${occupied.location} (red)`);
  // an N2 label (or N1 if we are in N2) -> red
  const other = W === "N1" ? "N2" : "N1";
  expectRes(await scan(p, `${other}-A-01-1`, "putaway"), "error", `label from the other building ${other}-A-01-1 (red)`);
  const used = new Set((await db.stock.findMany({ where: { warehouse: { code: W } }, select: { location: true } })).map((x) => x.location));
  let other2: string | null = null;
  for (const row of "ABCDEFGH") {
    for (let c = 1; c <= 15 && !other2; c++) {
      const loc = `${row}-${String(c).padStart(2, "0")}-1`;
      if (!used.has(loc) && loc !== sug2) other2 = loc;
    }
    if (other2) break;
  }
  if (other2) {
    const leave = await scan(p, other2, "putaway");
    out(leave.r === "ok" && /leave|dejarlo/i.test(leave.t), `free slot ${other2} different from suggestion -> "${leave.t}"`);
    await shot(p, "putaway-leave");
    await p.getByRole("button", { name: re("Yes, leave it here", "Sí, dejarlo aquí") }).click();
    await sleep(3000);
    const s = await db.stock.findFirst({ where: { palletCode: codes[1] } });
    out(s?.location === other2, `DB: ${codes[1]} now in ${s?.location} (wanted ${other2})`);
  }

  // 3rd pallet: do it by hand
  await p.goto(`${BASE}/operator/putaway?w=${W}&code=${codes[2]}`, { waitUntil: "networkidle" });
  await sleep(500);
  await p.getByRole("button", { name: re("do it by hand", "hacerlo a mano") }).click();
  const byHand = p.getByRole("button", { name: re("^Pallet placed in", "^Palé colocado en") });
  out((await byHand.count()) > 0, "putaway: 'do it by hand' shows the confirm button");
  await shot(p, "putaway-by-hand");
  await byHand.click();
  await sleep(3000);
  const s3 = await db.stock.findFirst({ where: { palletCode: codes[2] } });
  out(!!s3 && !s3.location.startsWith("REC"), `DB: ${codes[2]} now in ${s3?.location} (by hand)`);
  await noSideScroll(p, "putaway");
  if (L === "en") await noRawKeys(p, "putaway");

  // ---------------------------------------------------------------- 3. PICK
  const outs = await db.outbound.findMany({ where: { status: "REQUESTED" }, orderBy: { number: "asc" } });
  const ob = outs[idx];
  if (!ob) throw new Error("no REQUESTED outbound");
  await p.goto(`${BASE}/operator/pick/${ob.id}`, { waitUntil: "networkidle" });
  await sleep(600);
  await shot(p, "pick-start");
  const stepInfo = async () => ({
    loc: (await p.locator("p.text-6xl").first().innerText().catch(() => "")).trim(),
    code: (await p.locator(".dock-card span.mono.font-bold").first().innerText().catch(() => "")).trim(),
    boxes: (await p.locator("p", { hasText: re("take only", "coge solo") }).count()) > 0,
  });
  let st = await stepInfo();
  out(!!st.loc, `pick: first step at ${st.loc} pallet ${st.code || "(no id)"}${st.boxes ? " (boxes)" : ""}`);
  if (st.loc) {
    if (st.code) {
      // a pallet with an ID: only the pallet is scanned; a slot label says "scan the pallet"
      expectRes(await scan(p, st.loc, "pick"), "error", `slot label instead of the pallet (red)`);
    } else {
      const wrongSlot = st.loc === "A-01-1" ? "A-01-2" : "A-01-1";
      expectRes(await scan(p, wrongSlot, "pick"), "error", `wrong slot ${wrongSlot} (red)`);
      expectRes(await scan(p, st.loc, "pick"), "ok", `right slot ${st.loc}`);
    }
    if (st.code) {
      expectRes(await scan(p, "WRONG-0001", "pick"), "error", "wrong pallet (red, UI)");
      // SERVER-side check: rewrite the scanned code inside the server action request, so the UI lets it through
      let rewritten = 0;
      await p.route("**/*", async (route) => {
        const req = route.request();
        const body = req.postData();
        if (req.method() === "POST" && req.headers()["next-action"] && body && body.includes(st.code)) {
          rewritten++;
          return route.continue({ postData: body.split(st.code).join("WRONG-7777") });
        }
        return route.continue();
      });
      const good = await scan(p, st.code, "pick");
      expectRes(good, "ok", `right pallet ${st.code} (UI)`);
      if (!st.boxes) await sleep(2500);
      else {
        await p.getByRole("button", { name: re("^Picked", "^Recogido") }).click();
        await sleep(2500);
      }
      const alert = await p.locator('[role="alert"], p.text-dock-red').first().innerText().catch(() => "");
      out(rewritten > 0 && !!alert, `SERVER rejects a wrong ID (requests rewritten: ${rewritten}) -> "${alert.slice(0, 120)}"`);
      await shot(p, "pick-server-reject");
      await p.unroute("**/*");
      const still = await db.stock.findFirst({ where: { palletCode: st.code }, select: { outboundId: true } });
      out(!!still && still.outboundId === null, `DB: ${st.code} NOT picked after the rejected request`);
      // after the rejection the UI may or may not have kept state: reload and start the step again properly
      await p.goto(`${BASE}/operator/pick/${ob.id}`, { waitUntil: "networkidle" });
      await sleep(500);
    }
  }
  // finish the whole outbound by the book
  for (let guard = 0; guard < 40; guard++) {
    // "Label the new pallet" screen between steps
    const next = p.getByRole("button", { name: re("labelled|label.*next|finish|done|etiquetad|terminar|siguiente|listo", "etiquetad|terminar|siguiente|listo") });
    if (/(\/operator$|\/operator\?)/.test(p.url()) || (await p.locator("text=/PREPARED|prepared|preparada|preparado/").count()) > 0 && !(await p.locator("p.text-6xl").count())) break;
    await sleep(1200);
    st = await stepInfo();
    if (!st.loc) {
      if (await next.count()) {
        await next.first().click();
        await sleep(1500);
        continue;
      }
      break;
    }
    if (!st.code) {
      const a = await scan(p, st.loc, "pick");
      if (a.r !== "ok") {
        out(false, `pick loop: slot ${st.loc} rejected "${a.t}"`);
        break;
      }
    }
    if (st.code) {
      const b = await scan(p, st.code, "pick");
      if (b.r === "error") {
        out(false, `pick loop: pallet ${st.code} rejected "${b.t}"`);
        break;
      }
    }
    if (st.boxes || !st.code) {
      const btn = p.getByRole("button", { name: re("^Picked", "^Recogido") });
      if (await btn.count()) await btn.click();
    }
    for (let i = 0; i < 100; i++) {
      await sleep(300);
      if ((await next.count()) || (await stepInfo()).loc !== st.loc || !(await p.locator("p.text-6xl").count())) break;
    }
    await sleep(300);
    if (await next.count()) {
      await shot(p, "pick-label");
      await next.first().click();
      await sleep(1500);
    }
  }
  await sleep(1500);
  await shot(p, "pick-end");
  const fin = await db.outbound.findUnique({ where: { id: ob.id } });
  out(fin?.status === "PREPARED", `DB: outbound ${ob.number} status ${fin?.status}`);
  await noSideScroll(p, "pick");
  if (L === "en") await noRawKeys(p, "pick");

  // "confirm by hand" on the next outbound
  const ob2 = outs[idx + 2];
  if (ob2) {
    await p.goto(`${BASE}/operator/pick/${ob2.id}`, { waitUntil: "networkidle" });
    await sleep(500);
    const s0 = await stepInfo();
    const picked0 = await db.stock.count({ where: { outboundId: ob2.id } });
    await p.getByRole("button", { name: re("confirm by hand", "confirmar a mano") }).click();
    const hand = p.getByRole("button", { name: re("^Picked", "^Recogido") });
    out((await hand.count()) > 0, "pick: 'confirm by hand' shows the confirm button");
    await shot(p, "pick-by-hand");
    if (await hand.count()) {
      await hand.click();
      await sleep(3500);
      const picked1 = await db.stock.count({ where: { outboundId: ob2.id } });
      out(picked1 > picked0, `DB: pick by hand at ${s0.loc} moved pallets to the outbound (${picked0} -> ${picked1})`);
    }
  }

  // ---------------------------------------------------------------- 4. LABELS
  const lab = async (ctxName: string, user: string, pass: string, expectOk: boolean) => {
    const c = await browser.newContext({ ...phone, locale: L === "es" ? "es-ES" : "en-US" });
    await c.addCookies([{ name: "lang", value: L, url: BASE }]);
    const q = await c.newPage();
    watch(q, ctxName);
    if (user) await login(q, user, pass);
    await q.goto(`${BASE}/labels?w=N1&kind=slots`, { waitUntil: "domcontentloaded" });
    const path = new URL(q.url()).pathname;
    if (!expectOk) {
      out(!path.startsWith("/labels"), `labels as ${ctxName}: refused (landed on ${path})`);
      await c.close();
      return;
    }
    out(path.startsWith("/labels"), `labels as ${ctxName}: allowed`);
    const cnt = async () => Number(((await q.locator("span.mono").filter({ hasText: /\d/ }).first().innerText().catch(() => "0")).match(/[\d.,]+/)?.[0] ?? "0").replace(/[.,]/g, ""));
    const slotsAll = await cnt();
    out(slotsAll === 600, `labels ${ctxName}: N1 slots = ${slotsAll}`);
    await shot(q, `labels-${ctxName}-n1-slots`);
    await q.goto(`${BASE}/labels?w=N1&kind=slots&row=A`, { waitUntil: "domcontentloaded" });
    const rowN = await cnt();
    out(rowN > 0 && rowN < slotsAll, `labels ${ctxName}: row filter A = ${rowN} labels`);
    out((await q.locator("svg[role=img]").count()) === rowN, `labels ${ctxName}: one barcode SVG per label`);
    await q.goto(`${BASE}/labels?w=N2&kind=pallets`, { waitUntil: "domcontentloaded" });
    const palN = await cnt();
    const dbPal = new Set((await db.stock.findMany({ where: { warehouse: { code: "N2" }, palletCode: { not: null } }, select: { palletCode: true } })).map((x) => x.palletCode)).size;
    out(palN === dbPal && palN > 0, `labels ${ctxName}: N2 pallets = ${palN} (distinct IDs in DB ${dbPal})`);
    await shot(q, `labels-${ctxName}-n2-pallets`);
    await q.emulateMedia({ media: "print" });
    const vis = await q.locator("header.print\\:hidden").isVisible().catch(() => null);
    out(vis === false, `labels ${ctxName}: print view hides the header (visible=${vis})`);
    await shot(q, `labels-${ctxName}-print`);
    await noSideScroll(q, `labels ${ctxName}`);
    if (L === "en") await noRawKeys(q, `labels ${ctxName}`);
    await c.close();
  };
  await lab("office", process.env.E2E_OFFICE_USER!, process.env.E2E_OFFICE_PASS!, true);
  await lab("operator", process.env.E2E_OPERATOR_USER!, process.env.E2E_OPERATOR_PASS!, true);
  await lab("anonymous", "", "", false);
  await lab("customer", process.env.E2E_CLIENT_USER!, process.env.E2E_CLIENT_PASS!, false);
  if (L === "es") {
    await p.goto(`${BASE}/operator/putaway?w=${W}`, { waitUntil: "networkidle" });
    await noRawKeys(p, "putaway es");
    await p.goto(`${BASE}/operator?w=${W}`, { waitUntil: "networkidle" });
    await noRawKeys(p, "operator home es");
    await shot(p, "home");
  }

  out(problems.length === 0, `browser console/network problems: ${problems.length}${problems.length ? "\n  " + problems.slice(0, 8).join("\n  ") : ""}`);
  await browser.close();
  console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAIL"}`);
  await db.$disconnect();
  process.exit(fails ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
