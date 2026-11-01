// Language walk (ES/EN) of every screen, with a session for each role. Looks for raw dictionary keys, "undefined", "NaN",
// "{n}", English leftovers in Spanish pages (and the reverse), sideways scroll at 375 px and console/hydration errors.
//
//   . env with E2E_OFFICE_*/E2E_OPERATOR_*/E2E_CLIENT_* ; LANG_UNDER_TEST=es|en  STEP=all|office|pda|portal|switch|errors
//   LANG_UNDER_TEST=es E2E_SHOTS=~/dockclerk-e2e/<dir> npx tsx --env-file=.env scripts/e2e-idioma.ts
//
// WRITES to the database (receives a pallet, picks a step, approves a draft, prepares billing): reseed afterwards. Localhost only. Spends nothing
// if the dev server runs with BASETEN_MODEL=nope META_API_KEY= (the clerk then uses its rules).
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { PrismaClient } from "@prisma/client";
import { dictionary } from "../src/lib/i18n/dictionaries";
import { makeTranslate } from "../src/lib/i18n/core";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("localhost only");
const L = (process.env.LANG_UNDER_TEST === "en" ? "en" : "es") as "en" | "es";
const STEP = process.env.STEP || "all";
const DIR = process.env.E2E_SHOTS || join(homedir(), "dockclerk-e2e", "2026-11-01-idioma-tester", `walk-${L}`);
mkdirSync(DIR, { recursive: true });
for (const k of ["E2E_OFFICE_USER", "E2E_OFFICE_PASS", "E2E_OPERATOR_USER", "E2E_OPERATOR_PASS", "E2E_CLIENT_USER", "E2E_CLIENT_PASS"]) if (!process.env[k]) throw new Error(`missing ${k}`);

const dictL = dictionary(L);
const t = makeTranslate(dictL);
const KEYS = Object.keys(dictL);
const KEYSET = new Set(KEYS.flatMap((k) => [k, k.replace(/_p$/, "")]));
const PREFIXES = [...new Set(KEYS.map((k) => k.split(".")[0]))];
const db = new PrismaClient();

type Finding = { page: string; kind: string; detail: string };
const findings: Finding[] = [];
const problems: string[] = [];
const steps: { name: string; ok: boolean; note?: string }[] = [];
let n = 0;
const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 45).toLowerCase();
const flat = (s: string) => s.replace(/\s+/g, " ");

// English words that should not survive on a Spanish page, and Spanish words on an English one.
const EN_WORDS = /\b(the|and|with|your|from|pallets?|boxes|truck|received|loading|please|Approve|Discard|Cancel|Save|Next|Back|Sign out|Customers?|Billing|Alerts|Today|Delivery|Dock|Warehouse|Item|Lot|Draft|Open|Done|Waiting|Expected|Pending|Failed|Error|Could not|Loose|Boxes)\b/g;
const ES_WORDS = /\b(el|la|los|las|con|para|palés?|cajas?|camión|recibid[oa]s?|prevista|Aprobar|Cancelar|Guardar|Siguiente|Cerrar sesión|Clientes?|Facturación|Alertas|Hoy|Muelle|Almacén|Artículo|Lote|Borrador|Terminado|Esperando|Error|No se pudo)\b/g;

function audit(pg: string, text: string, width: number) {
  const add = (kind: string, detail: string) => findings.push({ page: `${pg} @${width}`, kind, detail: detail.slice(0, 220) });
  const T = text;
  for (const m of T.matchAll(/\b[a-z]{1,4}\.[A-Za-z0-9_.]+[A-Za-z0-9]/g)) {
    const tok = m[0];
    const pre = tok.split(".")[0];
    if (KEYSET.has(tok) || (PREFIXES.includes(pre) && /^[a-z]{1,4}\.[a-zA-Z]/.test(tok) && !/\.(com|es|app|ai|png|jpg|pdf)$/.test(tok))) add("RAW-KEY", `${tok} · …${T.slice(Math.max(0, m.index! - 40), m.index! + 60)}`);
  }
  for (const m of T.matchAll(/undefined|NaN|\[object|\{[a-zA-Z]+\}|\bnull\b/g)) add("BAD-VALUE", `${m[0]} · …${T.slice(Math.max(0, m.index! - 50), m.index! + 50)}`);
  // sentences of the other language: look at lines (not the console-style log, which stays in English on purpose)
  const bad = L === "es" ? EN_WORDS : ES_WORDS;
  for (const line of T.split("\n")) {
    const s = line.trim();
    if (s.length < 3) continue;
    const hits = [...s.matchAll(bad)].map((x) => x[0]);
    const words = s.split(/\s+/).length;
    if (hits.length >= 2 || (hits.length === 1 && words <= 3)) add("OTHER-LANG?", s);
  }
}

async function pageText(p: Page) {
  return await p.locator("body").innerText();
}

async function visit(p: Page, who: string, path: string, opts: { full?: boolean; settle?: number } = {}) {
  await p.goto(BASE + path, { waitUntil: "domcontentloaded" });
  await p.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await p.waitForTimeout(opts.settle ?? 600);
  return await look(p, who, path, opts.full);
}

async function look(p: Page, who: string, label: string, full = true) {
  const text = await pageText(p);
  const w = p.viewportSize()?.width ?? 0;
  audit(`${who}:${label}`, text, w);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (w <= 400 && over > 2) findings.push({ page: `${who}:${label} @${w}`, kind: "OVERFLOW", detail: `${over}px sideways` });
  n++;
  await p.screenshot({ path: join(DIR, `${String(n).padStart(2, "0")}-${who}-${slug(label)}-${w}.png`), fullPage: full }).catch(() => undefined);
  writeFileSync(join(DIR, "text", `${String(n).padStart(2, "0")}-${who}-${slug(label)}-${w}.txt`), text);
  return text;
}
mkdirSync(join(DIR, "text"), { recursive: true });

function watch(p: Page, who: string) {
  p.on("console", (m) => (m.type() === "error" || /hydrat/i.test(m.text())) && problems.push(`[${who}] console ${m.type()}: ${m.text().slice(0, 240)} @${p.url().replace(BASE, "")}`));
  p.on("pageerror", (e) => problems.push(`[${who}] pageerror: ${e.message.slice(0, 240)} @${p.url().replace(BASE, "")}`));
  p.on("response", (r) => r.status() >= 500 && problems.push(`[${who}] HTTP ${r.status()} ${r.url().replace(BASE, "")}`));
}

async function login(p: Page, user: string, pass: string) {
  await p.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await p.locator('input[name="username"]').fill(user);
  await p.locator('input[name="password"]').fill(pass);
  await Promise.all([p.waitForURL((u) => u.pathname !== "/", { timeout: 30_000 }), p.getByRole("button", { name: /^(Entrar|Sign in)/ }).click()]);
}

async function step(name: string, fn: () => Promise<string | void>) {
  const t0 = Date.now();
  try {
    const note = (await fn()) || undefined;
    steps.push({ name, ok: true, note });
    console.log(`pass ${((Date.now() - t0) / 1000).toFixed(1)}s ${name}${note ? ` · ${note}` : ""}`);
  } catch (e) {
    const note = (e as Error).message.split("\n")[0].slice(0, 200);
    steps.push({ name, ok: false, note });
    console.log(`FAIL ${((Date.now() - t0) / 1000).toFixed(1)}s ${name} · ${note}`);
  }
}
const re = (key: Parameters<typeof t>[0], vars: Record<string, string | number> = {}) => {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const raw = dictL[key].split("|")[0];
  return new RegExp("^" + esc(raw).replace(/\\\{(\w+)\\\}/g, (_m, k) => (k in vars ? esc(String(vars[k])) : ".+?")), "i");
};

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
  const desk = { viewport: { width: 1366, height: 860 }, locale: L === "es" ? "es-ES" : "en-US" };
  const phone = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: L === "es" ? "es-ES" : "en-US" };
  const ctxs: BrowserContext[] = [];
  const mk = async (o: typeof desk | typeof phone, lang: boolean = true) => {
    const c = await browser.newContext(o);
    if (lang) await c.addCookies([{ name: "lang", value: L, url: BASE }]);
    ctxs.push(c);
    return c;
  };
  const sess = async (o: typeof desk | typeof phone, who: string, user: string, pass: string) => {
    const p = await (await mk(o)).newPage();
    p.setDefaultTimeout(20_000);
    watch(p, who);
    await login(p, user, pass);
    return p;
  };
  const OFF = [process.env.E2E_OFFICE_USER!, process.env.E2E_OFFICE_PASS!] as const;
  const OPE = [process.env.E2E_OPERATOR_USER!, process.env.E2E_OPERATOR_PASS!] as const;
  const CLI = [process.env.E2E_CLIENT_USER!, process.env.E2E_CLIENT_PASS!] as const;
  const BYTES = `${L}`;

  // -------- login page (no session)
  if (STEP === "all" || STEP === "login") {
    for (const o of [phone, desk]) {
      const p = await (await mk(o)).newPage();
      watch(p, "login");
      await step(`login page ${o.viewport.width}px`, async () => { await visit(p, "login", "/"); });
    }
    // no cookie: Accept-Language decides
    const c = await browser.newContext({ ...desk, locale: "es-ES" });
    ctxs.push(c);
    const p = await c.newPage();
    await step("no cookie + es-ES browser → Spanish login", async () => {
      await p.goto(BASE + "/");
      const txt = await pageText(p);
      if (!/Entrar|Iniciar|Acceder/i.test(txt)) throw new Error("login is not in Spanish with Accept-Language es-ES: " + flat(txt).slice(0, 120));
    });
    const c2 = await browser.newContext({ ...desk, locale: "en-US" });
    ctxs.push(c2);
    const p2 = await c2.newPage();
    await step("no cookie + en-US browser → English login", async () => {
      await p2.goto(BASE + "/");
      if (!/Sign in/i.test(await pageText(p2))) throw new Error("not English");
    });
  }

  // -------- PDA
  if (STEP === "all" || STEP === "pda") {
    const pda = await sess(phone, "pda", ...OPE);
    let recvId = "";
    await step("PDA home", async () => {
      const txt = await visit(pda, "pda", "/operator");
      const href = await pda.locator('a[href^="/operator/receive/"]').first().getAttribute("href");
      recvId = (href ?? "").split("/").pop() ?? "";
      return `receive link ${recvId ? "found" : "NOT found"}; ${flat(txt).slice(0, 60)}`;
    });
    await step("PDA receive: open", async () => {
      if (!recvId) throw new Error("no inbound to receive");
      await visit(pda, "pda", `/operator/receive/${recvId}`);
      const truck = pda.getByRole("button", { name: re("rcs.truckHere") });
      if (await truck.count()) { await truck.first().click(); await pda.waitForTimeout(2500); await look(pda, "pda", "receive after truck-at-dock"); }
    });
    await step("PDA receive: one pallet by hand + confirm", async () => {
      await pda.getByLabel(t("rcs.howMany"), { exact: true }).fill("1");
      await pda.getByRole("button", { name: re("rcs.add_p", { n: 1 }) }).click();
      await pda.waitForTimeout(500);
      for (const lot of await pda.getByLabel(/^(Lot|Lote), (pallet|palé) 1/i).all()) if (!(await lot.inputValue())) await lot.fill("L2611X");
      await look(pda, "pda", "receive one pallet filled");
      await pda.getByRole("button", { name: re("rcs.confirm_p", { n: 1 }) }).click();
      await pda.getByText(/1 (palé recibido|pallet received)/i).first().waitFor({ timeout: 40_000 });
      await pda.waitForTimeout(800);
      await look(pda, "pda", "receive done");
    });
    await step("PDA receive: language switch keeps the page", async () => {
      const url = new URL(pda.url()).pathname;
      const other = L === "es" ? "EN" : "ES";
      await pda.getByRole("button", { name: other, exact: true }).first().click();
      await pda.getByRole("button", { name: other, exact: true }).first().and(pda.locator('[aria-pressed="true"]')).waitFor({ timeout: 30_000 });
      await pda.waitForTimeout(1500);
      if (new URL(pda.url()).pathname !== url) throw new Error(`moved from ${url} to ${pda.url()}`);
      await look(pda, "pda", `after-switch-to-${other}`);
      await pda.getByRole("button", { name: L.toUpperCase(), exact: true }).first().click();
      await pda.getByRole("button", { name: L.toUpperCase(), exact: true }).first().and(pda.locator('[aria-pressed="true"]')).waitFor({ timeout: 30_000 });
      await pda.waitForTimeout(1500);
    });
    await step("PDA receive errors: 0 pallets, 70 pallets", async () => {
      const id = await db.inbound.findFirst({ where: { status: { in: ["EXPECTED", "RECEIVING"] } }, select: { id: true } });
      if (!id) throw new Error("no open inbound left to test errors");
      await visit(pda, "pda", `/operator/receive/${id.id}`);
      const truck = pda.getByRole("button", { name: re("rcs.truckHere") });
      if (await truck.count()) { await truck.first().click(); await pda.waitForTimeout(2500); }
      const out: string[] = [];
      await pda.getByLabel(t("rcs.howMany"), { exact: true }).fill("70");
      await pda.getByRole("button", { name: /^(Add|Añadir) 70/ }).click().catch(() => undefined);
      await pda.waitForTimeout(800);
      out.push("70 → " + flat((await pda.getByRole("alert").allInnerTexts().catch(() => [])).join(" ") || (await pageText(pda)).match(/(A delivery has at most|Una entrega tiene como máximo)[^.]*\./)?.[0] || "(no message found)"));
      await look(pda, "pda", "receive 70 pallets");
      const confirm = pda.getByRole("button", { name: /^(Confirm|Confirmar) \d+/ });
      if (await confirm.count()) { await confirm.first().click(); await pda.waitForTimeout(2500); out.push("confirm 70 → " + flat((await pda.getByRole("alert").allInnerTexts().catch(() => [])).join(" "))); await look(pda, "pda", "receive 70 confirm"); }
      return out.join(" | ");
    });
    await step("PDA put away", async () => {
      await visit(pda, "pda", "/operator/putaway");
      await pda.getByRole("button", { name: /(do it by hand|hacerlo a mano)/i }).click().catch(() => undefined);
      const btn = pda.getByRole("button", { name: /^(Pallet placed in|Palé colocado en|Palé ubicado en)/ });
      if (await btn.count()) { await btn.first().click(); await pda.waitForTimeout(2500); await look(pda, "pda", "putaway after one"); }
    });
    await step("PDA pick one step", async () => {
      await visit(pda, "pda", "/operator");
      const link = pda.locator('a[href^="/operator/pick/"]').first();
      if (!(await link.count())) return "no outbound to pick (approve a draft first)";
      const href = (await link.getAttribute("href"))!;
      await visit(pda, "pda", href);
      const b = pda.getByRole("button", { name: /^(Picked|Recogido)/ });
      if (await b.count()) { await b.first().click(); await pda.waitForTimeout(3500); await look(pda, "pda", "pick after one step"); }
    });
    for (const [name, path] of [["PDA home on desktop", "/operator"]] as const) {
      const d = await sess(desk, "pda-desk", ...OPE);
      await step(name, async () => { await visit(d, "pda-desk", path); });
    }
  }

  // -------- errors in the cookie's language (client check for 0 / 70 pallets, plus the server action called directly)
  if (STEP === "errors") {
    const pda = await sess(phone, "pda", ...OPE);
    await step("PDA receive: 0 and 70 pallets show the notice in the language", async () => {
      await visit(pda, "pda", "/operator");
      const href = await pda.locator('a[href^="/operator/receive/"]').first().getAttribute("href");
      if (!href) throw new Error("no inbound to receive (reseed)");
      await visit(pda, "pda", href);
      const truck = pda.getByRole("button", { name: re("rcs.truckHere") });
      if (await truck.count()) { await truck.first().click(); await pda.waitForTimeout(2500); }
      const msgs: string[] = [];
      for (const v of ["0", "70", "70"]) {
        await pda.getByLabel(t("rcs.howMany"), { exact: true }).fill(v);
        await pda.getByRole("button", { name: /^(Add|Añadir) \d+/ }).first().click().catch(() => undefined);
        await pda.waitForTimeout(1200);
        const txt = flat(await pageText(pda));
        msgs.push(`${v}#${msgs.length + 1} → ` + (txt.match(/(Type the number of pallets[^.]*\.|Escribe el número de palés[^.]*\.|A delivery has at most[^.]*\.|Una entrega admite[^.]*\.)/)?.[0] ?? "(no notice found)"));
        await look(pda, "pda", `receive ${v} pallets try ${msgs.length}`);
      }
      return msgs.join(" | ");
    });
  }

  // -------- driver (token from the DB)
  if (STEP === "all" || STEP === "driver") {
    const inb = await db.inbound.findFirst({ where: { status: { in: ["EXPECTED", "RECEIVING", "RECEIVED"] } }, orderBy: { id: "asc" }, select: { driverToken: true, id: true } });
    const p = await (await mk(phone)).newPage();
    watch(p, "driver");
    await step("driver link", async () => {
      if (!inb) throw new Error("no inbound");
      await visit(p, "driver", `/driver/${inb.driverToken}`);
      const sign = await p.locator(`a[href*="/receipt"]`).count();
      await visit(p, "driver", `/driver/${inb.driverToken}/receipt`).catch(() => undefined);
      return `receipt link ${sign}`;
    });
    await step("driver link with a bad token", async () => { await visit(p, "driver", "/driver/not-a-token"); });
    const pd = await (await mk(desk)).newPage();
    await step("driver on desktop", async () => { if (inb) await visit(pd, "driver-desk", `/driver/${inb.driverToken}`); });
  }

  // -------- portal
  if (STEP === "all" || STEP === "portal") {
    for (const [o, tag] of [[phone, "portal"], [desk, "portal-desk"]] as const) {
      const p = await sess(o, tag, ...CLI);
      for (const path of ["/portal", "/portal/stock", "/portal/movements", "/portal/ask"]) await step(`${tag} ${path}`, async () => { await visit(p, tag, path); });
      if (tag === "portal") {
        await step("portal ask (rules): stock question", async () => {
          await p.goto(BASE + "/portal/ask", { waitUntil: "networkidle" });
          await p.getByPlaceholder(dictL["pt.askPh"]).fill(L === "es" ? "¿Cuántos palés de peluche tengo?" : "How many pallets of PELUCHE-30 do I have?");
          await p.getByRole("button", { name: dictL["pt.send"] }).click();
          await p.waitForTimeout(9000);
          await look(p, tag, "ask answered");
        });
        await step("portal movements: open an act/receipt", async () => {
          await p.goto(BASE + "/portal/movements", { waitUntil: "networkidle" });
          const a = p.locator('a[href^="/receipts/"]').first();
          if (!(await a.count())) return "no receipt link in movements";
          await Promise.all([p.waitForURL(/\/receipts\//), a.click()]);
          await look(p, tag, "receipt from portal");
        });
      }
    }
  }

  // -------- office
  if (STEP === "all" || STEP === "office") {
    for (const [o, tag] of [[desk, "office"], [phone, "office-m"]] as const) {
      const p = await sess(o, tag, ...OFF);
      const isD = tag === "office";
      const simple = ["/office", "/office/dock", "/office/alerts", "/office/trace", "/office/clients", "/office/clients/C001", "/office/analyst", "/office/warehouse/setup", "/office/inbox"];
      for (const path of simple) await step(`${tag} ${path}`, async () => { await visit(p, tag, path); });
      await step(`${tag} trace search`, async () => {
        await p.goto(BASE + "/office/trace?q=HORCH", { waitUntil: "networkidle" });
        await look(p, tag, "trace search HORCH");
      });
      await step(`${tag} warehouse 3D`, async () => { await visit(p, tag, "/office/warehouse", { settle: 5000 }); });
      if (isD) {
        await step("office inbox: clerk handles the inbox (rules) + approve a draft", async () => {
          await p.goto(BASE + "/office/inbox", { waitUntil: "networkidle" });
          const rep = p.getByRole("button", { name: dictL["ib.replay"] });
          if (await rep.count()) { await rep.first().click(); await p.waitForTimeout(6000); }
          const go = p.getByRole("button", { name: /^(Let the clerk handle|Que el administrativo gestione)/ });
          await go.first().click();
          await p.getByText(dictL["ib.finished"]).first().waitFor({ timeout: 120_000 });
          await p.waitForTimeout(1500);
          await look(p, tag, "inbox after clerk");
          const card = p.getByRole("button", { name: /^(Approve & write to software|Aprobar y escribir)/ }).first();
          const label = (await card.count()) ? await card.innerText() : "(no approve button: " + dictL["ib.action.CREATE_OUTBOUND"] + ")";
          if (await card.count()) {
            // yellow fields start on "Choose…" and are mandatory: pick the first real option in each
            for (const s of await p.locator("select[required]").all()) { const v = await s.locator("option:not([value=''])").first().getAttribute("value"); if (v) await s.selectOption(v).catch(() => undefined); }
            await card.click();
            await p.waitForTimeout(4000);
            await look(p, tag, "inbox after approve");
          }
          return label;
        });
        await step("office inbox: language switch mid-flow keeps the page", async () => {
          await p.goto(BASE + "/office/inbox", { waitUntil: "networkidle" });
          const other = L === "es" ? "EN" : "ES";
          await p.getByRole("button", { name: other, exact: true }).first().click();
          await p.getByRole("button", { name: other, exact: true }).first().and(p.locator('[aria-pressed="true"]')).waitFor({ timeout: 30_000 });
          if (!new URL(p.url()).pathname.startsWith("/office/inbox")) throw new Error("moved to " + p.url());
          await look(p, tag, `inbox-switched-${other}`);
          await p.getByRole("button", { name: L.toUpperCase(), exact: true }).first().click();
          await p.waitForTimeout(2500);
        });
        await step("office dock: truck arrived / schedule (rules)", async () => {
          await p.goto(BASE + "/office/dock", { waitUntil: "networkidle" });
          const sched = p.getByRole("button", { name: /^(Let the clerk schedule|Que el administrativo)/ });
          if (await sched.count()) { await sched.first().click(); await p.waitForTimeout(4000); await look(p, tag, "dock after clerk schedules"); }
          const arr = p.getByRole("button", { name: dictL["dk.truckArrived"] });
          if (await arr.count()) { await arr.first().click(); await p.waitForTimeout(2500); await look(p, tag, "dock truck arrived"); }
        });
        await step("office 3D with a pick order (?pick=)", async () => {
          const o = await db.outbound.findFirst({ where: { status: "REQUESTED" }, orderBy: { createdAt: "desc" }, select: { id: true } });
          if (!o) return "no REQUESTED outbound";
          await visit(p, tag, `/office/warehouse?pick=${o.id}`, { settle: 5000 });
        });
        await step("office billing: Prepare + a pre-invoice", async () => {
          await visit(p, tag, "/office/billing");
          await p.getByRole("button", { name: dictL["bp.prepare"] }).click();
          await p.getByText(/pre-invoices? drafted|prefacturas? (preparad|en borrador)/i).first().waitFor({ timeout: 90_000 }).catch(() => undefined);
          await p.waitForLoadState("networkidle");
          await look(p, tag, "billing prepared");
          const a = p.locator('a[href^="/office/billing/"]').first();
          if (!(await a.count())) throw new Error("no pre-invoice link");
          const href = (await a.getAttribute("href"))!;
          await visit(p, tag, href);
        });
        await step("office receipt /receipts/<id>", async () => {
          const r = await db.dockReceipt.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } });
          if (!r) throw new Error("no receipt");
          await visit(p, tag, `/receipts/${r.id}`);
        });
        await step("office legacy (not translated on purpose): just opens", async () => { await visit(p, tag, "/office/legacy/inbounds"); });
      } else {
        await step("office-m billing + pre-invoice", async () => {
          await visit(p, tag, "/office/billing");
          const a = p.locator('a[href^="/office/billing/"]').first();
          if (await a.count()) await visit(p, tag, (await a.getAttribute("href"))!);
        });
        await step("office-m receipt", async () => {
          const r = await db.dockReceipt.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } });
          if (r) await visit(p, tag, `/receipts/${r.id}`);
        });
      }
    }
  }

  // -------- language is remembered across reloads and roles (same browser context)
  if (STEP === "all" || STEP === "switch") {
    const c = await browser.newContext(desk); ctxs.push(c);
    const p = await c.newPage(); watch(p, "switch");
    await step("switch: login page ES|EN sticks across reload and roles", async () => {
      await p.goto(BASE + "/");
      const first = L === "es" ? "EN" : "ES";
      await p.getByRole("button", { name: first, exact: true }).first().click();
      await p.waitForTimeout(2500);
      const a = await pageText(p);
      await p.reload();
      const b = await pageText(p);
      if (flat(a) !== flat(b)) throw new Error("the page changed on reload");
      await login(p, ...OFF);
      const o = await pageText(p);
      const wantOtherLang = L === "es" ? /Sign out|Today|AI inbox/i : /Cerrar sesión|Hoy|Bandeja/i;
      if (!wantOtherLang.test(o)) throw new Error("office did not keep the chosen language: " + flat(o).slice(0, 100));
      await p.getByRole("button", { name: /sign out|cerrar sesión|salir/i }).first().click().catch(() => undefined);
      await p.waitForTimeout(2000);
      await login(p, ...OPE);
      const o2 = await pageText(p);
      if (!wantOtherLang.test(o2) && !(L === "es" ? /Receive|Put away|Pick/i : /Recibir|Ubicar|Recoger/i).test(o2)) throw new Error("operator did not keep the language");
      await p.screenshot({ path: join(DIR, "switch-operator.png") });
    });
  }

  for (const c of ctxs) await c.close();
  await browser.close();
  await db.$disconnect();

  const byKind: Record<string, number> = {};
  for (const f of findings) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
  writeFileSync(join(DIR, "report.json"), JSON.stringify({ lang: L, steps, findings, problems }, null, 1));
  console.log(`\n${steps.filter((s) => s.ok).length}/${steps.length} steps ok · findings ${JSON.stringify(byKind)} · browser problems ${problems.length}`);
  const seen = new Set<string>();
  for (const f of findings) { const k = `${f.kind}|${f.detail}`; if (seen.has(k)) continue; seen.add(k); console.log(`  [${f.kind}] ${f.page} · ${f.detail}`); }
  for (const x of [...new Set(problems)]) console.log("  PROBLEM " + x);
  console.log(BYTES && `Evidence: ${DIR}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
