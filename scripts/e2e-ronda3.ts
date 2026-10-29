// Checks of the 29/10 night round 3 that need a session and the database (localhost only; WRITES to the database: reseed after).
// SPENDS MODEL MONEY when the server has a model key: portal orders (about 0.01 $ each) and one run of the clerk over the 15 seed messages (about 0.05 $).
//
//   E2E_OFFICE_USER/PASS, E2E_OPERATOR_USER/PASS, E2E_CLIENT_USER/PASS in the environment (never printed), then run it from the dockclerk folder:
//   STEP=portal npx tsx --env-file=.env scripts/e2e-ronda3.ts   (a, b, g, d: portal order in "To approve", Replay, approve + pick + Replay, other customer)
//   STEP=inbox  npx tsx --env-file=.env scripts/e2e-ronda3.ts   (c: Turia needs a chosen platform, Discard works; runs the clerk on the 15 seed messages)
//   STEP=floor  npx tsx --env-file=.env scripts/e2e-ronda3.ts   (e Today vs clients, f PDA receive normal and with 1 damaged box, h driver link 0 and 70 pallets, PDA note form)
//
// Screenshots go to E2E_SHOTS (default ~/dockclerk-e2e/2026-10-29-ronda3).
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { chromium, type Page } from "playwright-core";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("localhost only");
const SHOTS = process.env.E2E_SHOTS || join(homedir(), "dockclerk-e2e", "2026-10-29-ronda3");
mkdirSync(SHOTS, { recursive: true });
const STEP = process.env.STEP || "";
const E = (k: string) => process.env[k] || (() => { throw new Error("missing " + k); })();
const db = new PrismaClient();
const phone = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const arg = ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"];

const results: [string, boolean | null, string][] = [];
const log = (id: string, ok: boolean | null, s: string) => {
  results.push([id, ok, s]);
  console.log(`${ok === null ? "INFO" : ok ? "PASS" : "FAIL"}  [${id}] ${s}`);
};
let n = 0;
const shot = (p: Page, l: string) => p.screenshot({ path: join(SHOTS, `${String(++n).padStart(2, "0")}-${STEP}-${l}.png`), fullPage: true }).catch(() => undefined);
const problems: string[] = [];
const watch = (p: Page, who: string) => {
  p.on("console", (m) => m.type() === "error" && !/favicon/i.test(m.text()) && problems.push(`[${who}] console: ${m.text().slice(0, 200)}`));
  p.on("pageerror", (e) => problems.push(`[${who}] pageerror: ${String(e.message).slice(0, 200)}`));
  p.on("response", (r) => r.status() >= 500 && problems.push(`[${who}] HTTP ${r.status()} ${r.url().replace(BASE, "")}`));
};
const flat = async (p: Page) => ((await p.locator("body").innerText()) ?? "").replace(/\s+/g, " ");

async function login(p: Page, user: string, pass: string) {
  await p.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await p.locator('input[name="username"]').fill(user);
  await p.locator('input[name="password"]').fill(pass);
  await Promise.all([p.waitForURL((u) => u.pathname !== "/", { timeout: 30_000 }), p.getByRole("button", { name: /^Sign in/ }).click()]);
}

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
const aiCalls = async () => (await db.aiSpend.findUnique({ where: { day: today() } }))?.calls ?? 0;
const snapshot = () => {
  const raw = execFileSync("npx", ["tsx", "--env-file=.env", "scripts/state-snapshot.ts"], { encoding: "utf8", cwd: join(__dirname, "..") });
  return JSON.parse(raw.slice(raw.indexOf("{")));
};
const jsonDiff = (a: unknown, b: unknown) => {
  const A = JSON.stringify(a, null, 1).split("\n"), B = JSON.stringify(b, null, 1).split("\n");
  const sb = new Set(B), sa = new Set(A);
  return [...A.filter((x) => !sb.has(x)).map((x) => "- " + x), ...B.filter((x) => !sa.has(x)).map((x) => "+ " + x)];
};

async function replay(office: Page) {
  await office.goto(BASE + "/office/inbox", { waitUntil: "networkidle" });
  await office.getByRole("button", { name: /Replay the morning/ }).click();
  await office.getByRole("button", { name: /Let the clerk handle \d+ messages/ }).waitFor({ timeout: 90_000 });
  await office.waitForLoadState("networkidle");
}
const newButton = async (office: Page) => {
  const b = office.getByRole("button", { name: /Let the clerk handle \d+ messages/ });
  return (await b.count()) ? Number(((await b.first().innerText()).match(/handle (\d+)/) ?? [])[1]) : 0;
};

async function ask(c: Page, q: string) {
  await c.goto(BASE + "/portal/ask", { waitUntil: "networkidle" });
  const before = await c.locator("details.dock-console").count();
  await c.getByPlaceholder(/Ask about your stock/).fill(q);
  const t0 = Date.now();
  await c.getByRole("button", { name: /Send/ }).click();
  while ((await c.locator("details.dock-console").count()) <= before && Date.now() - t0 < 90_000) await c.waitForTimeout(500);
  const secs = (Date.now() - t0) / 1000;
  const text = ((await c.locator("div.space-y-1\\.5").last().innerText().catch(() => "")) ?? "").replace(/\s+/g, " ");
  await c.locator("details.dock-console summary").last().click().catch(() => undefined);
  const logText = (await c.locator("details.dock-console").last().innerText().catch(() => "")).replace(/\s+/g, " ");
  return { text, logText, secs };
}

/** Picks every pallet of an outbound on the PDA (whole pallets and split picks). Returns the number of steps. */
async function pickAll(pda: Page, no: number) {
  let href = "";
  for (const w of ["N1", "N2"]) {
    await pda.goto(`${BASE}/operator?w=${w}`, { waitUntil: "networkidle" });
    const links = await pda.locator('a[href^="/operator/pick/"]').evaluateAll((as) => as.map((a) => ({ h: a.getAttribute("href") ?? "", t: (a as HTMLElement).innerText })));
    const m = links.find((l) => Number((l.t.match(/Nº\s*(\d+)/) ?? [])[1]) === no);
    if (m) { href = m.h; break; }
  }
  if (!href) return -1;
  await pda.goto(BASE + href, { waitUntil: "networkidle" });
  let steps = 0;
  for (let i = 0; i < 80; i++) {
    const t = await flat(pda);
    if (/is prepared/i.test(t)) break;
    const split = pda.getByRole("button", { name: /^Picked \d+/ });
    if (/take only/i.test(t) && (await split.count())) await split.click({ timeout: 40_000 });
    else await pda.getByRole("button", { name: /^Picked the pallet/ }).click({ timeout: 40_000 });
    steps++;
    await pda.waitForLoadState("networkidle");
    await pda.waitForTimeout(1200);
  }
  return steps;
}

async function portal() {
  const browser = await chromium.launch({ args: arg });
  const office = await (await browser.newContext({ viewport: { width: 1366, height: 860 } })).newPage();
  const pda = await (await browser.newContext(phone)).newPage();
  const cust = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
  watch(office, "office"); watch(pda, "pda"); watch(cust, "client");
  office.setDefaultTimeout(45_000); pda.setDefaultTimeout(45_000); cust.setDefaultTimeout(60_000);
  await login(office, E("E2E_OFFICE_USER"), E("E2E_OFFICE_PASS"));
  await login(pda, E("E2E_OPERATOR_USER"), E("E2E_OPERATOR_PASS"));
  await login(cust, E("E2E_CLIENT_USER"), E("E2E_CLIENT_PASS"));

  await replay(office);
  const baseMsgs = await db.message.count();
  const baseNew = await newButton(office);
  log("base", baseNew === 15, `after Replay: ${baseMsgs} messages in the database, button says ${baseNew}`);
  const S0 = snapshot();
  const ORDER = "Mándame 10 palés de PELUCHE-30 el jueves a SuperBahía";

  // (a)
  const c0 = await aiCalls();
  const r1 = await ask(cust, ORDER);
  const c1 = await aiCalls();
  await shot(cust, "portal-order");
  log("a1", /Recibido/.test(r1.text), `portal answer (${r1.secs.toFixed(1)} s): ${r1.text.slice(-330)}`);
  log("a2", !/tokens|\$|c[eé]ntimo/i.test(r1.logText), `portal log shows no cost: ${r1.logText.slice(0, 260)}`);
  const m1 = await db.message.findFirst({ where: { channel: "PORTAL", body: ORDER }, include: { drafts: true } });
  log("a3", !!m1 && m1.status === "PROCESSED" && m1.drafts.length === 1, `message in DB: status=${m1?.status} drafts=${m1?.drafts.length} fromAddress=${m1?.fromAddress}`);
  log(null as never, null, `AiSpend.calls today: ${c0} -> ${c1} (+${c1 - c0} model calls for the whole portal turn)`);
  const costLines = ((m1?.drafts[0]?.steps as { text: string }[] | undefined) ?? []).filter((s) => /\$|tokens/i.test(s.text));
  log("a4", costLines.length === 1, `cost lines in the office log of that draft: ${costLines.length} (${costLines.map((s) => s.text).join(" | ").slice(0, 160)})`);
  await office.goto(BASE + "/office/inbox", { waitUntil: "networkidle" });
  const card = office.locator("article", { hasText: ORDER });
  log("a5", (await card.count()) === 1 && /New outbound/.test(await card.innerText()) && (await card.getByRole("button", { name: /Approve & write to software/ }).count()) === 1,
    `inbox: card for the portal order = ${await card.count()}, with Approve button, no clerk pressed; clerk button still says ${await newButton(office)} (seed messages)`);
  await shot(office, "inbox-with-portal-order");
  const cardText = (await card.first().innerText().catch(() => "")).replace(/\s+/g, " ");
  log(null as never, null, `card: ${cardText.slice(0, 380)}`);

  // (b)
  await replay(office);
  const afterB = await db.message.count();
  const gone = (await office.locator("article", { hasText: ORDER }).count()) === 0 && !(await db.message.findFirst({ where: { body: ORDER } }));
  log("b", gone && afterB === baseMsgs && (await newButton(office)) === 15, `Replay: portal message gone=${gone}, messages ${afterB} (seed ${baseMsgs}), seed messages NEW=${await newButton(office)}, drafts=${await db.draft.count()}`);
  await shot(office, "after-replay-b");

  // (g)
  const g0 = await aiCalls();
  const r2 = await ask(cust, ORDER);
  const g1 = await aiCalls();
  log(null as never, null, `second portal order: ${r2.secs.toFixed(1)} s, +${g1 - g0} model calls`);
  await office.goto(BASE + "/office/inbox", { waitUntil: "networkidle" });
  const card2 = office.locator("article", { hasText: ORDER }).first();
  for (const sel of await card2.locator("select").all()) {
    const values = await sel.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
    if (values.length) await sel.selectOption(values[0]);
  }
  await card2.getByRole("button", { name: /Approve & write to software/ }).click();
  const done = office.getByText(/Outbound Nº\s*\d+ in your software/i).first();
  await done.waitFor({ timeout: 60_000 });
  const no = Number(((await done.textContent()) ?? "").match(/Nº\s*(\d+)/)?.[1]);
  const gAfterApprove = await aiCalls();
  log("g1", no > 0, `approved: outbound Nº ${no}; model calls during approve: ${gAfterApprove - g1}`);
  const steps = await pickAll(pda, no);
  log("g2", steps > 0, `PDA picked the outbound in ${steps} steps`);
  const Smid = snapshot();
  log(null as never, null, `snapshot after picking differs from the start in ${jsonDiff(S0, Smid).length} lines`);
  await replay(office);
  const S1 = snapshot();
  const diff = jsonDiff(S0, S1);
  log("g3", diff.length === 0, `snapshot after Replay equals the one before: ${diff.length === 0 ? "identical" : "\n" + diff.slice(0, 20).join("\n")}`);
  const msgsEnd = await db.message.count();
  const ob = await db.outbound.findFirst({ where: { number: no } });
  log("g4", msgsEnd === baseMsgs && !ob && (await newButton(office)) === 15, `messages ${msgsEnd} (seed ${baseMsgs}), outbound Nº ${no} still exists=${!!ob}, seed messages NEW=${await newButton(office)}`);
  const orphanStock = await db.stock.count({ where: { location: { startsWith: "EXP-" }, outboundId: null } });
  log("g5", orphanStock === 0, `rows in EXP-* lanes without an outbound: ${orphanStock}`);
  await shot(office, "after-replay-g");

  // (d)
  const Q = "¿Cuánto stock tiene Bebidas Montgó?";
  const mBefore = await db.message.count();
  const dc0 = await aiCalls();
  const r3 = await ask(cust, Q);
  const mAfter = await db.message.count();
  await shot(cust, "portal-other-customer");
  log("d1", /solo puedo darte información de tu mercancía\. Un saludo\.?/.test(r3.text), `answer: ${r3.text.slice(-200)}`);
  log("d2", mAfter === mBefore && (await aiCalls()) === dc0, `no message in the inbox (${mBefore} -> ${mAfter}) and no model call (${dc0} -> ${await aiCalls()})`);

  log(null as never, problems.length === 0, `browser problems: ${[...new Set(problems)].join(" ; ") || "none"}`);
  await browser.close();
}

async function inbox() {
  const browser = await chromium.launch({ args: arg });
  const office = await (await browser.newContext({ viewport: { width: 1366, height: 860 } })).newPage();
  watch(office, "office");
  office.setDefaultTimeout(45_000);
  await login(office, E("E2E_OFFICE_USER"), E("E2E_OFFICE_PASS"));
  await replay(office);
  const t0 = Date.now();
  await office.getByRole("button", { name: /Let the clerk handle \d+ messages/ }).click();
  await office.getByText("AI clerk · finished").waitFor({ timeout: 300_000 });
  await office.reload({ waitUntil: "networkidle" });
  log(null as never, null, `clerk finished in ${((Date.now() - t0) / 1000).toFixed(0)} s; drafts: ${await office.locator("article").count()}`);
  const marta = office.locator("article", { hasText: "Hipermercados Turia, que lleguen antes" }).first();
  const selects = marta.locator("select");
  const nSel = await selects.count();
  log("c0", nSel >= 1, `Marta -> Turia card: ${nSel} yellow field(s); first option selected = "${nSel ? await selects.first().evaluate((s) => (s as HTMLSelectElement).selectedOptions[0]?.text) : "-"}"`);
  await shot(office, "marta-turia");
  const outBefore = await db.outbound.count();
  await marta.getByRole("button", { name: /Approve & write to software/ }).click();
  await office.waitForTimeout(2500);
  const outAfter = await db.outbound.count();
  const invalid = nSel ? await selects.first().evaluate((s) => !(s as HTMLSelectElement).checkValidity()) : false;
  log("c1", outAfter === outBefore && invalid && (await marta.count()) === 1, `Approve without choosing: outbounds ${outBefore} -> ${outAfter}, select invalid=${invalid}, card still there=${(await marta.count()) === 1}`);
  await shot(office, "marta-turia-approve-blocked");
  // Choose a platform, and approve is accepted (second card kept for Discard)
  const drafts = await db.draft.findMany({ where: { status: "PENDING" }, include: { message: true } });
  const mDraft = drafts.find((d) => d.message?.body?.includes("Hipermercados Turia, que lleguen antes"));
  await marta.getByRole("button", { name: /Discard/ }).click();
  await office.waitForTimeout(3000);
  const after = await db.draft.findUnique({ where: { id: mDraft!.id } });
  log("c2", after?.status === "DISCARDED" && (await db.outbound.count()) === outBefore, `Discard without choosing: draft status=${after?.status}, outbounds still ${await db.outbound.count()}`);
  await shot(office, "marta-discarded");
  // Another order with a yellow field: choose then approve works
  const other = office.locator("article").filter({ hasText: "New outbound" }).filter({ has: office.locator("select") }).first();
  if (await other.count()) {
    const who = (await other.locator("header").innerText()).replace(/\s+/g, " ");
    const sels = await other.locator("select").all();
    for (const sel of sels) {
      const values = await sel.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
      if (values.length) await sel.selectOption(values[0]);
    }
    await other.getByRole("button", { name: /Approve & write to software/ }).click();
    await office.getByText(/Outbound Nº\s*\d+ in your software/i).first().waitFor({ timeout: 60_000 }).then(
      () => log("c3", true, `choosing the platform then Approve works (${who})`),
      () => log("c3", false, `Approve after choosing did not create an outbound (${who})`),
    );
  } else log("c3", null, "no other outbound draft with a yellow field to approve");
  log(null as never, problems.length === 0, `browser problems: ${[...new Set(problems)].join(" ; ") || "none"}`);
  await browser.close();
}

async function floor() {
  const browser = await chromium.launch({ args: arg });
  const office = await (await browser.newContext({ viewport: { width: 1366, height: 860 } })).newPage();
  const pda = await (await browser.newContext(phone)).newPage();
  const drv = await (await browser.newContext(phone)).newPage();
  watch(office, "office"); watch(pda, "pda"); watch(drv, "driver");
  office.setDefaultTimeout(45_000); pda.setDefaultTimeout(45_000); drv.setDefaultTimeout(45_000);
  await login(office, E("E2E_OFFICE_USER"), E("E2E_OFFICE_PASS"));
  await login(pda, E("E2E_OPERATOR_USER"), E("E2E_OPERATOR_PASS"));

  // (e)
  await office.goto(BASE + "/office", { waitUntil: "networkidle" });
  const tt = await flat(office);
  const today1 = (tt.match(/Juguetes Levante[^A-Za-z]{0,40}?(\d+ plt(?: \+ \d+ picos?)?)/) ?? [])[1];
  await shot(office, "today");
  await office.goto(BASE + "/office/clients", { waitUntil: "networkidle" });
  const ct = await flat(office);
  const clients1 = (ct.match(/Juguetes Levante.{0,200}?(\d+ (?:plt|pallets?)(?: \+ \d+ picos?)?)/) ?? [])[1];
  await shot(office, "clients");
  log("e", !!today1 && /\+ 1 pico/.test(today1), `Today (Juguetes Levante): "${today1}" ; /office/clients: "${clients1}"`);
  log(null as never, null, `Today context: ${(tt.match(/Stock by customer.{0,400}/) ?? [""])[0].slice(0, 300)}`);
  log(null as never, null, `Clients context: ${(ct.match(/Juguetes Levante.{0,260}/) ?? [""])[0]}`);

  // (f) PDA receive: two deliveries, one normal and one with 1 damaged box
  const recvLinks: string[] = [];
  for (const w of ["N1", "N2"]) {
    await pda.goto(`${BASE}/operator?w=${w}`, { waitUntil: "networkidle" });
    recvLinks.push(...(await pda.locator('a[href^="/operator/receive/"]').evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))));
  }
  log(null as never, null, `PDA receive tasks: ${recvLinks.length}`);
  for (const [i, damaged] of [0, 1].entries()) {
    const href = recvLinks[i];
    if (!href) { log(`f${i + 1}`, false, "no receive task left on the PDA"); continue; }
    const id = href.split("/").pop()!;
    await pda.goto(BASE + href, { waitUntil: "networkidle" });
    const truck = pda.getByRole("button", { name: /The truck is at the dock/ });
    if (await truck.count()) { await truck.click(); await pda.waitForTimeout(3500); await pda.reload({ waitUntil: "networkidle" }); }
    const cur = Number((await pda.locator("span.mono.w-10").first().innerText()).trim());
    for (let k = cur; k > 0; k--) await pda.getByRole("button", { name: "One damaged box less" }).click();
    for (let k = 0; k < damaged; k++) await pda.getByRole("button", { name: "One damaged box more" }).click();
    const confirmName = await pda.getByRole("button", { name: /^Confirm \d+ pallets?/i }).first().innerText();
    await shot(pda, `receive-${damaged}-before`);
    await pda.getByRole("button", { name: /^Confirm \d+ pallets?/i }).first().click();
    await pda.waitForLoadState("networkidle"); await pda.waitForTimeout(3000);
    const t = await flat(pda);
    const inb = await db.inbound.findUnique({ where: { id }, include: { receipt: true } });
    const dmg = (inb?.receipt?.damages as unknown[] | null)?.length ?? 0;
    await shot(pda, `receive-${damaged}-after`);
    log(`f${i + 1}`, /pallets? received/i.test(t) && !!inb?.receivedAt && dmg === damaged && inb.status === "RECEIVED",
      `receive ${confirmName.trim()} with ${damaged} damaged: page "${t.match(/\d+ pallets? received[^.]*\./i)?.[0] ?? t.slice(0, 80)}"; DB status=${inb?.status} receivedAt=${inb?.receivedAt?.toISOString().slice(11, 16)} damages=${dmg}`);
  }
  const dmgText = await db.dockReceipt.findMany({ where: { damages: { not: undefined } }, take: 0 });
  void dmgText;

  // (h) driver link: out-of-range counts
  const inb = await db.inbound.findFirst({ where: { status: "EXPECTED", receipt: null }, orderBy: { number: "desc" } });
  if (!inb) log("h1", false, "no EXPECTED inbound without a note to open the driver link");
  else {
    await drv.goto(`${BASE}/driver/${inb.driverToken}`, { waitUntil: "networkidle" });
    if (await drv.getByRole("button", { name: /No photo\? Just type the pallets/ }).count()) await drv.getByRole("button", { name: /No photo\? Just type the pallets/ }).click();
    const input = drv.getByPlaceholder("How many pallets?");
    for (const [k, v] of [["h1", "0"], ["h2", "70"]]) {
      await input.fill(v);
      await drv.getByRole("button", { name: "Send" }).click();
      await drv.waitForTimeout(2500);
      const t = await flat(drv);
      const nextErr = /Application error|This page couldn.t load|Something went wrong|Unhandled Runtime Error|digest/i.test(t);
      const msg = t.match(/Type the number of pallets \(1 to 66\)\.?/)?.[0];
      const red = await drv.locator("p.text-dock-red").count();
      await shot(drv, `driver-${v}`);
      log(k, !!msg && !nextErr && red > 0, `driver link, typed ${v}: message="${msg ?? "none"}", red=${red}, Next error page=${nextErr}, note saved=${!!(await db.dockReceipt.findUnique({ where: { inboundId: inb.id } }))?.notePallets}`);
    }
    await input.fill("3");
    await drv.getByRole("button", { name: "Send" }).click();
    await drv.waitForTimeout(3000);
    log("h3", /3 pallets/.test(await flat(drv)), `driver link, typed 3 still works: ${(await flat(drv)).match(/.{0,30}3 pallets.{0,30}/)?.[0]}`);
  }
  // PDA note form (client-side range check, the server action also checks)
  const inb2 = await db.inbound.findFirst({ where: { status: "EXPECTED", receipt: null }, orderBy: { number: "desc" } });
  if (inb2) {
    await pda.goto(`${BASE}/operator/receive/${inb2.id}`, { waitUntil: "networkidle" });
    const truck = pda.getByRole("button", { name: /The truck is at the dock/ });
    if (await truck.count()) { await truck.click(); await pda.waitForTimeout(3500); await pda.reload({ waitUntil: "networkidle" }); }
    const box = pda.getByPlaceholder("Pallets");
    if (await box.count()) {
      for (const [k, v] of [["h4", "0"], ["h5", "70"]]) {
        await box.fill(v);
        await pda.getByRole("button", { name: "OK", exact: true }).click();
        await pda.waitForTimeout(2000);
        const t = await flat(pda);
        const nextErr = /Application error|This page couldn.t load|Something went wrong|Unhandled Runtime Error/i.test(t);
        await shot(pda, `pda-note-${v}`);
        log(k, /1 to 66/.test(t) && !nextErr, `PDA note typed ${v}: message=${/1 to 66/.test(t)}, Next error page=${nextErr}`);
      }
    } else log("h4", null, "PDA typing form not shown (the Meta key is set?)");
  } else log("h4", null, "no EXPECTED inbound without a note left for the PDA form");
  log(null as never, problems.length === 0, `browser problems: ${[...new Set(problems)].join(" ; ") || "none"}`);
  await browser.close();
}

const steps: Record<string, () => Promise<void>> = { portal, inbox, floor };
if (!steps[STEP]) throw new Error("STEP=portal|inbox|floor (see the header of this file)");
steps[STEP]()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    console.log(`\n${STEP}: ${results.filter((r) => r[1] === true).length} PASS, ${results.filter((r) => r[1] === false).length} FAIL`);
    await db.$disconnect();
  });
