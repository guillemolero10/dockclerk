// Voice notes against the real Meta voice model (muse-voice-transcribe-1.0), through the app's own transcribe().
// Local only, no database, invented notes spoken with macOS `say` (voice Mónica / Paulina). Cost: $0.18 per hour of audio, about nothing.
//
//   npx tsx --env-file=.env scripts/voice-live.ts
//
// What it does for each note: takes a 44.1 kHz stereo WAV (what a phone-like recording looks like once decoded), makes the same
// 16 kHz mono WAV the PDA makes in the browser (src/lib/audio/*), transcribes it and checks that the key words came back.
// Also checks that the original format (webm) is NOT sent and that without META_API_KEY nothing is sent (plan B).
// Make the files: see ~/dockclerk-e2e/2026-10-31-meta/voice/ (say -v Mónica -o m1.aiff "..."; ffmpeg -ac 2 -ar 44100 -c:a pcm_s16le m1-44k-stereo.wav).
// Needs META_API_KEY. Exit code 1 if a note loses a key word or the plan B misbehaves.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { transcribe } from "../src/lib/ai/voice";
import { downsample, encodeWav, toMono, WAV_RATE, wavInfo } from "../src/lib/audio/wav";

const DIR = join(homedir(), "dockclerk-e2e", "2026-10-31-meta", "voice");
const HINTS = ["Bebidas Montgó", "Granzas Mediterráneo", "Cosmética Aitana", "Juguetes Levante"];
const NOTES: { file: string; says: string; mustHave: RegExp[] }[] = [
  { file: "m1", says: "Toni de Bebidas Montgó, mañana dos palés y medio de horchata", mustHave: [/montg[oó]/i, /dos pal[eé]s/i, /medio/i, /horchata/i] },
  { file: "m2", says: "El palé tres del camión de Granzas está mojado y hay dos cajas rotas", mustHave: [/granzas/i, /mojado/i, /dos cajas/i, /rotas/i] },
  { file: "m3", says: "Hola, soy Toni. Necesito cuarenta cajas de agua del lote L2610A para el viernes tres de noviembre", mustHave: [/cuarenta cajas/i, /agua/i, /viernes/i, /tres de noviembre/i] },
];

/** 44.1 kHz stereo 16-bit PCM file -> the 16 kHz mono WAV the browser makes. */
function likeTheBrowser(file: string) {
  const bytes = new Uint8Array(readFileSync(file));
  const info = wavInfo(bytes)!;
  const data = new DataView(bytes.buffer, bytes.byteOffset + 44);
  const frames = Math.floor((bytes.length - 44) / (2 * info.channels));
  const channels = Array.from({ length: info.channels }, (_, c) => Float32Array.from({ length: frames }, (_, i) => data.getInt16((i * info.channels + c) * 2, true) / 32768));
  return encodeWav(downsample(toMono(channels), info.sampleRate, WAV_RATE), WAV_RATE);
}

(async () => {
  if (!process.env.META_API_KEY) {
    console.error("Needs META_API_KEY (use --env-file=.env).");
    process.exit(2);
  }
  let failed = 0;
  const say = (ok: boolean, s: string) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${s}`); };

  for (const n of NOTES) {
    const stereo = join(DIR, `${n.file}-44k-stereo.wav`);
    if (!existsSync(stereo)) { console.error(`missing ${stereo}`); process.exit(2); }
    const wav = likeTheBrowser(stereo);
    const t = Date.now();
    const text = await transcribe({ mime: "audio/wav", base64: Buffer.from(wav).toString("base64") }, HINTS);
    const secs = ((Date.now() - t) / 1000).toFixed(1);
    const missing = n.mustHave.filter((r) => !text || !r.test(text));
    say(!!text && missing.length === 0, `"${n.says}" -> "${text}" (${secs} s, ${wav.length} bytes)${missing.length ? ` missing ${missing.map(String).join(" ")}` : ""}`);
  }

  // Original recording formats are never sent (Meta would answer 400): the note stays as audio.
  const webm = join(DIR, "m1.webm");
  if (existsSync(webm)) say((await transcribe({ mime: "audio/webm", base64: readFileSync(webm).toString("base64") })) === null, "webm is not sent, transcript null (kept as audio)");
  say((await transcribe({ mime: "audio/wav", base64: readFileSync(join(DIR, "m1-44k-stereo.wav")).toString("base64") })) === null, "44.1 kHz stereo WAV is not sent (Meta would answer 400)");

  // Plan B: without the key transcribe returns null and does not call anything.
  const key = process.env.META_API_KEY;
  delete process.env.META_API_KEY;
  say((await transcribe({ mime: "audio/wav", base64: Buffer.from(likeTheBrowser(join(DIR, "m1-44k-stereo.wav"))).toString("base64") })) === null, "without META_API_KEY: null, the note stays as audio for the office");
  process.env.META_API_KEY = key;
  process.exit(failed ? 1 : 0);
})();
