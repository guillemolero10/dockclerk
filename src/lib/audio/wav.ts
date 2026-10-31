// Voice notes as WAV. Muse Voice Transcribe (Meta Model API) only takes "mono 16-bit PCM WAV at 16 or 24 kHz"
// (dev.meta.ai/docs/speech-to-text, and the 400 it returns for anything else, tested 31/10/2026).
// Phones record webm (Chrome, Android) or mp4 (Safari), so the browser turns the recording into that WAV before
// sending it (see to-wav.ts). These functions are pure: no browser, no network, so scripts/audio-check.ts covers them.

export const WAV_RATE = 16_000;

/** Average blocks of samples to go from `from` Hz to `to` Hz (to < from). A box filter is enough for speech and avoids aliasing. */
export function downsample(samples: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return samples;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    out[i] = sum / (end - start);
  }
  return out;
}

/** Mix any number of channels into one by averaging them. */
export function toMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length;
  return out;
}

/** Mono, 16-bit PCM WAV file (44-byte header + data) from floats in -1..1. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // size of this block
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per frame
  view.setUint16(34, 16, true); // bits per sample
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

export type WavInfo = { channels: number; sampleRate: number; bits: number; format: number; seconds: number };

/** Reads the header of a WAV file; null if it is not RIFF/WAVE (webm, mp4, mp3…). Walks the chunks, so extra chunks (LIST) are fine. */
export function wavInfo(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let fmt: Omit<WavInfo, "seconds"> | null = null;
  for (let o = 12; o + 8 <= bytes.length; ) {
    const size = view.getUint32(o + 4, true);
    if (tag(o) === "fmt " && o + 24 <= bytes.length) {
      fmt = { format: view.getUint16(o + 8, true), channels: view.getUint16(o + 10, true), sampleRate: view.getUint32(o + 12, true), bits: view.getUint16(o + 22, true) };
    } else if (tag(o) === "data" && fmt) {
      const dataBytes = Math.min(size, bytes.length - o - 8);
      return { ...fmt, seconds: dataBytes / (fmt.sampleRate * fmt.channels * (fmt.bits / 8)) };
    }
    o += 8 + size + (size % 2);
  }
  return null;
}

/** True if Meta will accept it: mono, 16-bit integer PCM, 16 or 24 kHz, up to 10 minutes. */
export function isMetaWav(bytes: Uint8Array): boolean {
  const info = wavInfo(bytes);
  return !!info && info.format === 1 && info.channels === 1 && info.bits === 16 && (info.sampleRate === 16_000 || info.sampleRate === 24_000) && info.seconds > 0 && info.seconds <= 600;
}
