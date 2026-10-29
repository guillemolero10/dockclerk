// Manual checks that scripts/e2e.ts does not cover, run in a real browser against a dev server on localhost.
//
//   E2E_OFFICE_USER=… E2E_OFFICE_PASS=… E2E_OPERATOR_USER=… E2E_OPERATOR_PASS=… E2E_CLIENT_USER=… E2E_CLIENT_PASS=… \
//     STEP=approve npx tsx scripts/e2e-extra.ts        (clerk, horchata card, check 26: two tabs + double click on Approve)
//     STEP=pick    npx tsx scripts/e2e-extra.ts        (PDA: pick every open outbound of the inbox, then press "Replay the morning")
//     STEP=portal  npx tsx scripts/e2e-extra.ts        (customer: an order in English, a billing question, another customer's bill)
//
// Passwords are read from the environment only and never printed. It WRITES to the database (reseed afterwards).
// Screenshots go to E2E_SHOTS (default ~/dockclerk-e2e/extra-<date>).
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const SHOTS = process.env.E2E_SHOTS || join(homedir(), "dockclerk-e2e", `extra-${new Date().toISOString().slice(0, 10)}`);
const STEP = process.env.STEP || "";
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("localhost only");
for (const k of ["E2E_OFFICE_USER", "E2E_OFFICE_PASS", "E2E_OPERATOR_USER", "E2E_OPERATOR_PASS"]) if (!process.env[k]) throw new Error(`missing ${k}`);
mkdirSync(SHOTS, { recursive: true });

let n = 0;
const shot = (p: Page, label: string) => p.screenshot({ path: join(SHOTS, `${String(++n).padStart(2, "0")}-${STEP}-${label}.png`), fullPage: true }).catch(() => undefined);
const out = (s: string) => console.log(s);
const problems: string[] = [];
const watch = (p: Page, who: string) => {
  p.on("console", (m) => m.type() === "error" && !/favicon/i.test(m.text()) && problems.push(`[${who}] console: ${m.text().slice(0, 200)}`));
  p.on("pageerror", (e) => problems.push(`[${who}] pageerror: ${String(e.message).slice(0, 200)}`));
  p.on("response", (r) => r.status() >= 500 && problems.push(`[${who}] HTTP ${r.status()} ${r.url().replace(BASE, "")}`));
};

async function login(p: Page, user: string, pass: string) {
  await p.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await p.locator('input[name="username"]').fill(user);
  await p.locator('input[name="password"]').fill(pass);
  await Promise.all([p.waitForURL((u) => u.pathname !== "/", { timeout: 20_000 }), p.getByRole("button", { name: /^Sign in/ }).click()]);
}

const browserArgs = ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"];

async function approve() {
  const browser = await chromium.launch({ args: browserArgs });
  const ctxA = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  const ctxB = await browser.newContext({ viewport: { width: 1366, height: 860 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  watch(a, "tabA");
  watch(b, "tabB");
  await login(a, process.env.E2E_OFFICE_USER!, process.env.E2E_OFFICE_PASS!);
  await login(b, process.env.E2E_OFFICE_USER!, process.env.E2E_OFFICE_PASS!);
  await a.goto(BASE + "/office/inbox", { waitUntil: "networkidle" });
  const run = a.getByRole("button", { name: /Let the clerk handle \d+ messages/ });
  if (await run.count()) {
    const t0 = Date.now();
    await run.click();
    await a.getByText("AI clerk · finished").waitFor({ timeout: 300_000 });
    out(`clerk finished in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    await a.reload({ waitUntil: "networkidle" });
  } else out("no messages waiting: drafts are already there");

  // every draft: kind, client, doubts
  const cards = a.locator("article");
  const total = await cards.count();
  out(`drafts: ${total}`);
  for (let i = 0; i < total; i++) {
    const c = cards.nth(i);
    const head = (await c.locator("header").innerText()).replace(/\s+/g, " ");
    const doubts = await c.locator("select").count();
    const dq = await c.locator("label:has(select) span.font-medium").allInnerTexts();
    out(`  #${i} ${head} | doubts: ${doubts}${dq.length ? " -> " + dq.map((x) => x.replace(/\s+/g, " ").slice(0, 110)).join(" ; ") : ""}`);
  }
  await shot(a, "inbox-after-clerk");

  const horch = a.locator("article", { hasText: "HORCH-1L" }).filter({ hasText: "New outbound" }).first();
  const ht = ((await horch.textContent()) ?? "").replace(/\s+/g, " ");
  out(`horchata card: 2 palés + 50 cajas = ${ht.includes("2 palés + 50 cajas")}; convert_quantity = ${ht.includes("convert_quantity")}; doubts = ${await horch.locator("select").count()}`);
  const conv = (await horch.locator("details div.mono div").allInnerTexts()).filter((x) => /convert_quantity/.test(x));
  out(`  log line: ${conv.join(" | ").slice(0, 200)}`);
  await shot(a, "horchata-card");

  // Prepare the same draft in the second tab.
  await b.goto(BASE + "/office/inbox", { waitUntil: "networkidle" });
  const horchB = b.locator("article", { hasText: "HORCH-1L" }).filter({ hasText: "New outbound" }).first();
  const before = await outboundCount();
  out(`outbounds before: ${before.total} (max Nº ${before.maxNo})`);

  // 26a: two tabs, both press Approve at the same moment.
  const clickA = horch.getByRole("button", { name: /Approve & write to software/ });
  const clickB = horchB.getByRole("button", { name: /Approve & write to software/ });
  await Promise.all([clickA.click().catch((e) => out(`  tab A click: ${String(e.message).split("\n")[0]}`)), clickB.click().catch((e) => out(`  tab B click: ${String(e.message).split("\n")[0]}`))]);
  await a.waitForTimeout(6000);
  await b.waitForTimeout(500);
  const afterTabs = await outboundCount();
  out(`26a two tabs -> outbounds after: ${afterTabs.total} (max Nº ${afterTabs.maxNo}); created = ${afterTabs.total - before.total}`);
  await shot(a, "after-two-tabs-A");
  await shot(b, "after-two-tabs-B");
  const bodyB = (await b.locator("body").innerText()).replace(/\s+/g, " ");
  out(`  tab B shows an error text: ${/error|already|Application error|went wrong/i.test(bodyB) ? bodyB.match(/.{0,60}(error|already|went wrong).{0,80}/i)?.[0] : "no"}`);

  // 26b: double click on another outbound draft in the same tab.
  await a.goto(BASE + "/office/inbox", { waitUntil: "networkidle" });
  const other = a.locator("article").filter({ hasText: "New outbound" }).first();
  if (await other.count()) {
    const who = ((await other.locator("header").innerText()) ?? "").replace(/\s+/g, " ");
    const pending = await other.locator("select").count();
    out(`26b double click on: ${who} (doubts ${pending})`);
    const before2 = await outboundCount();
    await other.getByRole("button", { name: /Approve & write to software/ }).dblclick().catch((e) => out(`  dblclick: ${String(e.message).split("\n")[0]}`));
    await a.waitForTimeout(6000);
    const after2 = await outboundCount();
    out(`  outbounds ${before2.total} -> ${after2.total}; created = ${after2.total - before2.total}`);
    await shot(a, "after-dblclick");
  } else out("26b: no other New outbound draft left");
  out(problems.length ? `browser problems:\n${[...new Set(problems)].map((x) => "  " + x).join("\n")}` : "browser problems: none");
  await browser.close();
}

/** Total number of outbounds in the database, read with the read-only snapshot script (the env file is read by Node, not by this script). */
async function outboundCount() {
  const raw = execFileSync("npx", ["tsx", "--env-file=.env", "scripts/state-snapshot.ts"], { encoding: "utf8", cwd: join(__dirname, "..") });
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  return { total: j.outboundsTotal as number, maxNo: 0 };
}

async function pick() {
  const browser = await chromium.launch({ args: browserArgs });
  const phone = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  const pda = await (await browser.newContext(phone)).newPage();
  const office = await (await browser.newContext({ viewport: { width: 1366, height: 860 } })).newPage();
  watch(pda, "pda");
  watch(office, "office");
  pda.setDefaultTimeout(15_000);
  await login(pda, process.env.E2E_OPERATOR_USER!, process.env.E2E_OPERATOR_PASS!);
  await login(office, process.env.E2E_OFFICE_USER!, process.env.E2E_OFFICE_PASS!);
  // The PDA lists one building at a time. Toni's order (water + horchata, Bebidas Montgó) is in N2.
  let href = "";
  for (const w of ["N1", "N2"]) {
    await pda.goto(`${BASE}/operator?w=${w}`, { waitUntil: "networkidle" });
    const links = await pda.locator('a[href^="/operator/pick/"]').evaluateAll((as) => as.map((a) => ({ href: a.getAttribute("href") ?? "", text: (a as HTMLElement).innerText.replace(/\s+/g, " ") })));
    out(`PDA ${w}: ${links.length} pick tasks`);
    links.forEach((l) => out(`   ${l.text.slice(0, 110)}`));
    const want = new RegExp(process.env.PICK_MATCH || "Bebidas Montg.*SuperBah.*\\b9 PALLETS", "i");
    const mine = links.find((l) => want.test(l.text));
    if (mine) href = mine.href;
  }
  if (!href) throw new Error("no pick task for Bebidas Montgó on the PDA");
  await pda.goto(BASE + href, { waitUntil: "networkidle" });
  const first = (await pda.locator("body").innerText()).replace(/\s+/g, " ");
  out(`picking ${href}: ${first.match(/\d+\/\d+/)?.[0]}`);
  if (process.env.PEEK) {
    out(first.slice(0, 700));
    await shot(pda, "peek");
    await browser.close();
    return;
  }
  let split = false;
  for (let i = 0; i < 14; i++) {
    const t = (await pda.locator("body").innerText()).replace(/\s+/g, " ");
    if (/is prepared/i.test(t)) break;
    const names = await pda.getByRole("button").evaluateAll((bs) => bs.map((b) => (b as HTMLElement).innerText.replace(/\s+/g, " ").trim()));
    if (/take only/i.test(t)) {
      split = true;
      out(`  step ${i + 1}: ${t.match(/take only.{0,90}/i)?.[0]} | buttons: ${names.join(" / ")}`);
      await shot(pda, "split-step");
      await pda.getByRole("button", { name: /^Picked \d+/ }).click({ timeout: 40_000 });
    } else {
      await pda.getByRole("button", { name: /^Picked the pallet/ }).click({ timeout: 40_000 }).catch(async (e) => {
        out(`  step ${i + 1}: no "Picked the pallet" button (${String(e.message).split("\n")[0]}). Page says: ${t.slice(0, 300)} | buttons: ${names.join(" / ")}`);
        await shot(pda, "stuck");
        throw e;
      });
    }
    const t1 = Date.now();
    await pda.waitForLoadState("networkidle");
    await pda.waitForTimeout(1500);
    out(`  pick ${i + 1} done (${((Date.now() - t1) / 1000).toFixed(1)} s after the click returned)`);
  }
  const end = (await pda.locator("body").innerText()).replace(/\s+/g, " ");
  out(`  split step seen: ${split}; prepared: ${/is prepared/i.test(end)}; ${end.match(/Nº \d+ is prepared.{0,60}/i)?.[0] ?? end.slice(0, 120)}`);
  await shot(pda, "picked");
  out(problems.length ? `browser problems:\n${[...new Set(problems)].map((x) => "  " + x).join("\n")}` : "browser problems: none");
  await browser.close();
}

/** Check 25, second half: press "Replay the morning" (run after STEP=pick; compare scripts/state-snapshot.ts before and after). */
async function replay() {
  const browser = await chromium.launch({ args: browserArgs });
  const office = await (await browser.newContext({ viewport: { width: 1366, height: 860 } })).newPage();
  watch(office, "office");
  await login(office, process.env.E2E_OFFICE_USER!, process.env.E2E_OFFICE_PASS!);
  await office.goto(BASE + "/office/inbox", { waitUntil: "networkidle" });
  const t0 = Date.now();
  await office.getByRole("button", { name: /Replay the morning/ }).click();
  await office.getByRole("button", { name: /Let the clerk handle \d+ messages/ }).waitFor({ timeout: 60_000 });
  out(`replay done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await shot(office, "after-replay");
  out(problems.length ? `browser problems:\n${[...new Set(problems)].map((x) => "  " + x).join("\n")}` : "browser problems: none");
  await browser.close();
}

async function portal() {
  if (!process.env.E2E_CLIENT_USER || !process.env.E2E_CLIENT_PASS) throw new Error("missing E2E_CLIENT_*");
  const browser = await chromium.launch({ args: browserArgs });
  const c = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
  watch(c, "client");
  c.setDefaultTimeout(60_000);
  await login(c, process.env.E2E_CLIENT_USER, process.env.E2E_CLIENT_PASS);
  await c.goto(BASE + "/portal/ask", { waitUntil: "networkidle" });
  const ask = async (q: string) => {
    const before = await c.locator("details.dock-console").count();
    await c.getByPlaceholder(/Ask about your stock/).fill(q);
    const t0 = Date.now();
    await c.getByRole("button", { name: /Send/ }).click();
    while ((await c.locator("details.dock-console").count()) <= before && Date.now() - t0 < 60_000) await c.waitForTimeout(500);
    const s = ((Date.now() - t0) / 1000).toFixed(1);
    const bubbles = c.locator("div.space-y-1\\.5").last();
    const text = ((await bubbles.innerText()) ?? "").replace(/\s+/g, " ");
    await c.locator("details.dock-console summary").last().click().catch(() => undefined);
    const log = (await c.locator("details.dock-console").last().innerText().catch(() => "")).replace(/\s+/g, " ");
    out(`Q: ${q}\n  (${s} s) A: ${text.slice(0, 600)}\n  LOG: ${log.slice(0, 900)}`);
    await shot(c, `portal-${q.slice(0, 20).replace(/[^a-z0-9]+/gi, "-")}`);
  };
  if (process.env.Q) for (const q of process.env.Q.split(";;")) await ask(q.trim());
  else {
    await ask("¿cuánto llevo de almacenaje este mes?");
    await ask("¿por qué tantos palés·día en la entrada más antigua?");
    await ask("¿Cuánto lleva Bebidas Montgó de almacenaje este mes?");
    await ask("two pallets of PELUCHE-30 to Alicante");
  }
  out(problems.length ? `browser problems:\n${[...new Set(problems)].map((x) => "  " + x).join("\n")}` : "browser problems: none");
  await browser.close();
}

/** Check (ii): read-only look at Dock, Alerts, the 3D occupancy and the trace of PUZZLE-500, on a freshly seeded database. */
async function read() {
  const browser = await chromium.launch({ args: browserArgs });
  const o = await (await browser.newContext({ viewport: { width: 1366, height: 860 } })).newPage();
  watch(o, "office");
  o.setDefaultTimeout(30_000);
  await login(o, process.env.E2E_OFFICE_USER!, process.env.E2E_OFFICE_PASS!);
  const flat = async () => ((await o.locator("body").innerText()) ?? "").replace(/\s+/g, " ");
  for (const w of ["N1", "N2"]) {
    await o.goto(`${BASE}/office/dock?w=${w}`, { waitUntil: "networkidle" });
    const t = await flat();
    out(`DOCK ${w}: Truck arrived buttons=${await o.getByRole("button", { name: "Truck arrived" }).count()}, "No show"=${await o.getByRole("button", { name: "No show" }).count()}, late word=${/late/i.test(t)}; ${t.match(/\d+ trucks? · \d+ unloading, \d+ loading/)?.[0] ?? "?"}`);
    await shot(o, `dock-${w}`);
  }
  await o.goto(BASE + "/office/alerts", { waitUntil: "networkidle" });
  const al = await flat();
  out(`ALERTS: late trucks=${(al.match(/Truck [^.]{0,30}late at/g) ?? []).length}; text: ${al.slice(0, 700)}`);
  await shot(o, "alerts");
  await o.goto(BASE + "/office/warehouse", { waitUntil: "networkidle" });
  await o.locator("canvas").first().waitFor();
  await o.waitForTimeout(2500);
  const pcts = (await flat()).match(/\b\d{1,3}%/g);
  out(`3D N1 (first tab): percentages on the page = ${pcts?.slice(0, 6).join(" ")}`);
  await shot(o, "3d-n1");
  const tabs = await o.locator("a[href*='w=N2'], a:has-text('N2')").first();
  if (await tabs.count()) {
    await tabs.click();
    await o.waitForLoadState("networkidle");
    await o.waitForTimeout(2500);
    out(`3D N2: percentages = ${((await flat()).match(/\b\d{1,3}%/g) ?? []).slice(0, 6).join(" ")}`);
    await shot(o, "3d-n2");
  }
  for (const sku of ["PUZZLE-500", "PELUCHE-30"]) {
    await o.goto(`${BASE}/office/trace?q=${encodeURIComponent(sku)}`, { waitUntil: "networkidle" });
    const balance = async () => ((await flat()).match(/\d+ in = \d+ out \+ \d+ here \(units\)( · does not add up)?/) ?? ["?"])[0];
    const n = await o.locator('a[href^="/office/trace?lot="]').count();
    const lines: string[] = [];
    if (n === 0) {
      lines.push(`direct trace: ${await balance()}`);
      await shot(o, `trace-${sku}`);
    }
    for (let i = 0; i < n; i++) {
      await o.goto(`${BASE}/office/trace?q=${encodeURIComponent(sku)}`, { waitUntil: "domcontentloaded" });
      await o.locator('a[href^="/office/trace?lot="]').nth(i).click();
      await o.waitForLoadState("networkidle");
      lines.push(await balance());
      if (i === 0) await shot(o, `trace-${sku}`);
    }
    out(`TRACE ${sku}: ${n} lots listed -> ${lines.join(" | ")}`);
    if (n === 0) out(`   page text: ${(await flat()).replace(/^.*Lot trace/, "").slice(0, 700)}`);
  }
  out(problems.length ? `browser problems:\n${[...new Set(problems)].map((x) => "  " + x).join("\n")}` : "browser problems: none");
  await browser.close();
}

const steps: Record<string, () => Promise<void>> = { approve, pick, replay, portal, read };
if (!steps[STEP]) throw new Error("STEP=read|approve|pick|replay|portal");
steps[STEP]().catch((e) => {
  console.error(e);
  process.exit(1);
});
