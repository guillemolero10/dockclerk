"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { useSearchParams } from "next/navigation";
import { Camera, Keyboard, ScanLine, X } from "lucide-react";
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

/** A reader types a whole code in a burst: this many ms of silence after a fast burst means the code is complete. */
const BURST_IDLE_MS = 250;
/** Keys closer than this are a reader, not a thumb. */
const BURST_GAP_MS = 80;
const ENDS = /[\r\n\t]/;

const editable = (el: Element | null) =>
  !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable);

type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorClass = new (opts: { formats: string[] }) => Detector;

/**
 * Reads a barcode with the camera when there is no reader (or the reader is not set up): Chrome on Android has a barcode detector built in.
 * Stops the camera as soon as it reads one code.
 */
function CameraScan({ onCode, onClose, onFail }: { onCode: (code: string) => void; onClose: () => void; onFail: (message: string) => void }) {
  const { t } = useT();
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const Ctor = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
    if (!Ctor) {
      onFail(t("scan.cameraNo"));
      return;
    }
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    const detector = new Ctor({ formats: ["code_128", "code_39", "ean_13", "ean_8", "qr_code"] });
    const tick = async () => {
      if (done) return;
      const v = video.current;
      try {
        if (v && v.readyState >= 2) {
          const found = await detector.detect(v);
          const code = found.find((f) => f.rawValue.trim())?.rawValue;
          if (code && !done) {
            done = true;
            navigator.vibrate?.(60);
            onCode(code);
            return;
          }
        }
      } catch {
        // a frame that could not be read: try the next one
      }
      timer = setTimeout(tick, 150);
    };
    if (!navigator.mediaDevices?.getUserMedia) {
      onFail(t("scan.cameraError"));
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((s) => {
        if (done) return s.getTracks().forEach((tr) => tr.stop());
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play().catch(() => {});
        }
        void tick();
      })
      .catch(() => {
        if (!done) onFail(t("scan.cameraError"));
      });
    return () => {
      done = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative overflow-hidden bg-black">
      <video ref={video} playsInline muted className="block h-56 w-full object-cover" />
      <div aria-hidden className="pointer-events-none absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 bg-dock-red/80" />
      <p className="cond absolute inset-x-0 bottom-0 bg-black/60 px-3 py-1.5 text-center text-sm text-white">{t("scan.cameraHint")}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("scan.cameraClose")}
        className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center bg-white text-dock-ink"
      >
        <X size={22} aria-hidden />
      </button>
    </div>
  );
}

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
  const [camera, setCamera] = useState(false);
  // `?scandebug=1` lists what the reader really sends (keys, input events), to set up a handheld without a computer.
  const debugOn = useSearchParams().has("scandebug");
  const [debug, setDebug] = useState<string[]>([]);
  const burst = useRef<{ last: number; maxGap: number; count: number; bulk: boolean; timer: ReturnType<typeof setTimeout> | null }>({ last: 0, maxGap: 0, count: 0, bulk: false, timer: null });

  const log = (line: string) => {
    if (debugOn) setDebug((d) => [line, ...d].slice(0, 12));
  };

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
    if (burst.current.timer) clearTimeout(burst.current.timer);
    burst.current = { last: 0, maxGap: 0, count: 0, bulk: false, timer: null };
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
      <form
        className="flex items-stretch gap-2"
        onSubmit={(e) => {
          e.preventDefault(); // the "go" key of the keyboard, or an Enter the browser turns into a submit
          log("submit");
          void submit();
        }}
      >
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
              log(`key ${e.key} code=${e.code} ${e.keyCode}`);
              // The reader ends the code with Enter (some set-ups send Tab, or a raw keyCode 13 with no key name).
              if (e.key === "Tab" && (typing || !e.currentTarget.value)) return; // an empty field or a thumb lets Tab move on
              if (e.key !== "Enter" && e.key !== "Tab" && e.keyCode !== 13) return;
              e.preventDefault();
              void submit();
            }}
            onInput={(e) => {
              const el = e.currentTarget;
              const ne = e.nativeEvent as InputEvent;
              log(`input ${ne.inputType ?? "?"} ${JSON.stringify(ne.data ?? "")} → ${JSON.stringify(el.value)}`);
              // A reader that pastes the code with its line break, or commits it through the keyboard service.
              if (ENDS.test(el.value)) return void submit();
              if (typing) return;
              // No Enter at all: a fast burst followed by silence is a whole code.
              const now = performance.now();
              const b = burst.current;
              if (b.last) b.maxGap = Math.max(b.maxGap, now - b.last);
              b.last = now;
              b.count += 1;
              if (ne.inputType === "insertFromPaste" || (ne.data?.length ?? 0) >= 3) b.bulk = true;
              if (b.timer) clearTimeout(b.timer);
              b.timer = setTimeout(() => {
                // One key alone is a thumb, not a reader (unless the whole code came in one go).
                const fast = burst.current.bulk || (burst.current.count >= 2 && burst.current.maxGap < BURST_GAP_MS);
                if (fast && cleanScan(input.current?.value ?? "").length >= 3) {
                  log("auto-submit (no Enter)");
                  void submit();
                } else burst.current = { last: 0, maxGap: 0, count: 0, bulk: false, timer: null };
              }, BURST_IDLE_MS);
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
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => setCamera((v) => !v)}
          aria-pressed={camera}
          aria-label={t("scan.camera")}
          className="cond flex h-14 w-14 shrink-0 items-center justify-center border-[1.5px] border-dock-ink bg-white"
        >
          <Camera size={20} aria-hidden />
        </button>
      </form>
      {camera && !disabled && (
        <CameraScan
          onCode={(code) => {
            setCamera(false);
            if (input.current) input.current.value = code;
            void submit();
          }}
          onClose={() => setCamera(false)}
          onFail={(message) => {
            setCamera(false);
            show({ ok: false, message });
          }}
        />
      )}
      <p
        role="status"
        aria-live="polite"
        className={`min-h-[2.75rem] px-3 py-2 text-sm font-semibold ${result ? (result.ok ? "bg-emerald-700 text-white" : "bg-dock-red text-white") : "text-transparent"}`}
        data-scan-result={result ? (result.ok ? "ok" : "error") : "none"}
      >
        {result?.message ?? "·"}
      </p>
      {debugOn && (
        <pre className="mono max-h-48 overflow-auto bg-dock-ink p-2 text-[11px] leading-tight text-white" data-scan-debug>
          {debug.length ? debug.join("\n") : "scandebug: waiting for the reader…"}
        </pre>
      )}
    </div>
  );
}
