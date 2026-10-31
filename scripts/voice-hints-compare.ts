// Tester of de46d02: does "Bebidas Montgó" come back spelled right with the keywords the app really sends (DB names) vs a short list vs none?
//   npx tsx --env-file=.env scripts/voice-hints-compare.ts    (needs META_API_KEY; read-only on the DB; cost ≈ nothing)
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { transcribe } from "../src/lib/ai/voice";
import { voiceKeywords } from "../src/lib/audio/keywords";
import { downsample, encodeWav, toMono, WAV_RATE, wavInfo } from "../src/lib/audio/wav";

const DIR = join(homedir(), "dockclerk-e2e", "2026-10-31-meta", "voice");
function likeTheBrowser(file: string) {
  const bytes = new Uint8Array(readFileSync(file));
  const info = wavInfo(bytes)!;
  const data = new DataView(bytes.buffer, bytes.byteOffset + 44);
  const frames = Math.floor((bytes.length - 44) / (2 * info.channels));
  const channels = Array.from({ length: info.channels }, (_, c) => Float32Array.from({ length: frames }, (_, i) => data.getInt16((i * info.channels + c) * 2, true) / 32768));
  return encodeWav(downsample(toMono(channels), info.sampleRate, WAV_RATE), WAV_RATE);
}
(async () => {
  const db = new PrismaClient();
  const [clients, items] = await Promise.all([db.client.findMany({ select: { name: true } }), db.item.findMany({ select: { description: true } })]);
  const dbHints = [...clients.map((c) => c.name.replace(/,?\s+S\.?[AL]\.?$/i, "")), ...items.map((i) => i.description)];
  const kws = voiceKeywords(dbHints);
  console.log(`clients: ${clients.map((c) => c.name).join(" | ")}`);
  console.log(`keywords sent by the app: ${kws.length} (first 20: ${kws.slice(0, 20).join(", ")})`);
  console.log(`'Bebidas Montgó' among them: ${kws.some((k) => /montg/i.test(k))}`);
  for (const file of ["m1", "m2"]) {
    const wav = Buffer.from(likeTheBrowser(join(DIR, `${file}-44k-stereo.wav`))).toString("base64");
    const clientOnly = clients.map((c) => c.name.replace(/,?\s+S\.?[AL]\.?$/i, ""));
    const groups: [string, string[]][] = [["no hints", []], ["short list", ["Bebidas Montgó", "Granzas Mediterráneo"]], ["DB hints (as the app)", dbHints], ["clients only (+generic)", clientOnly], ["clients only, no generic words", clientOnly]];
    for (const [label, hints] of groups) {
      if (label.includes("no generic")) { const form = voiceKeywords(hints).filter((k) => !["palés", "palé", "cajas", "albarán", "lote", "muelle", "carretilla", "horchata"].includes(k)); console.log(`   (keywords ${form.length}; the app always adds the generic ones, so this one is the same as the line above)`); continue; }
      console.log(`${file} ${label}: ${await transcribe({ mime: "audio/wav", base64: wav }, hints)}`);
    }
  }
  await db.$disconnect();
})();
