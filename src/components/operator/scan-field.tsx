"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Keyboard, ScanLine } from "lucide-react";
import { cleanScan } from "@/lib/pallets/scan";
import { useT } from "@/lib/i18n/client";

export type ScanResult = { ok: boolean; message: string } | void;
export type ScanHandle = { focus: () => void; show: (result: { ok: boolean; message: string }) => void };

let audio: AudioContext | null = null;
/** A short low beep for a wrong scan (a warehouse is loud: the vibration and the red bar are there too). */
function beep() {
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "square";
    osc.frequency.value = 220;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.22);
  } catch {
    // no audio: the red bar is enough
  }
}

const editable = (el: Element | null) =>
  !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable);

/**
 * The field a handheld's barcode reader types into (it acts like a keyboard and ends with Enter).
 * The cursor stays here: it comes back after every scan and whenever the field loses focus, unless the person went to another field.
 * `inputMode="none"` keeps the system keyboard away; "Type" brings it back for a phone or for typing a code by hand.
 */
export function ScanField({
  label,
  onScan,
  disabled = false,
  handle,
}: {
  label: string;
  /** Gets the cleaned code (upper case, no spaces). Return the result to show it in green or red; nothing = show nothing. */
  onScan: (code: string) => ScanResult | Promise<ScanResult>;
  disabled?: boolean;
  handle?: Ref<ScanHandle>;
}) {
  const { t } = useT();
  const input = useRef<HTMLInputElement>(null);
  const [typing, setTyping] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; n: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const focus = useCallback(() => {
    if (!editable(document.activeElement) || document.activeElement === input.current) input.current?.focus({ preventScroll: true });
  }, []);
  const show = useCallback((r: { ok: boolean; message: string }) => {
    setResult((prev) => ({ ...r, n: (prev?.n ?? 0) + 1 }));
    if (!r.ok) {
      navigator.vibrate?.([120, 60, 120]);
      beep();
    }
  }, []);
  useImperativeHandle(handle, () => ({ focus: () => input.current?.focus({ preventScroll: true }), show }), [show]);

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!disabled && !busy) focus();
  }, [disabled, busy, focus]);

  const submit = async () => {
    const el = input.current;
    const code = cleanScan(el?.value ?? "");
    if (el) el.value = "";
    if (!code || busy) return focus();
    setBusy(true);
    try {
      const r = await onScan(code);
      if (r) show(r);
    } finally {
      setBusy(false);
      setTimeout(() => input.current?.focus({ preventScroll: true }), 0);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-stretch gap-2">
        <label className="relative block min-w-0 flex-1">
          <span className="sr-only">{label}</span>
          <ScanLine size={20} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dock-ink/40" />
          <input
            ref={input}
            autoFocus
            disabled={disabled}
            inputMode={typing ? "text" : "none"}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            enterKeyHint="go"
            aria-label={`${label}. ${t("scan.aria")}`}
            placeholder={t("scan.ph")}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault(); // the reader ends the code with Enter
              void submit();
            }}
            onBlur={() => {
              setTimeout(() => {
                if (!input.current || disabled) return;
                if (!editable(document.activeElement)) input.current.focus({ preventScroll: true });
              }, 80);
            }}
            className="dock-input mono h-14 pl-10 text-xl font-semibold uppercase"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setTyping((v) => !v);
            setTimeout(() => input.current?.focus({ preventScroll: true }), 0);
          }}
          aria-pressed={typing}
          className="cond flex h-14 shrink-0 items-center gap-1.5 border-[1.5px] border-dock-ink bg-white px-3 text-sm"
        >
          {typing ? <ScanLine size={16} aria-hidden /> : <Keyboard size={16} aria-hidden />}
          {typing ? t("scan.reader") : t("scan.type")}
        </button>
      </div>
      <p
        role="status"
        aria-live="polite"
        className={`min-h-[2.75rem] px-3 py-2 text-sm font-semibold ${result ? (result.ok ? "bg-emerald-700 text-white" : "bg-dock-red text-white") : "text-transparent"}`}
        data-scan-result={result ? (result.ok ? "ok" : "error") : "none"}
      >
        {result?.message ?? "·"}
      </p>
    </div>
  );
}
