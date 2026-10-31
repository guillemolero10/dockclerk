// Checks for the WAV helpers of the voice notes (src/lib/audio/wav.ts). Pure: no browser, no network, no keys.
//
//   npx tsx scripts/audio-check.ts           exit code 1 if a case fails
//   npx tsx scripts/audio-check.ts --break   sabotage (a 44.1 kHz stereo file must be refused): exits 1 if the checker is too lax
//
// The rules come from Meta's voice endpoint: "mono 16-bit PCM WAV at 16 or 24 kHz", at most 10 minutes (its own 400 message).

import { MAX_KEYWORD, MAX_KEYWORDS, voiceKeywords } from "../src/lib/audio/keywords";
import { downsample, encodeWav, isMetaWav, toMono, WAV_RATE, wavInfo } from "../src/lib/audio/wav";

const sine = (seconds: number, rate: number, hz = 440, amp = 0.5) => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const str = (b: Uint8Array, from: number, len: number) => String.fromCharCode(...b.slice(from, from + len));
const BREAK = process.argv.includes("--break");

type Case = { name: string; check: () => string | null };
const cases: Case[] = [
  {
    name: "W1 encoded WAV has a real RIFF header and Meta's format (mono, 16 bit, 16 kHz)",
    check: () => {
      const w = encodeWav(sine(1, WAV_RATE), WAV_RATE);
      const info = wavInfo(w);
      if (str(w, 0, 4) !== "RIFF" || str(w, 8, 4) !== "WAVE" || str(w, 36, 4) !== "data") return "header tags wrong";
      if (w.length !== 44 + 2 * WAV_RATE) return `size ${w.length}`;
      return info && info.channels === 1 && info.bits === 16 && info.sampleRate === 16_000 && near(info.seconds, 1, 0.001) && isMetaWav(w) ? null : `info ${JSON.stringify(info)}`;
    },
  },
  {
    name: "W2 samples survive the round trip (amplitude, clipping, silence)",
    check: () => {
      const w = encodeWav(Float32Array.of(0, 0.5, -0.5, 1.5, -1.5), 16_000);
      const v = new DataView(w.buffer);
      const got = [0, 1, 2, 3, 4].map((i) => v.getInt16(44 + i * 2, true));
      return got.join() === [0, 16383, -16384, 32767, -32768].join() ? null : `got ${got}`;
    },
  },
  {
    name: "W3 48 kHz and 44.1 kHz recordings come down to 16 kHz with the same length and loudness",
    check: () => {
      for (const from of [48_000, 44_100]) {
        const x = sine(2, from);
        const y = downsample(x, from, WAV_RATE);
        if (!near(y.length, 32_000, 1)) return `${from}: ${y.length} samples`;
        if (!near(rms(y), rms(x), 0.03)) return `${from}: loudness ${rms(y).toFixed(3)} vs ${rms(x).toFixed(3)}`;
      }
      return null;
    },
  },
  {
    name: "W4 a tone above 8 kHz does not fold back into the band (box filter, no aliasing blast)",
    check: () => {
      const y = downsample(sine(1, 48_000, 15_000, 0.5), 48_000, WAV_RATE);
      return rms(y) < 0.2 ? null : `rms ${rms(y).toFixed(3)}`;
    },
  },
  {
    name: "W5 stereo mixes down to mono by averaging; one channel is returned as is",
    check: () => {
      const mono = toMono([Float32Array.of(1, 0.5), Float32Array.of(0, -0.5)]);
      const one = Float32Array.of(0.1, 0.2);
      return mono[0] === 0.5 && mono[1] === 0 && toMono([one]) === one ? null : `got ${[...mono]}`;
    },
  },
  {
    name: "W6 24 kHz mono is accepted too; 44.1 kHz stereo, 8-bit, float and 8 kHz are refused",
    check: () => {
      const patch = (w: Uint8Array, edit: (v: DataView) => void) => {
        const c = Uint8Array.from(w);
        edit(new DataView(c.buffer));
        return c;
      };
      const base = encodeWav(sine(1, 24_000), 24_000);
      if (!isMetaWav(base)) return "24 kHz refused";
      const refused = [
        patch(base, (v) => { v.setUint16(22, 2, true); v.setUint32(24, 44_100, true); }), // the file `say` / a phone makes
        patch(base, (v) => v.setUint16(34, 8, true)),
        patch(base, (v) => v.setUint16(20, 3, true)), // IEEE float
        patch(base, (v) => v.setUint32(24, 8_000, true)),
      ];
      const lax = refused.findIndex((w) => (BREAK ? true : isMetaWav(w)));
      return lax === -1 ? null : `variant ${lax} accepted`;
    },
  },
  {
    name: "W7 webm, mp4, text, empty and truncated input are not WAV",
    check: () => {
      const webm = Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3, ...new Array(80).fill(7));
      const mp4 = Uint8Array.of(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, ...new Array(80).fill(1));
      const cut = encodeWav(sine(1, 16_000), 16_000).slice(0, 30);
      return [webm, mp4, new TextEncoder().encode("hola".repeat(40)), new Uint8Array(0), cut].some(isMetaWav) ? "something was accepted" : null;
    },
  },
  {
    name: "W8 a WAV with an extra LIST chunk before the data (ffmpeg, Audacity) is still read; more than 10 minutes is refused",
    check: () => {
      const w = encodeWav(sine(1, 16_000), 16_000);
      const list = new Uint8Array(8 + 6);
      list.set(Array.from("LIST", (c) => c.charCodeAt(0)), 0);
      new DataView(list.buffer).setUint32(4, 6, true);
      const withList = new Uint8Array([...w.slice(0, 36), ...list, ...w.slice(36)]);
      if (!isMetaWav(withList)) return "LIST chunk broke it";
      const long = encodeWav(new Float32Array(16_000 * 601), 16_000);
      return isMetaWav(long) ? "601 s accepted" : null;
    },
  },
  {
    name: "W9 a one-minute note fits the upload limit (3 MB) with room to spare",
    check: () => {
      const bytes = encodeWav(new Float32Array(WAV_RATE * 60), WAV_RATE).length;
      return bytes < 2 * 1024 * 1024 ? null : `${bytes} bytes`;
    },
  },
  {
    name: "W10 voice keywords: none longer than 30 characters (Meta answers 400 for the whole request), no repeats, capped",
    check: () => {
      const long = "Cosmética Aitana crema hidratante 50 ml y más";
      const many = Array.from({ length: 300 }, (_, i) => `articulo ${i}`);
      const k = voiceKeywords(["Bebidas Montgó", "Bebidas Montgó", long, "  Granzas   Mediterráneo ", "ab", ...many]);
      if (k.some((w) => w.length > MAX_KEYWORD)) return `too long: ${k.filter((w) => w.length > MAX_KEYWORD)}`;
      if (k.includes(long) || k.includes("ab")) return "long or tiny keyword kept";
      if (k.filter((w) => w === "Bebidas Montgó").length !== 1 || !k.includes("Granzas Mediterráneo")) return "repeats or spacing";
      if (k.length > MAX_KEYWORDS) return `${k.length} keywords`;
      return voiceKeywords().includes("palés") ? null : "generic words missing";
    },
  },
];

let failed = 0;
for (const c of cases) {
  const problem = c.check();
  if (problem) failed++;
  console.log(`${problem ? "FAIL" : "PASS"}  ${c.name}${problem ? `\n        ${problem}` : ""}`);
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
