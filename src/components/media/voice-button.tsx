"use client";

import { useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";

/** Hold-free voice note: tap to record, tap to send. */
export function VoiceButton({ onAudio, label = "Voice note to the office" }: { onAudio: (dataUrl: string) => Promise<void>; label?: string }) {
  const recorder = useRef<MediaRecorder | null>(null);
  const [state, setState] = useState<"idle" | "recording" | "sending">("idle");
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setState("sending");
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.readAsDataURL(blob);
        });
        try {
          await onAudio(dataUrl);
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
