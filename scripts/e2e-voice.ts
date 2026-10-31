// The voice note of the PDA, in a real browser (Chromium with a fake microphone that plays a spoken file) against a LOCAL server.
//   npm run dev -- -p 3100   (in another terminal; it uses the database of .env, so this WRITES one message to the inbox: reseed after)
//   E2E_OPERATOR_PASS=... npx tsx --env-file=.env scripts/e2e-voice.ts
// Checks: the browser turns the recording (webm/opus) into a mono 16 kHz WAV, the server stores that WAV and,
// with META_API_KEY, the message in the inbox carries the transcript; without it the note is kept as audio and says so.
// Spoken file: E2E_VOICE (default ~/dockclerk-e2e/2026-10-31-meta/voice/m3-24k.wav, made with `say`). Invented content only.
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright-core";
import { wavInfo } from "../src/lib/audio/wav";

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3100").replace(/\/$/, "");
if (!/^http:\/\/localhost:\d+$/.test(BASE)) throw new Error("local only (http://localhost:PORT)");
const VOICE = process.env.E2E_VOICE || join(homedir(), "dockclerk-e2e", "2026-10-31-meta", "voice", "m3-24k.wav");
const SHOTS = process.env.E2E_SHOTS || join(homedir(), "dockclerk-e2e", "2026-10-31-meta", "shots");
mkdirSync(SHOTS, { recursive: true });
const db = new PrismaClient();
let failed = 0;
const out = (ok: boolean, s: string) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${s}`); };

(async () => {
  const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${VOICE}`] });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, permissions: ["microphone"] });
  const p = await ctx.newPage();
  const problems: string[] = [];
  p.on("console", (m) => m.type() === "error" && problems.push(m.text().slice(0, 200)));
  p.on("pageerror", (e) => problems.push(String(e.message).slice(0, 200)));
  await p.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await p.locator('input[name="username"]').fill("operario");
  await p.locator('input[name="password"]').fill(process.env.E2E_OPERATOR_PASS!);
  await Promise.all([p.waitForURL((u) => u.pathname !== "/", { timeout: 30_000 }), p.getByRole("button", { name: /^Sign in/ }).click()]);
  await p.goto(BASE + "/operator", { waitUntil: "networkidle" });
  const before = await db.message.count({ where: { channel: "FLOOR" } });
  const button = p.getByRole("button", { name: /voice note/i });
  await button.click();
  await p.getByText(/Recording/).waitFor({ timeout: 10_000 });
  // The file lasts about 9.7 s and Chromium loops it. E2E_RECORD_MS=55000 records longer; E2E_AUTOSTOP=1 does not tap: the 60 s cut must send it by itself.
  const t0 = Date.now();
  if (process.env.E2E_AUTOSTOP === "1") await p.getByText(/Sending|Sent/).first().waitFor({ timeout: 90_000 });
  else {
    await p.waitForTimeout(Number(process.env.E2E_RECORD_MS || 10_000));
    await p.getByRole("button", { name: /Recording/ }).click();
  }
  console.log(`recorded for ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await p.getByText(/Sent/).waitFor({ timeout: 120_000 }).catch(() => out(false, "nothing sent in 60 s"));
  await p.screenshot({ path: join(SHOTS, "voice-sent.png") });
  const screen = (await p.getByText(/^Sent/).first().innerText().catch(() => "")).trim();
  const msg = await db.message.findFirst({ where: { channel: "FLOOR" }, orderBy: { receivedAt: "desc" } });
  out((await db.message.count({ where: { channel: "FLOOR" } })) === before + 1 && !!msg, `one new floor message (${msg?.body?.slice(0, 120)})`);
  const up = msg?.audioUrl ? await db.upload.findUnique({ where: { id: msg.audioUrl.split("/").pop()! } }) : null;
  const info = up ? wavInfo(new Uint8Array(up.data)) : null;
  out(up?.mime === "audio/wav" && info?.channels === 1 && info.bits === 16 && info.sampleRate === 16_000, `stored audio is ${up?.mime}, ${info ? `${info.channels} ch, ${info.bits} bit, ${info.sampleRate} Hz, ${info.seconds.toFixed(1)} s, ${up!.data.length} bytes` : "not a WAV"}`);
  const live = !!process.env.META_API_KEY;
  out(live ? /cuarenta cajas|agua|viernes/i.test(msg?.body ?? "") : /transcription needs the Meta key/i.test(msg?.body ?? ""), live ? `transcript came back: "${msg?.body}"` : "no META_API_KEY: kept as audio and the text says so");
  console.log(`screen: ${screen}`);
  console.log(`console errors: ${problems.length ? problems.join(" | ") : "none"}`);
  await browser.close();
  await db.$disconnect();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("SCRIPT ERROR", e); process.exit(1); });
