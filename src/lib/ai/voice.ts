// Voice notes from the floor, transcribed by Muse Voice Transcribe.
// Returns null without a key; the note is still kept as audio for the office.

import { providers } from "./client";

export async function transcribe(audio: { mime: string; base64: string }) {
  const p = providers.voice();
  if (!p) return null;
  try {
    const form = new FormData();
    form.append("model", p.model);
    form.append("language", "es");
    const ext = audio.mime.includes("mp4") ? "m4a" : audio.mime.includes("ogg") ? "ogg" : "webm";
    form.append("file", new Blob([Buffer.from(audio.base64, "base64")], { type: audio.mime }), `note.${ext}`);
    const res = await fetch(`${p.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${p.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`${p.name} answered ${res.status}`);
    const data = (await res.json()) as { text?: string };
    return data.text?.trim() || null;
  } catch (error) {
    console.error("transcribe", error);
    return null;
  }
}
