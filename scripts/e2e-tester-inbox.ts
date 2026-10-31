// Tester of de46d02: the voice notes reach the office inbox with their transcript and the clerk understands them. LOCAL only, WRITES drafts, SPENDS ≈ 0.05 $ (the clerk runs on every NEW message).
//   E2E_OFFICE_USER/PASS in the environment. Evidence in E2E_SHOTS.
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3100").replace(/\/$/, "");
if (!/^http:\/\/localhost:\d+$/.test(BASE)) throw new Error("localhost only");
const SHOTS = process.env.E2E_SHOTS || join(homedir(), "dockclerk-e2e", "2026-10-31-tester-meta");
mkdirSync(SHOTS, { recursive: true });
(async () => {
  const browser = await chromium.launch();
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const problems: string[] = [];
  p.on("console", (m) => m.type() === "error" && problems.push(m.text().slice(0, 200)));
  await p.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await p.locator('input[name="username"]').fill(process.env.E2E_OFFICE_USER || "oficina");
  await p.locator('input[name="password"]').fill(process.env.E2E_OFFICE_PASS!);
  await Promise.all([p.waitForURL((u) => u.pathname !== "/", { timeout: 30_000 }), p.getByRole("button", { name: /^Sign in/ }).click()]);
  await p.goto(BASE + "/office/inbox", { waitUntil: "networkidle" });
  await p.screenshot({ path: join(SHOTS, "inbox-before.png"), fullPage: true });
  const run = p.getByRole("button", { name: /Let the clerk handle \d+ messages/ });
  console.log("run button:", await run.count());
  if (await run.count()) {
    await run.click();
    await p.getByText(/AI clerk working/i).first().waitFor({ timeout: 30_000 }).catch(() => undefined);
    await p.waitForFunction(() => !/AI clerk working/i.test(document.body.innerText), null, { timeout: 300_000 }).catch(() => console.log("timeout waiting"));
    await p.waitForTimeout(3000);
  }
  await p.screenshot({ path: join(SHOTS, "inbox-after.png"), fullPage: true });
  const txt = (await p.locator("body").innerText()).replace(/\s+/g, " ");
  for (const m of txt.matchAll(/(mog[oó]|Montg[oó]|granzas|granjas)[^.]{0,200}/gi)) console.log("…", m[0].slice(0, 220));
  console.log("brain line:", txt.match(/brain[^.]{0,120}/i)?.[0]);
  console.log("console errors:", problems.length ? problems.join(" | ") : "none");
  await browser.close();
})();
