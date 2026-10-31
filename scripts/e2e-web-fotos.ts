// Web deployed variant of e2e-fotos.ts (31/10): runs against https://dockclerk.vercel.app, WRITES to production DB (reseed after) and SPENDS model money.
//   E2E_OPERATOR_USER/PASS in the environment (never printed). Photos in E2E_PHOTOS (default ~/dockclerk-e2e/2026-10-30-fotos): albaran.jpg, albaran2.jpg, boxes.jpg.
//   MODE=operator INBOUND=<id>   PDA: truck, note photo, load photo, confirm, receipt      (INBOUND = number of the inbound, e.g. 6719)
//   MODE=fail INBOUND=<id>       same, run it against a server started with BASETEN_MODEL=nope: the screen must let you continue by hand
//   MODE=driver INBOUND=<id>     driver link: arrive + photo of the note
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { chromium, type Page } from "playwright-core";

const BASE = (process.env.E2E_BASE_URL || "https://dockclerk.vercel.app").replace(/\/$/, "");
if (!/^https:\/\/dockclerk\.vercel\.app$/.test(BASE)) throw new Error("web only (dockclerk.vercel.app)");
const PH = process.env.E2E_PHOTOS || join(homedir(), "dockclerk-e2e", "2026-10-30-fotos");
const SHOTS = join(homedir(), "dockclerk-e2e", "2026-10-31-web-fotos");
mkdirSync(SHOTS, { recursive: true });
const MODE = process.env.MODE || "operator";
const NUM = Number(process.env.INBOUND);
const db = new PrismaClient();
const problems: string[] = [];
const out = (ok: boolean | null, s: string) => console.log(`${ok === null ? "INFO" : ok ? "PASS" : "FAIL"}  ${s}`);
let n = 0;
const shot = (p: Page, l: string) => p.screenshot({ path: join(SHOTS, `${MODE}-${String(++n).padStart(2, "0")}-${l}.png`), fullPage: true });
const secs = (t: number) => ((Date.now() - t) / 1000).toFixed(1) + " s";

(async () => {
  const inbound = await db.inbound.findFirstOrThrow({ where: { number: NUM }, include: { client: true } });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on("console", (m) => m.type() === "error" && !/favicon/i.test(m.text()) && problems.push(`console: ${m.text().slice(0, 200)}`));
  p.on("pageerror", (e) => problems.push(`pageerror: ${String(e.message).slice(0, 200)}`));
  p.on("response", (r) => r.status() >= 500 && problems.push(`HTTP ${r.status()} ${r.url().replace(BASE, "")}`));
  const overflow = async (l: string) => {
    const w = await p.evaluate(() => document.documentElement.scrollWidth);
    out(w <= 376, `375 px ${l}: scrollWidth ${w}`);
  };

  if (MODE === "driver") {
    await p.goto(`${BASE}/driver/${inbound.driverToken}`, { waitUntil: "networkidle" });
    await shot(p, "start");
    const arrive = p.getByRole("button", { name: /at the gate/i });
    if (await arrive.count()) { await arrive.first().click(); await p.waitForTimeout(3000); }
    await p.goto(`${BASE}/driver/${inbound.driverToken}`, { waitUntil: "networkidle" });
    const t = Date.now();
    await p.locator('input[type="file"]').first().setInputFiles(join(PH, "albaran2.jpg"));
    await p.waitForFunction(() => /pallets/i.test(document.body.innerText) && !/reading it/i.test(document.body.innerText), null, { timeout: 120_000 }).catch(() => undefined);
    await p.waitForTimeout(4000);
    out(null, `driver note photo took ${secs(t)}`);
    await shot(p, "after-note");
    console.log((await p.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 900));
    const r = await db.dockReceipt.findUnique({ where: { inboundId: inbound.id } });
    console.log(JSON.stringify({ notePallets: r?.notePallets, readBy: r?.readBy, noteData: r?.noteData }));
    await overflow("driver");
  } else {
    await p.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await p.locator('input[name="username"]').fill(process.env.E2E_OPERATOR_USER || "operario");
    await p.locator('input[name="password"]').fill(process.env.E2E_OPERATOR_PASS!);
    await Promise.all([p.waitForURL((u) => u.pathname !== "/", { timeout: 30_000 }), p.getByRole("button", { name: /^Sign in/ }).click()]);
    await p.goto(`${BASE}/operator/receive/${inbound.id}`, { waitUntil: "networkidle" });
    const truck = p.getByRole("button", { name: /truck is at the dock/i });
    if (await truck.count()) { await truck.click(); await p.getByText("Delivery note").first().waitFor({ timeout: 30_000 }); }
    await shot(p, "start");
    // (b) note photo
    let t = Date.now();
    await p.locator('input[type="file"]').nth(0).setInputFiles(join(PH, "albaran.jpg"));
    await p.waitForFunction(() => /Read by Muse Spark|Typed by|Type the number|Pallets/i.test(document.body.innerText) && !/reading it/i.test(document.body.innerText), null, { timeout: 120_000 }).catch(() => out(false, "note: nothing after 120 s"));
    await p.waitForTimeout(3000);
    out(null, `note photo took ${secs(t)}`);
    await shot(p, "after-note");
    const r1 = await db.dockReceipt.findUnique({ where: { inboundId: inbound.id } });
    const ib = await db.inbound.findUniqueOrThrow({ where: { id: inbound.id } });
    console.log("NOTE", JSON.stringify({ notePallets: r1?.notePallets, readBy: r1?.readBy, noteData: r1?.noteData, clientDocRef: (ib as { clientDocRef?: string | null }).clientDocRef }));
    console.log("SCREEN", (await p.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 700));
    await overflow("after note");
    // (c) load photo
    t = Date.now();
    await p.locator('input[type="file"]').last().setInputFiles(join(PH, "boxes.jpg"));
    await p.waitForFunction(() => /found \d+ boxes|Counting needs|kept for the receipt/i.test(document.body.innerText), null, { timeout: 150_000 }).catch(() => out(false, "load: nothing after 150 s"));
    await p.waitForTimeout(2500);
    out(null, `load photo took ${secs(t)}`);
    await shot(p, "after-load");
    const r2 = await db.dockReceipt.findUnique({ where: { inboundId: inbound.id } });
    console.log("LOAD", JSON.stringify({ countedBy: r2?.countedBy, countedPallets: r2?.countedPallets, countedUnits: r2?.countedUnits, boxes: (r2?.boxes as { damaged: boolean }[] | null)?.map((b, i) => (b.damaged ? i + 1 : 0)).filter(Boolean), nBoxes: (r2?.boxes as unknown[] | null)?.length, damages: r2?.damages }));
    console.log("SCREEN", (await p.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 700));
    await overflow("after load");
    // (d)/(c) confirm
    const confirm = p.getByRole("button", { name: /Confirm \d+ pallets/ });
    if (MODE === "fail") {
      out(await confirm.isEnabled().catch(() => false), `fail mode: confirm button usable by hand (${await confirm.innerText().catch(() => "missing")})`);
    }
    if (await confirm.count() && (await confirm.isEnabled())) {
      await confirm.click();
      await p.getByText(/pallets received/).first().waitFor({ timeout: 60_000 }).catch(() => out(false, "confirm: no 'pallets received'"));
      await shot(p, "confirmed");
      await p.goto(`${BASE}/receipts/${inbound.id}`, { waitUntil: "networkidle" });
      await shot(p, "receipt");
      console.log("RECEIPT", (await p.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 900));
      await overflow("receipt");
    }
  }
  console.log("PROBLEMS", problems.length ? problems.join(" | ") : "none");
  await browser.close();
  await db.$disconnect();
})().catch((e) => { console.error("SCRIPT ERROR", e); process.exit(1); });
