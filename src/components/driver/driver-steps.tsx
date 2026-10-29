"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, MapPin, PenLine } from "lucide-react";
import { arrive, sendNotePhoto, sendPallets, sign } from "@/app/driver/[token]/actions";
import { PhotoButton } from "@/components/media/photo-button";
import { SignaturePad } from "@/components/media/signature-pad";

/** Step 1: photo of the delivery note before arriving; typed pallets if it cannot be read. */
export function NoteStep({ token, askTyped }: { token: string; askTyped: boolean }) {
  const router = useRouter();
  const [typing, setTyping] = useState(askTyped);
  const [pallets, setPallets] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <PhotoButton
        label="Photo of the delivery note"
        busyLabel="Reading the note…"
        onPhoto={async (photo) => {
          const result = await sendNotePhoto(token, photo);
          if (!result.read) setTyping(true);
          router.refresh();
        }}
      />
      {typing ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              try {
                const result = await sendPallets(token, Number(pallets));
                setError(result.error ?? null);
                if (!result.error) router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not send it.");
              }
            });
          }}
        >
          <input
            inputMode="numeric"
            value={pallets}
            onChange={(e) => setPallets(e.target.value.replace(/\D/g, ""))}
            placeholder="How many pallets?"
            className="dock-input mono flex-1 text-base"
          />
          <button disabled={pending || !pallets} className="cond bg-dock-ink px-4 text-sm font-semibold text-dock-yellow disabled:opacity-50">
            Send
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setTyping(true)} className="w-full text-center text-xs text-dock-ink/50 underline">
          No photo? Just type the pallets
        </button>
      )}
      {error && <p className="text-sm text-dock-red">{error}</p>}
    </div>
  );
}

export function ArriveButton({ token }: { token: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() =>
        start(async () => {
          await arrive(token);
          router.refresh();
        })
      }
      className="cond flex w-full items-center justify-center gap-2 border-[1.5px] border-dock-ink bg-dock-yellow px-4 py-3.5 text-base font-semibold disabled:opacity-60"
    >
      <MapPin size={18} /> {pending ? "Telling the dock…" : "I'm at the gate"}
    </button>
  );
}

export function SignStep({ token }: { token: string }) {
  const router = useRouter();
  const [signature, setSignature] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="dock-input text-base" />
      <SignaturePad onChange={setSignature} />
      <button
        disabled={pending || !signature || !name.trim()}
        onClick={() =>
          start(async () => {
            try {
              await sign(token, signature!, name);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not sign.");
            }
          })
        }
        className="cond flex w-full items-center justify-center gap-2 bg-dock-ink px-4 py-3.5 text-base font-semibold text-dock-yellow disabled:opacity-50"
      >
        <PenLine size={18} /> {pending ? "Signing…" : "Sign the receipt"}
      </button>
      {error && <p className="text-sm text-dock-red">{error}</p>}
    </div>
  );
}

export function StepDot({ done, active, label }: { done: boolean; active: boolean; label: string }) {
  return (
    <span className="flex flex-1 flex-col items-center gap-1">
      <span
        className={`grid h-6 w-6 place-items-center border-[1.5px] border-dock-ink text-[11px] font-bold ${done ? "bg-dock-ink text-dock-yellow" : active ? "bg-dock-yellow" : "bg-white text-dock-ink/30"}`}
      >
        {done ? <Check size={13} /> : ""}
      </span>
      <span className={`cond text-[10px] ${active ? "text-dock-ink" : "text-dock-ink/45"}`}>{label}</span>
    </span>
  );
}
