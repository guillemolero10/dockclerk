// End-to-end walk of the "Prueba final" of PLAN-PALES.md (and checks 18-24 of CLAUDE.md) in a real browser.
//
//   E2E_OFFICE_USER=oficina E2E_OFFICE_PASS=… E2E_OPERATOR_USER=operario E2E_OPERATOR_PASS=… \
//   E2E_CLIENT_USER=juguetes-levante E2E_CLIENT_PASS=… npx tsx scripts/e2e.ts
//
// (Passwords are read from the environment only. See scripts/e2e.sh, which asks for them without echoing them.)
//
// What it needs: the dev server running against a freshly seeded database (`npm run dev`, `npm run db:seed`).
// What it WRITES: it approves the horchata draft (creates an outbound), picks it on the PDA, prepares and approves
// last month's pre-invoice of C001, and changes C001's loose-pallet rule and puts it back. Reseed before running it again.
// It refuses to run against anything but localhost unless E2E_ALLOW_REMOTE=1 (never point it at production).
//
// Options (environment): E2E_BASE_URL (http://localhost:3000), E2E_SHOTS (folder for screenshots, outside the repo by default),
// E2E_HEADED=1 (watch it), E2E_SKIP_REPLAY=1 (do not press "Replay the morning" at the start),
// E2E_C001_BASE (expected base of C001, default 675,66; only checked when the month shown is September 2026).
//
// Exit code: 0 all steps passed (warnings do not count), 1 any failure, 2 missing configuration.

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const SHOTS = process.env.E2E_SHOTS || join(homedir(), "dockclerk-e2e", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
const WANT_C001_BASE = process.env.E2E_C001_BASE || "675,66";

const need = ["E2E_OFFICE_USER", "E2E_OFFICE_PASS", "E2E_OPERATOR_USER", "E2E_OPERATOR_PASS"];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  process.exit(2);
}
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE) && process.env.E2E_ALLOW_REMOTE !== "1") {
  console.error(`Refusing to run against ${BASE}: it is not localhost (set E2E_ALLOW_REMOTE=1 only for a test copy, never production).`);
  process.exit(2);
}

type Result = { name: string; status: "pass" | "fail"; note?: string; ms: number };
const results: Result[] = [];
const warnings: string[] = [];
const problems: string[] = []; // console errors, page errors, failed requests
let shotNo = 0;

const assert = (ok: unknown, message: string): void => {
  if (!ok) throw new Error(message);
};
const warn = (message: string) => {
  warnings.push(message);
  console.log(`   ! ${message}`);
};
const clean = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 50).toLowerCase();

/** Watches a page: console errors, uncaught errors, 5xx answers and requests that failed. */
function watch(page: Page, who: string) {
  const here = () => {
    try {
      return new URL(page.url()).pathname;
    } catch {
      return "?";
    }
  };
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/favicon/i.test(t)) return;
    problems.push(`[${who}] console error at ${here()}: ${t.slice(0, 240)}`);
  });
  page.on("pageerror", (e) => problems.push(`[${who}] page error at ${here()}: ${String(e.message).slice(0, 240)}`));
  page.on("response", (r) => {
    if (r.status() >= 500) problems.push(`[${who}] HTTP ${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`);
  });
  page.on("requestfailed", (r) => {
    const why = r.failure()?.errorText ?? "";
    if (/ERR_ABORTED|NS_BINDING_ABORTED/.test(why)) return; // navigations that were replaced by another one
    problems.push(`[${who}] request failed ${r.url().replace(BASE, "")}: ${why}`);
  });
}

async function shot(page: Page, label: string) {
  const file = join(SHOTS, `${String(++shotNo).padStart(2, "0")}-${clean(label)}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => undefined);
  return file;
}

async function step(page: Page | null, name: string, fn: () => Promise<void>) {
  const t0 = Date.now();
  process.stdout.write(`- ${name}\n`);
  try {
    await fn();
    results.push({ name, status: "pass", ms: Date.now() - t0 });
    if (page) await shot(page, name);
  } catch (err) {
    const note = err instanceof Error ? err.message.split("\n")[0] : String(err);
    results.push({ name, status: "fail", note, ms: Date.now() - t0 });
    console.log(`   FAIL: ${note}`);
    if (page) await shot(page, `FAIL-${name}`);
  }
}

/** The page may not scroll sideways (a table inside its own scroller is fine). */
async function noSideScroll(page: Page, where: string) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert(sw <= iw + 1, `${where}: the page scrolls sideways at ${iw}px (content is ${sw}px wide)`);
}

async function login(page: Page, user: string, pass: string) {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.locator('input[name="username"]').fill(user);
  await page.locator('input[name="password"]').fill(pass);
  await Promise.all([page.waitForURL((u) => u.pathname !== "/", { timeout: 20_000 }), page.getByRole("button", { name: /^Sign in/ }).click()]);
}

const text = (page: Page) => page.locator("body").innerText();
const eurosOf = (s: string) => (s.match(/\d[\d.]*,\d\d\s?€/) ?? [""])[0].replace(/\s/g, " ");

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const browser: Browser = await chromium.launch({
    headless: process.env.E2E_HEADED !== "1",
    // Software WebGL, so the three.js warehouse draws without a GPU.
    args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
  });
  const desktop = { viewport: { width: 1366, height: 860 } };
  const phone = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

  const officeCtx: BrowserContext = await browser.newContext(desktop);
  const pdaCtx: BrowserContext = await browser.newContext(phone);
  const office = await officeCtx.newPage();
  const pda = await pdaCtx.newPage();
  watch(office, "office");
  watch(pda, "pda");
  office.setDefaultTimeout(20_000);
  pda.setDefaultTimeout(20_000);

  let outboundId = "";
  let outboundNo = 0;
  let c001Id = "";
  let c001Base = "";
  let monthLabel = "";

  // ---------- 1. logins ----------
  await step(office, "login: office", async () => {
    await login(office, process.env.E2E_OFFICE_USER!, process.env.E2E_OFFICE_PASS!);
    assert(new URL(office.url()).pathname.startsWith("/office"), `office user landed on ${office.url()}`);
  });
  await step(pda, "login: operator on a 375 px phone", async () => {
    await login(pda, process.env.E2E_OPERATOR_USER!, process.env.E2E_OPERATOR_PASS!);
    assert(new URL(pda.url()).pathname.startsWith("/operator"), `operator landed on ${pda.url()}`);
    await noSideScroll(pda, "/operator");
  });

  // ---------- 2. inbox: let the clerk work ----------
  await step(office, "inbox: replay the morning, then the clerk handles every message", async () => {
    await office.goto(BASE + "/office/inbox", { waitUntil: "domcontentloaded" });
    if (process.env.E2E_SKIP_REPLAY !== "1") {
      await office.getByRole("button", { name: /Replay the morning/ }).click();
      await office.waitForLoadState("networkidle");
    }
    const run = office.getByRole("button", { name: /Let the clerk handle \d+ messages/ });
    assert(await run.count(), "no 'Let the clerk handle N messages' button: are there messages waiting?");
    await run.click();
    await office.getByText("AI clerk · finished").waitFor({ timeout: 300_000 });
    await office.reload({ waitUntil: "networkidle" });
  });

  await step(office, "inbox: Toni's horchata draft says 2 palés + 50 cajas and shows convert_quantity", async () => {
    const card = office.locator("article", { hasText: "HORCH-1L" }).filter({ hasText: "New outbound" }).first();
    assert(await card.count(), "no 'New outbound' draft with HORCH-1L");
    const t = await card.textContent();
    assert(t?.includes("2 palés + 50 cajas"), `the draft does not say '2 palés + 50 cajas': ${t?.replace(/\s+/g, " ").slice(0, 200)}`);
    assert(t?.includes("convert_quantity"), "the clerk's log has no convert_quantity call");
  });

  await step(office, "inbox: stock question says 33 palés + 12 cajas; the missing invoice goes to a person", async () => {
    const all = (await office.locator("main").textContent()) ?? "";
    assert(all.includes("33 palés + 12 cajas"), "no '33 palés + 12 cajas' answer for PELUCHE-30");
    const human = office.locator("article", { hasText: "factura" }).filter({ hasText: "Needs you" });
    assert(await human.count(), "'no nos ha llegado la factura' is not in a 'Needs you' draft");
  });

  await step(office, "inbox: approve the horchata order", async () => {
    const card = office.locator("article", { hasText: "HORCH-1L" }).filter({ hasText: "New outbound" }).first();
    await card.getByRole("button", { name: /Approve & write to software/ }).click();
    await office.waitForLoadState("networkidle");
    // The PDA must now list a new pick; the newest outbound number is Toni's.
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && !outboundId) {
      await pda.goto(BASE + "/operator", { waitUntil: "domcontentloaded" });
      const links = await pda.locator('a[href^="/operator/pick/"]').evaluateAll((as) =>
        as.map((a) => ({ href: a.getAttribute("href") ?? "", text: (a as HTMLElement).innerText })),
      );
      const best = links
        .map((l) => ({ ...l, no: Number((l.text.match(/Nº\s*(\d+)/) ?? [])[1] ?? 0) }))
        .sort((a, b) => b.no - a.no)[0];
      if (best?.no) {
        outboundId = best.href.split("/").pop()!;
        outboundNo = best.no;
      } else await pda.waitForTimeout(1500);
    }
    assert(outboundId, "the approved order never showed up on the PDA");
    console.log(`   outbound Nº ${outboundNo}`);
  });

  // ---------- 3. 3D ----------
  await step(office, "3D warehouse: the order lights up its pallets (WebGL)", async () => {
    await office.goto(`${BASE}/office/warehouse?pick=${outboundId}`, { waitUntil: "networkidle" });
    const canvas = office.locator("canvas").first();
    await canvas.waitFor({ timeout: 30_000 });
    await office.waitForTimeout(3000); // let three.js draw a few frames
    const box = await canvas.boundingBox();
    assert(box && box.width > 200 && box.height > 200, "the canvas has no size");
    const t = await text(office);
    assert(/To pick for Nº\s*\d+/.test(t), "no 'To pick for Nº …' legend: no pallets are highlighted");
    assert(/Pick route/.test(t), "no pick route shown");
    assert(!/pallets? short/.test(t.split("Pick route")[0] ?? ""), "the order is flagged as 'short' of pallets");
    const png = await canvas.screenshot();
    if (png.length < 15_000) warn(`3D canvas looks almost empty (${png.length} bytes): look at the screenshot`);
  });

  // ---------- 4. PDA picking ----------
  await step(pda, "PDA: 2 whole pallets and one 'Take only 50 boxes'", async () => {
    await pda.goto(`${BASE}/operator/pick/${outboundId}`, { waitUntil: "networkidle" });
    await noSideScroll(pda, "the pick page");
    assert(/0\/3/.test(await text(pda)), "the progress is not 0/3");
    let sawSplit = false;
    for (let i = 0; i < 6; i++) {
      const t = await text(pda);
      if (/is prepared/.test(t)) break;
      if (/Take only/.test(t)) {
        assert(/50\s*boxes/.test(t) && /leaves a pico of 50/.test(t), "the split step does not say 'Take only 50 boxes … leaves a pico of 50'");
        sawSplit = true;
        await shot(pda, "pda-take-only-50");
        await pda.getByRole("button", { name: /^Picked 50 boxes/ }).click();
      } else {
        await pda.getByRole("button", { name: /^Picked the pallet/ }).click();
      }
      await pda.waitForLoadState("networkidle");
      await pda.waitForTimeout(600);
    }
    assert(sawSplit, "no split step ('Take only …') appeared");
    assert(/is prepared/.test(await text(pda)), "the outbound did not become PREPARED after the last pick");
    await noSideScroll(pda, "the prepared page");
  });

  await step(pda, "PDA: reloading a finished pick changes nothing", async () => {
    await pda.reload({ waitUntil: "networkidle" });
    const t = await text(pda);
    assert(/is prepared/.test(t) && /3 pallets waiting|4 pallets waiting/.test(t), `unexpected prepared page: ${t.replace(/\s+/g, " ").slice(0, 160)}`);
  });

  // ---------- 5. trace ----------
  await step(office, "trace: the horchata lot balances in units", async () => {
    await office.goto(`${BASE}/office/trace?q=${encodeURIComponent("HORCH-1L")}`, { waitUntil: "networkidle" });
    const first = office.locator('a[href^="/office/trace?lot="]').first();
    await first.click();
    await office.waitForLoadState("networkidle");
    const t = await text(office);
    const m = t.match(/(\d+) in = (\d+) out \+ (\d+) here/);
    assert(m, "no 'N in = N out + N here' line on the trace page");
    assert(!/does not add up/.test(t), `the lot does not balance: ${m![0]}`);
    assert(Number(m![1]) === Number(m![2]) + Number(m![3]), `in ≠ out + here: ${m![0]}`);
  });

  await step(office, "trace: PUZZLE-500 (23 → 21 + 2) and PELUCHE-30 (pico 12) balance", async () => {
    for (const sku of ["PUZZLE-500", "PELUCHE-30"]) {
      await office.goto(`${BASE}/office/trace?q=${encodeURIComponent(sku)}`, { waitUntil: "networkidle" });
      const links = office.locator('a[href^="/office/trace?lot="]');
      const n = await links.count();
      if (!n) {
        warn(`trace: no lot found for ${sku}`);
        continue;
      }
      for (let i = 0; i < Math.min(n, 4); i++) {
        await office.goto(`${BASE}/office/trace?q=${encodeURIComponent(sku)}`, { waitUntil: "domcontentloaded" });
        await office.locator('a[href^="/office/trace?lot="]').nth(i).click();
        await office.waitForLoadState("networkidle");
        const t = await text(office);
        assert(!/does not add up/.test(t), `${sku} lot ${i + 1} does not balance`);
      }
    }
  });

  // ---------- 6. billing ----------
  await step(office, "billing: opens on last month, 8 customers, nothing prepared yet", async () => {
    await office.goto(BASE + "/office/billing", { waitUntil: "networkidle" });
    monthLabel = (await office.locator('nav[aria-label="Month"] span.cond').first().innerText()).trim();
    const rows = await office.locator("tbody tr").count();
    assert(rows === 8, `expected 8 customer rows, found ${rows}`);
    const t = await text(office);
    assert(/Not prepared yet/.test(t), "rows are not 'Not prepared yet' (was it already prepared? reseed first)");
    const c005 = office.locator("tbody tr", { hasText: "C005" });
    assert((await c005.getByRole("button", { name: "Full pallet" }).getAttribute("aria-pressed")) === "true", "C005 is not on the Full pallet rule");
    console.log(`   month: ${monthLabel}`);
  });

  await step(office, "billing: odd months in the URL are tamed", async () => {
    await office.goto(BASE + "/office/billing?month=2030-01", { waitUntil: "networkidle" });
    assert(/still running/.test(await text(office)), "?month=2030-01 should land on the current month (with the 'still running' notice)");
    await office.goto(BASE + "/office/billing?month=basura", { waitUntil: "networkidle" });
    const label = (await office.locator('nav[aria-label="Month"] span.cond').first().innerText()).trim();
    assert(label === monthLabel, `?month=basura showed '${label}', expected '${monthLabel}'`);
    await office.goto(BASE + "/office/billing", { waitUntil: "networkidle" });
  });

  await step(office, "billing: Prepare drafts one pre-invoice per customer", async () => {
    await office.getByRole("button", { name: "Prepare pre-invoices" }).click();
    await office.getByText(/pre-invoices? drafted · a person approves each one/).waitFor({ timeout: 90_000 });
    await office.waitForLoadState("networkidle");
    const drafts = await office.locator("tbody tr", { hasText: "Draft · open" }).count();
    assert(drafts >= 1, "no row turned into 'Draft · open' (does the table refresh after the action?)");
    if (drafts !== 8) warn(`${drafts} drafts instead of 8 (customers without movements are skipped)`);
    const row = office.locator("tbody tr", { hasText: "C001" });
    c001Base = eurosOf(await row.locator("td").nth(5).innerText());
    assert(c001Base, "C001 has no base amount");
    console.log(`   C001 base ${c001Base}`);
    if (/september 2026/i.test(monthLabel)) assert(c001Base.startsWith(WANT_C001_BASE), `C001 base is ${c001Base}, expected ${WANT_C001_BASE} €`);
    else warn(`month is ${monthLabel}: the 675,66 € check only applies to September 2026 (this base is ${c001Base})`);
    c001Id = ((await row.locator('a[href^="/office/billing/"]').getAttribute("href")) ?? "").split("/").pop() ?? "";
  });

  await step(office, "billing: Prepare again does not duplicate or change anything", async () => {
    await office.getByRole("button", { name: "Prepare pre-invoices" }).click();
    await office.getByText(/pre-invoices? drafted/).waitFor({ timeout: 90_000 });
    await office.waitForLoadState("networkidle");
    assert((await office.locator("tbody tr").count()) === 8, "the table does not have 8 rows any more");
    const row = office.locator("tbody tr", { hasText: "C001" });
    const again = eurosOf(await row.locator("td").nth(5).innerText());
    assert(again === c001Base, `C001 base changed from ${c001Base} to ${again}`);
  });

  await step(office, "billing: C001 detail has 'rows 21 · no exit' and '2 · leaves dd/mm', and the check line", async () => {
    await office.goto(`${BASE}/office/billing/${c001Id}`, { waitUntil: "networkidle" });
    const t = await text(office);
    assert(/last day included/.test(t), "no 'last day included' period line");
    assert(/23 pallets: 21 no exit · 2 leave \d\d\/\d\d/.test(t), "no '23 pallets: 21 no exit · 2 leave dd/mm' split");
    const m = t.match(/Check · detail ([\d.,]+) pallet·days = summary ([\d.,]+) pallet·days/) ?? t.match(/Check · detail ([\d.,]+) pallet·days = summary ([\d.,]+)/);
    assert(m && m[1] === m[2], "the check line is missing or detail ≠ summary");
    assert(!/It cannot be approved/.test(t), "the red 'cannot be approved' band is showing");
  });

  await step(office, "billing: rule Fraction → Full changes the amount; back to Fraction restores it", async () => {
    await office.goto(BASE + "/office/clients/C001", { waitUntil: "networkidle" });
    const t = await text(office);
    assert(/pico 12/.test(t), "C001 sheet does not show 'pico 12' for PELUCHE-30");
    assert(/33/.test(t), "C001 sheet does not show 33 pallets of PELUCHE-30");
    await office.getByRole("button", { name: "Full pallet" }).click();
    await office.waitForTimeout(1500);
    await office.goto(BASE + "/office/billing", { waitUntil: "networkidle" });
    assert(/Draft used Fraction: prepare again/.test(await text(office)), "no 'Draft used Fraction: prepare again' warning after switching C001 to Full");
    await office.getByRole("button", { name: "Prepare pre-invoices" }).click();
    await office.getByText(/pre-invoices? drafted/).waitFor({ timeout: 90_000 });
    await office.waitForLoadState("networkidle");
    const full = eurosOf(await office.locator("tbody tr", { hasText: "C001" }).locator("td").nth(5).innerText());
    if (full === c001Base) warn(`C001 base is the same in Full and Fraction (${full}): there may be no loose pallet in that month`);
    await office.goto(`${BASE}/office/billing/${c001Id}`, { waitUntil: "networkidle" });
    if (!/Loose pallets:\s*Full pallet/.test(await text(office))) warn("the C001 detail does not say 'Loose pallets: Full pallet'");
    // back to Fraction
    await office.goto(BASE + "/office/clients/C001", { waitUntil: "networkidle" });
    await office.getByRole("button", { name: "Fraction" }).click();
    await office.waitForTimeout(1500);
    await office.goto(BASE + "/office/billing", { waitUntil: "networkidle" });
    await office.getByRole("button", { name: "Prepare pre-invoices" }).click();
    await office.getByText(/pre-invoices? drafted/).waitFor({ timeout: 90_000 });
    await office.waitForLoadState("networkidle");
    const back = eurosOf(await office.locator("tbody tr", { hasText: "C001" }).locator("td").nth(5).innerText());
    assert(back === c001Base, `C001 base is ${back} after returning to Fraction, expected ${c001Base}`);
  });

  await step(office, "billing: Approve locks C001; preparing again leaves it as it was", async () => {
    await office.goto(`${BASE}/office/billing/${c001Id}`, { waitUntil: "networkidle" });
    await office.getByRole("button", { name: "Approve", exact: true }).click();
    await office.getByText(/this pre-invoice no longer changes/).waitFor({ timeout: 20_000 });
    await office.goto(BASE + "/office/billing", { waitUntil: "networkidle" });
    await office.getByRole("button", { name: "Prepare pre-invoices" }).click();
    await office.getByText(/pre-invoices? drafted/).waitFor({ timeout: 90_000 });
    await office.waitForLoadState("networkidle");
    const row = office.locator("tbody tr", { hasText: "C001" });
    assert(/Approved/.test(await row.innerText()), "C001 is not shown as Approved");
    assert(/frozen/.test(await row.innerText()), "C001's rule is not shown as frozen");
    assert(eurosOf(await row.locator("td").nth(5).innerText()) === c001Base, "C001's base changed after approval");
    assert(/Already approved/.test(await text(office)), "the console does not say 'Already approved.'");
  });

  await step(office, "billing: C001 detail prints without the side bar", async () => {
    await office.goto(`${BASE}/office/billing/${c001Id}`, { waitUntil: "networkidle" });
    await office.emulateMedia({ media: "print" });
    const sidebarVisible = await office.locator("aside, nav").evaluateAll((els) => els.some((e) => (e as HTMLElement).offsetParent !== null && e.getBoundingClientRect().width > 150));
    await office.emulateMedia({ media: "screen" });
    if (sidebarVisible) warn("print view still shows a wide side bar or navigation: check by eye");
  });

  // ---------- 7. permissions ----------
  await step(null, "permissions: the operator cannot open the office billing; a customer neither", async () => {
    await pda.goto(BASE + "/office/billing", { waitUntil: "domcontentloaded" });
    assert(!new URL(pda.url()).pathname.startsWith("/office/billing"), `operator got into ${pda.url()}`);
    if (process.env.E2E_CLIENT_USER && process.env.E2E_CLIENT_PASS) {
      const clientCtx = await browser.newContext(phone);
      const cp = await clientCtx.newPage();
      watch(cp, "client");
      await login(cp, process.env.E2E_CLIENT_USER, process.env.E2E_CLIENT_PASS);
      assert(new URL(cp.url()).pathname.startsWith("/portal"), `customer landed on ${cp.url()}`);
      await noSideScroll(cp, "/portal");
      await cp.goto(BASE + "/office/billing", { waitUntil: "domcontentloaded" });
      assert(!new URL(cp.url()).pathname.startsWith("/office/billing"), `customer got into ${cp.url()}`);
      await cp.goto(BASE + `/office/billing/${c001Id}`, { waitUntil: "domcontentloaded" });
      assert(!new URL(cp.url()).pathname.startsWith("/office/billing"), `customer got into the pre-invoice ${cp.url()}`);
      await cp.goto(BASE + `/operator/pick/${outboundId}`, { waitUntil: "domcontentloaded" });
      assert(!new URL(cp.url()).pathname.startsWith("/operator"), `customer got into the PDA ${cp.url()}`);
      await shot(cp, "customer-blocked");
      await clientCtx.close();
    } else warn("E2E_CLIENT_USER / E2E_CLIENT_PASS not set: customer permissions not checked");
  });

  // ---------- 8. phone, office side ----------
  const phoneOffice = await browser.newContext(phone);
  const po = await phoneOffice.newPage();
  watch(po, "office-phone");
  po.setDefaultTimeout(20_000);
  await step(po, "375 px: office pages do not scroll sideways", async () => {
    await login(po, process.env.E2E_OFFICE_USER!, process.env.E2E_OFFICE_PASS!);
    const bad: string[] = [];
    for (const path of ["/office", "/office/inbox", "/office/billing", `/office/billing/${c001Id}`, "/office/clients", "/office/clients/C001", "/office/trace", "/office/alerts"]) {
      await po.goto(BASE + path, { waitUntil: "networkidle" });
      const { sw, iw } = await po.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      if (sw > iw + 1) bad.push(`${path} (${sw}px)`);
      await shot(po, `phone${path}`);
    }
    assert(!bad.length, `these pages scroll sideways at 375 px: ${bad.join(", ")}`);
  });
  await step(pda, "375 px: PDA pages do not scroll sideways", async () => {
    for (const path of ["/operator", "/operator/putaway"]) {
      await pda.goto(BASE + path, { waitUntil: "networkidle" });
      await noSideScroll(pda, path);
    }
  });

  // ---------- 9. replay ----------
  await step(office, "replay the morning, then billing still opens", async () => {
    await office.goto(BASE + "/office/inbox", { waitUntil: "networkidle" });
    await office.getByRole("button", { name: /Replay the morning/ }).click();
    await office.waitForLoadState("networkidle");
    assert(await office.getByRole("button", { name: /Let the clerk handle \d+ messages/ }).count(), "after the replay the messages are not waiting again");
    await office.goto(BASE + "/office/billing", { waitUntil: "networkidle" });
    assert((await office.locator("tbody tr").count()) === 8, "billing does not show 8 rows after the replay");
    warn("after a replay the pallets picked for the approved order stay in the dispatch lane (EXP): reseed before the next run");
  });

  await browser.close();

  // ---------- report ----------
  const failed = results.filter((r) => r.status === "fail");
  const noisy = [...new Set(problems)];
  console.log("\n================ E2E ================");
  for (const r of results) console.log(`${r.status === "pass" ? "pass" : "FAIL"}  ${(r.ms / 1000).toFixed(1).padStart(5)}s  ${r.name}${r.note ? `\n        ${r.note}` : ""}`);
  console.log(`\n${results.length - failed.length}/${results.length} steps pass · ${warnings.length} warnings · ${noisy.length} browser problems`);
  if (warnings.length) console.log("\nWarnings:\n" + warnings.map((w) => `  - ${w}`).join("\n"));
  if (noisy.length) console.log("\nConsole errors / failed requests (this must be empty):\n" + noisy.map((p) => `  - ${p}`).join("\n"));
  console.log(`\nScreenshots: ${SHOTS}`);
  writeFileSync(join(SHOTS, "report.json"), JSON.stringify({ base: BASE, results, warnings, problems: noisy }, null, 2));
  process.exit(failed.length || noisy.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
