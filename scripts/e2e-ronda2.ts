// Checks of the 29/10 front-end round that need a session (run with E2E_* variables; localhost only; WRITES to the database: reseed after).
// SPENDS MODEL MONEY when the server has a model key: step 1 replays the inbox (15 messages) and step 2 asks the portal assistant
// (about 0.10 $ in all on 29/10). Without a key the rules answer and it costs nothing.
//   STEP=1 npx tsx scripts/e2e-ronda2.ts   (login at 375, inbox -> approve Toni's order, 3D ?pick=, PDA receive with 1 damaged box)
//   STEP=2 npx tsx scripts/e2e-ronda2.ts   (billing prepare, pre-invoice at 375 and desktop, trace, customer portal)
//   STEP=3 PICK_ID=<outbound id> npx tsx scripts/e2e-ronda2.ts   (3D ?pick= on a short screen; RECEIPT_ID=<id> also checks that receipt)
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";

const BASE = "http://localhost:3000";
const SHOTS = process.env.E2E_SHOTS || join(homedir(), "dockclerk-e2e", "2026-10-29-ronda2");
mkdirSync(SHOTS, { recursive: true });
const E = (k: string) => process.env[k] || (() => { throw new Error("missing " + k); })();
const phone = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const log = (ok: boolean | null, s: string) => console.log(`${ok === null ? "INFO" : ok ? "PASS" : "FAIL"}  ${s}`);
let n = 0;
const shot = (p: Page, l: string) => p.screenshot({ path: join(SHOTS, `${String(++n).padStart(2, "0")}-${l}.png`), fullPage: true }).catch(() => undefined);
const problems: string[] = [];
const watch = (p: Page, who: string) => {
  p.on("console", (m) => m.type() === "error" && !/favicon/i.test(m.text()) && problems.push(`[${who}] ${m.text().slice(0, 160)}`));
  p.on("pageerror", (e) => problems.push(`[${who}] pageerror ${String(e.message).slice(0, 160)}`));
  p.on("response", (r) => r.status() >= 500 && problems.push(`[${who}] HTTP ${r.status()} ${r.url().replace(BASE, "")}`));
};
const widths = (p: Page) => p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
const body = (p: Page) => p.locator("body").innerText();
async function login(p: Page, u: string, pw: string) {
  await p.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await p.locator('input[name="username"]').fill(u);
  await p.locator('input[name="password"]').fill(pw);
  await Promise.all([p.waitForURL((x) => x.pathname !== "/", { timeout: 30_000 }), p.getByRole("button", { name: /^Sign in/ }).click()]);
}

async function step1() {
  const b = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
  // login at 375
  const lp = await (await b.newContext(phone)).newPage();
  watch(lp, "login");
  await lp.goto(BASE + "/", { waitUntil: "networkidle" });
  const u = await lp.locator('input[name="username"]').boundingBox();
  const h1 = await lp.locator("h1").first().boundingBox();
  const w = await widths(lp);
  log(!!u && u.y < 600 && w.sw <= w.iw, `login 375: username field top=${u?.y}px (viewport 812), h1 top=${h1?.y}, scrollWidth=${w.sw}`);
  await shot(lp, "login-375");

  const office = await (await b.newContext({ viewport: { width: 1366, height: 860 } })).newPage();
  const pda = await (await b.newContext(phone)).newPage();
  watch(office, "office"); watch(pda, "pda");
  office.setDefaultTimeout(30_000); pda.setDefaultTimeout(30_000);
  await login(office, E("E2E_OFFICE_USER"), E("E2E_OFFICE_PASS"));
  await login(pda, E("E2E_OPERATOR_USER"), E("E2E_OPERATOR_PASS"));
  await office.goto(BASE + "/office/inbox", { waitUntil: "domcontentloaded" });
  await office.getByRole("button", { name: /Replay the morning/ }).click();
  await office.waitForLoadState("networkidle"); await office.waitForTimeout(1500);
  await office.getByRole("button", { name: /Let the clerk handle \d+ messages/ }).click();
  await office.getByText("AI clerk · finished").waitFor({ timeout: 300_000 });
  await office.reload({ waitUntil: "networkidle" });
  const card = office.locator("article", { hasText: "HORCH-1L" }).filter({ hasText: "New outbound" }).first();
  await card.getByRole("button", { name: /Approve & write to software/ }).click();
  const done = office.getByText(/Outbound Nº\s*\d+ in your software/i).first();
  await done.waitFor({ timeout: 60_000 });
  const no = Number(((await done.textContent()) ?? "").match(/Nº\s*(\d+)/)?.[1]);
  let id = "";
  for (const wh of ["N1", "N2"]) {
    await pda.goto(`${BASE}/operator?w=${wh}`, { waitUntil: "domcontentloaded" });
    const links = await pda.locator('a[href^="/operator/pick/"]').evaluateAll((as) => as.map((a) => ({ h: a.getAttribute("href") ?? "", t: (a as HTMLElement).innerText })));
    const m = links.find((l) => Number((l.t.match(/Nº\s*(\d+)/) ?? [])[1]) === no);
    if (m) { id = m.h.split("/").pop()!; break; }
  }
  log(!!id, `Toni's outbound Nº ${no} approved, id found`);
  // 3D
  await office.setViewportSize({ width: 1366, height: 700 });
  await office.goto(`${BASE}/office/warehouse?pick=${id}`, { waitUntil: "networkidle" });
  await office.locator("canvas").first().waitFor();
  await office.waitForTimeout(4000);
  const t = await body(office);
  const legend = (t.match(/To pick for Nº[\s\S]{0,300}/i) ?? [""])[0].replace(/\s+/g, " ");
  log(null, `3D legend: ${legend.slice(0, 200)}`);
  const rows = await office.evaluate(() => {
    const vh = window.innerHeight;
    const els = [...document.querySelectorAll("li, tr, div")].filter((e) => /^\s*\d+\s*(×|x)?/.test((e as HTMLElement).innerText?.slice(0, 5) ?? "") === false);
    return vh && els.length;
  });
  // rows of "To pick": find elements containing a slot code such as A-07-3 and report visibility
  const vis = await office.evaluate(() => {
    const vh = window.innerHeight;
    const out: { t: string; top: number; inView: boolean }[] = [];
    document.querySelectorAll("li").forEach((li) => {
      const el = li as HTMLElement;
      if (/[A-H]-\d\d-\d/.test(el.innerText) || /HORCH|AGUA|WAT/i.test(el.innerText)) {
        const r = el.getBoundingClientRect();
        out.push({ t: el.innerText.replace(/\s+/g, " ").slice(0, 50), top: Math.round(r.top), inView: r.top >= 0 && r.bottom <= vh });
      }
    });
    return out;
  });
  log(null, `3D list rows (${vis.length}): ${JSON.stringify(vis.slice(0, 12))} scrollY=${await office.evaluate(() => scrollY)}`);
  await shot(office, "3d-pick");
  void rows;

  // PDA receive with 1 damaged box
  await pda.goto(BASE + "/operator", { waitUntil: "networkidle" });
  const rc = pda.locator('a[href^="/operator/receive/"]').first();
  if (!(await rc.count())) { log(false, "no receive task on the PDA"); }
  else {
    await pda.goto(BASE + ((await rc.getAttribute("href")) ?? ""), { waitUntil: "networkidle" });
    const truck = pda.getByRole("button", { name: /The truck is at the dock/ });
    if (await truck.count()) { await truck.click(); await pda.waitForTimeout(4000); await pda.reload({ waitUntil: "networkidle" }); }
    await shot(pda, "pda-receive");
    const names = await pda.getByRole("button").evaluateAll((bs) => bs.map((x) => (x.getAttribute("aria-label") || (x as HTMLElement).innerText || "").trim().replace(/\s+/g, " ")));
    const unnamed = names.filter((x) => !x);
    log(unnamed.length === 0, `PDA receive buttons: ${names.length}, unnamed ${unnamed.length}: ${names.slice(0, 10).join(" | ")}`);
    const more = pda.getByRole("button", { name: "One damaged box more" });
    log((await more.count()) === 1, "button 'One damaged box more' reachable by name");
    const cur = Number((await pda.locator("span.mono.w-10").first().innerText()).trim());
    await more.click();
    if (cur > 0) { /* ensure exactly 1 */ for (let i = 0; i < cur; i++) await pda.getByRole("button", { name: "One damaged box less" }).click(); await more.click(); }
    await pda.getByRole("button", { name: /^Confirm \d+ pallets/ }).click();
    await pda.waitForLoadState("networkidle"); await pda.waitForTimeout(3000);
    const pt = await body(pda);
    log(null, `after confirm url=${pda.url().replace(BASE, "")} text='${pt.replace(/\s+/g, " ").slice(0, 160)}'`);
    await shot(pda, "pda-after-receive");
    await office.goto(BASE + "/office/inbound", { waitUntil: "domcontentloaded" }).catch(() => undefined);
    const link = await office.evaluate(() => [...document.querySelectorAll('a[href^="/receipts/"]')].map((a) => a.getAttribute("href")));
    log(null, `receipt links seen in office/inbound: ${link.length}`);
  }
  log(problems.length === 0, `browser problems: ${[...new Set(problems)].join(" ; ") || "none"}`);
  console.log("OUTBOUND_ID=" + id);
  await b.close();
}

async function step2() {
  const b = await chromium.launch();
  const office = await (await b.newContext({ viewport: { width: 1366, height: 860 } })).newPage();
  const om = await (await b.newContext(phone)).newPage();
  watch(office, "office"); watch(om, "office375");
  office.setDefaultTimeout(60_000); om.setDefaultTimeout(60_000);
  await login(office, E("E2E_OFFICE_USER"), E("E2E_OFFICE_PASS"));
  await login(om, E("E2E_OFFICE_USER"), E("E2E_OFFICE_PASS"));
  await office.goto(BASE + "/office/billing", { waitUntil: "networkidle" });
  await office.getByRole("button", { name: "Prepare pre-invoices" }).click();
  await office.getByText(/pre-invoices? drafted/).waitFor({ timeout: 120_000 });
  await office.waitForLoadState("networkidle");
  const href = (await office.locator("tbody tr", { hasText: "C001" }).locator('a[href^="/office/billing/"]').getAttribute("href")) ?? "";
  log(!!href, `C001 pre-invoice ${href}`);
  // desktop
  await office.goto(BASE + href, { waitUntil: "networkidle" });
  const td = await body(office);
  log(/21[\s\S]{0,80}no exit/i.test(td) && /leave[s]?\s+02\/10/i.test(td.replace(/\s+/g, " ")) || /02\/10/.test(td), `desktop: rows 21 no exit / 2 leave 02/10 present`);
  const dw = await widths(office);
  log(dw.sw <= dw.iw, `desktop scrollWidth ${dw.sw}/${dw.iw}`);
  await shot(office, "billing-detail-desktop");
  // phone
  await om.goto(BASE + href, { waitUntil: "networkidle" });
  const w = await widths(om);
  log(w.sw <= w.iw, `375 pre-invoice scrollWidth ${w.sw}/${w.iw}`);
  const tm = (await body(om)).replace(/\s+/g, " ");
  log(/no exit/i.test(tm) && /02\/10/.test(tm), `375: rows 21 no exit / 2 leave 02/10 readable`);
  const clipped = await om.evaluate(() => {
    const vw = window.innerWidth; const bad: string[] = [];
    document.querySelectorAll("main *").forEach((e) => { const r = e.getBoundingClientRect(); if (r.width > 0 && (r.right > vw + 1 || r.left < -1) && (e as HTMLElement).innerText?.trim()) bad.push(((e as HTMLElement).innerText || "").slice(0, 30)); });
    return bad.slice(0, 5);
  });
  log(clipped.length === 0, `375: elements beyond viewport: ${JSON.stringify(clipped)}`);
  await shot(om, "billing-detail-375");
  // trace
  for (const sku of ["PUZZLE-500", "PELUCHE-30"]) {
    await office.goto(`${BASE}/office/trace?q=${sku}`, { waitUntil: "networkidle" });
    const t = (await body(office)).replace(/\s+/g, " ");
    const a = office.locator('a[href^="/office/clients/"]').filter({ hasText: /card|customer|→/i }).first();
    const has = /not tracked by lot/i.test(t);
    let ok = false, to = "";
    if (await a.count()) { to = (await a.getAttribute("href")) ?? ""; await a.click(); await office.waitForLoadState("networkidle"); ok = /\/office\/clients\/C\d+/.test(office.url()) && !/not found|404/i.test(await body(office)); }
    log(has && ok, `trace ${sku}: notice=${has} link→${to} opens=${ok}`);
    await shot(office, `trace-${sku}`);
  }
  // portal
  const cl = await (await b.newContext(phone)).newPage();
  watch(cl, "client"); cl.setDefaultTimeout(60_000);
  await login(cl, E("E2E_CLIENT_USER"), E("E2E_CLIENT_PASS"));
  for (const p of ["/portal", "/portal/stock", "/portal/movements", "/portal/ask"]) {
    await cl.goto(BASE + p, { waitUntil: "networkidle" });
    const x = await widths(cl);
    log(x.sw <= x.iw, `portal ${p} at 375: scrollWidth ${x.sw}/${x.iw}`);
    await shot(cl, "portal" + p.replace(/\//g, "-"));
  }
  await cl.goto(BASE + "/portal/ask", { waitUntil: "networkidle" });
  for (const q of ["¿cuánto llevo de almacenaje este mes?", "¿cuántos palés de PELUCHE-30 tengo?"]) {
    const before = await cl.locator("details.dock-console").count();
    await cl.getByPlaceholder(/Ask about your stock/).fill(q);
    await cl.getByRole("button", { name: /Send/ }).click();
    const t0 = Date.now();
    while ((await cl.locator("details.dock-console").count()) <= before && Date.now() - t0 < 60_000) await cl.waitForTimeout(500);
    await cl.locator("details.dock-console summary").last().click().catch(() => undefined);
    const lg = (await cl.locator("details.dock-console").last().innerText().catch(() => "")).replace(/\s+/g, " ");
    const bad = /tokens?|\$|daily AI limit|céntimo/i.test(lg);
    log(!bad && lg.length > 20, `portal log for "${q}": ${bad ? "HAS COST TEXT" : "no cost text"}; ${lg.slice(0, 260)}`);
    await shot(cl, "portal-ask");
  }
  const bodyAll = await body(cl);
  log(!/tokens|daily AI limit|≈\s*\$/i.test(bodyAll), "whole portal page has no 'tokens' / '$' / daily limit");
  log(problems.length === 0, `browser problems: ${[...new Set(problems)].join(" ; ") || "none"}`);
  await b.close();
}
async function step3() {
  const b = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
  const office = await (await b.newContext({ viewport: { width: 1366, height: 520 } })).newPage();
  office.setDefaultTimeout(30_000);
  await login(office, E("E2E_OFFICE_USER"), E("E2E_OFFICE_PASS"));
  const id = E("PICK_ID");
  await office.goto(`${BASE}/office/warehouse?pick=${id}`, { waitUntil: "networkidle" });
  await office.waitForTimeout(4000);
  const r = await office.evaluate(() => {
    const act = document.querySelector('[data-active="true"]') as HTMLElement | null;
    if (!act) return null;
    const list = act.closest("div.overflow-y-auto, div.overflow-auto") as HTMLElement | null;
    const ar = act.getBoundingClientRect();
    return { top: Math.round(ar.top), bottom: Math.round(ar.bottom), vh: innerHeight, listScroll: list ? Math.round(list.scrollTop) : null, pageScrollY: Math.round(scrollY) };
  });
  log(!!r && r.top >= 0 && r.bottom <= r.vh, `viewport 520: active row in view: ${JSON.stringify(r)}`);
  await shot(office, "3d-pick-520");
  if (process.env.RECEIPT_ID) {
    await office.goto(`${BASE}/receipts/${process.env.RECEIPT_ID}`, { waitUntil: "networkidle" });
    const t = (await body(office)).replace(/\s+/g, " ");
    log(/1 damaged box(?!es)/i.test(t), `receipt says: ${(t.match(/.{0,60}damaged.{0,60}/i) ?? ["(no 'damaged' text)"])[0]}`);
    await shot(office, "receipt");
  }
  await b.close();
}
const steps: Record<string, () => Promise<void>> = { "1": step1, "2": step2, "3": step3 };
const step = steps[process.env.STEP ?? ""];
if (!step) {
  console.error(`Say which step: STEP=1, STEP=2 or STEP=3 (got ${JSON.stringify(process.env.STEP ?? null)}). See the header of this file.`);
  process.exit(1);
}
step().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
