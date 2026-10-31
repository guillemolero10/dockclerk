// Voice notes from the floor, transcribed by Muse Voice Transcribe (Meta Model API, POST /v1/asr/transcribe).
// Returns null without a key; the note is still kept as audio for the office.
// Meta only accepts mono 16-bit PCM WAV at 16 or 24 kHz (docs and a 400 checked 31/10/2026). Phones record webm/mp4, so the
// PDA converts the recording in the browser (src/lib/audio/to-wav.ts). Anything that is not that WAV is not sent:
// the note stays as audio for the office and the text says so. Without META_API_KEY nothing is sent either.
// `hints` (customer and article names) go as `keywords`: "Bebidas Montgó" came back as "bebidas mogo" without them.

import { providers } from "./client";
import { voiceKeywords } from "../audio/keywords";
import { isMetaWav } from "../audio/wav";

export async function transcribe(audio: { mime: string; base64: string }, hints: string[] = []) {
  const p = providers.voice();
  if (!p) return null;
  const bytes = Buffer.from(audio.base64, "base64");
  if (!isMetaWav(bytes)) return null;
  try {
    const keywords = voiceKeywords(hints);
    const form = new FormData();
    form.append("request", new Blob([JSON.stringify({ model: p.model, audioEncoding: "WAV", mode: "PUSH_TO_TALK", languageBias: ["Spanish"], keywords })], { type: "application/json" }));
    form.append("audio", new Blob([bytes], { type: "audio/wav" }), "note.wav");
    const res = await fetch(`${p.baseUrl}/asr/transcribe`, {
      method: "POST",
      headers: { Authorization: `Bearer ${p.apiKey}`, Accept: "application/json" },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`${p.name} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { transcript?: string };
    return data.transcript?.trim() || null;
  } catch (error) {
    console.error("transcribe", error);
    return null;
  }
}
