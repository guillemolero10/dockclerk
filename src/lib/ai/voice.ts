// Voice notes from the floor, transcribed by Muse Voice Transcribe (Meta Model API, POST /v1/asr/transcribe).
// Returns null without a key; the note is still kept as audio for the office.
// Meta only accepts WAV (docs checked 31/10/2026). Phones record webm/mp4, so other formats are not sent:
// the note stays as audio until the PDA records WAV.

import { providers } from "./client";

export async function transcribe(audio: { mime: string; base64: string }) {
  const p = providers.voice();
  if (!p || !/wav|wave/i.test(audio.mime)) return null;
  try {
    const form = new FormData();
    form.append("request", new Blob([JSON.stringify({ model: p.model, audioEncoding: "WAV", mode: "PUSH_TO_TALK", languageBias: ["Spanish"] })], { type: "application/json" }));
    form.append("audio", new Blob([Buffer.from(audio.base64, "base64")], { type: "audio/wav" }), "note.wav");
    const res = await fetch(`${p.baseUrl}/asr/transcribe`, {
      method: "POST",
      headers: { Authorization: `Bearer ${p.apiKey}`, Accept: "application/json" },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`${p.name} answered ${res.status}`);
    const data = (await res.json()) as { transcript?: string };
    return data.transcript?.trim() || null;
  } catch (error) {
    console.error("transcribe", error);
    return null;
  }
}
