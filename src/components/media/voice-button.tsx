"use client";

import { useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { recordingToWav } from "@/lib/audio/to-wav";

/** A note longer than this stops by itself (16 kHz WAV = 32 KB per second, about 1.9 MB a minute; uploads take up to 3 MB). */
const MAX_SECONDS = 60;

/** Hold-free voice note: tap to record, tap to send. */
export function VoiceButton({ onAudio, label = "Voice note to the office" }: { onAudio: (audio: Blob) => Promise<void>; label?: string }) {
  const recorder = useRef<MediaRecorder | null>(null);
  const [state, setState] = useState<"idle" | "recording" | "sending">("idle");
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream);
      const limit = setTimeout(() => rec.state === "recording" && rec.stop(), MAX_SECONDS * 1000);
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        clearTimeout(limit);
        stream.getTracks().forEach((t) => t.stop());
        setState("sending");
        let blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        // Meta's voice model only takes mono 16 kHz WAV: convert here. If this browser cannot, the original still goes to the office as audio.
        try {
          blob = await recordingToWav(blob);
        } catch (err) {
          console.warn("voice note kept in its original format", err);
        }
        // Sent as a file, not as a data URL: a server action refuses a string argument over 1,000,000 characters (≈ 23 s of WAV).
        try {
          await onAudio(blob);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not send it.");
        }
        setState("idle");
      };
      recorder.current = rec;
      rec.start();
      setState("recording");
    } catch {
      setError("The microphone is not available.");
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={state === "sending"}
        onClick={() => (state === "recording" ? recorder.current?.stop() : start())}
        className={`cond flex w-full items-center justify-center gap-2 border-[1.5px] border-dock-ink px-4 py-3 text-sm font-semibold ${
          state === "recording" ? "bg-dock-red text-white" : "bg-white"
        }`}
      >
        {state === "sending" ? <Loader2 size={16} className="animate-spin" /> : state === "recording" ? <Square size={14} /> : <Mic size={16} />}
        {state === "recording" ? "Recording… tap to send" : state === "sending" ? "Sending…" : label}
      </button>
      {error && <p className="mt-1 text-xs text-dock-red">{error}</p>}
    </div>
  );
}
