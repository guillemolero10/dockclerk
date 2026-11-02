// Known risk of the reader-first PDA: scan pallets, THEN use the optional albarán step (here: the typed pallet count, which saves notePallets and
// refreshes the page the same way a note photo does). Does ReceiveForm (its key changes) lose the scans?  Localhost only; writes a note count to one inbound.
//   npx tsx --env-file=.env scripts/e2e-lector-risk.ts   (needs E2E_OPERATOR_*; takes the 1st EXPECTED (reseed first) inbound)
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright-core";
const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error("localhost only");
const db = new PrismaClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const inb = (await db.inbound.findMany({ where: { status: "EXPECTED" }, orderBy: { number: "asc" } }))[0];
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: "en-US" });
  const p = await c.newPage();
  await p.goto(BASE + "/");
  await p.locator('input[name="username"]').fill(process.env.E2E_OPERATOR_USER!);
  await p.locator('input[name="password"]').fill(process.env.E2E_OPERATOR_PASS!);
  await Promise.all([p.waitForURL((u) => u.pathname !== "/"), p.getByRole("button", { name: /^Sign in/ }).click()]);
  await p.goto(`${BASE}/operator/receive/${inb.id}`, { waitUntil: "networkidle" });
  const truck = p.getByRole("button", { name: /truck is at the dock/i });
  if (await truck.count()) await truck.click();
  await p.waitForSelector('input[enterkeyhint="go"]', { timeout: 30_000 });
  await sleep(800);
  for (const code of ["RSK-0001", "RSK-0002"]) {
    await p.keyboard.type(code);
    await p.keyboard.press("Enter");
    await sleep(1200);
  }
  const before = await p.locator("body").innerText();
  console.log("before:", /2 scanned|2 of/.test(before) ? "2 scanned" : "?? " + before.slice(0, 80));
  await p.locator("details").filter({ hasText: /photos/i }).first().locator("summary").click();
  // a blank 1x1 picture: the model cannot read a note from it, so the typed-count form shows up (costs well under a cent)
  await p.locator("details").filter({ hasText: /photos/i }).first().locator('input[type="file"]').first().setInputFiles(process.env.E2E_BLANK_PNG!);
  await sleep(15000);
  const mid = await p.locator("body").innerText();
  console.log("after the blank photo, scans still there:", /RSK-0001/.test(mid) && /RSK-0002/.test(mid));
  const typed = (await p.getByPlaceholder(/pallets/i).count()) > 0;
  console.log("typed-count field visible:", typed);
  if (typed) {
    await p.getByPlaceholder(/pallets/i).first().fill("5");
    await p.getByRole("button", { name: /^OK$/i }).click();
    await sleep(6000);
  }
  const after = await p.locator("body").innerText();
  const kept = /RSK-0001/.test(after) && /RSK-0002/.test(after);
  console.log(kept ? "RESULT: scans KEPT after the note step" : "RESULT: scans LOST after the note step (ReceiveForm re-keyed)");
  await p.screenshot({ path: process.env.HOME + "/dockclerk-e2e/2026-11-01-lector-bd/risk-after-note.png", fullPage: true });
  process.exit(0);
})();
