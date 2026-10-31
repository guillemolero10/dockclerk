"use client";

import { useState } from "react";
import { voiceNote } from "@/app/operator/actions";
import { VoiceButton } from "@/components/media/voice-button";

/** "Pallet 3 of the Granzas truck is wet" without typing: it lands in the office's AI inbox. */
export function FloorVoice({ warehouse }: { warehouse: string }) {
  const [sent, setSent] = useState<string | null>(null);
  return (
    <section className="space-y-1.5 pt-2">
      <VoiceButton
        onAudio={async (audio) => {
          const form = new FormData();
          form.append("audio", audio, "note");
          const result = await voiceNote(warehouse, form);
          if ("error" in result) throw new Error(result.error);
          setSent(result.transcribed ? "Sent and transcribed for the office." : "Sent to the office as audio (no transcription).");
        }}
      />
      {sent && <p className="text-center text-xs text-dock-ink/60">{sent}</p>}
    </section>
  );
}
