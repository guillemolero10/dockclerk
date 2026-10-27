"use client";

import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";

/** Shrinks a photo in the browser so it travels fast over a phone connection. */
async function shrink(file: File, max = 1600) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

/** Opens the camera on a phone (or a file picker on a computer) and hands back the photo. */
export function PhotoButton({
  label,
  busyLabel = "Sending…",
  onPhoto,
  className = "",
}: {
  label: string;
  busyLabel?: string;
  onPhoto: (dataUrl: string) => Promise<void>;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className={`cond flex w-full items-center justify-center gap-2 px-4 py-3.5 text-base font-semibold disabled:opacity-70 ${className || "bg-dock-ink text-dock-yellow"}`}
      >
        {busy ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
        {busy ? busyLabel : label}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          setError(null);
          try {
            await onPhoto(await shrink(file));
          } catch (err) {
            setError(err instanceof Error ? err.message : "Could not send the photo.");
          } finally {
            setBusy(false);
          }
        }}
      />
      {error && <p className="mt-2 text-sm text-dock-red">{error}</p>}
    </div>
  );
}
