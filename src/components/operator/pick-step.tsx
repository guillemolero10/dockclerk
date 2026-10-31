"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Printer, Route } from "lucide-react";
import { pick } from "@/app/operator/actions";

type Content = { sku: string; lot: string | null; units: number; word: string };
type Step = {
  key: string;
  kind: "pallet" | "boxes";
  /** Row to send to the server (the first row of a whole pallet). */
  stockId: string;
  location: string;
  level: number | null;
  code: string | null;
  mixed: boolean;
  /** Boxes to take (boxes steps). */
  take: number | null;
  /** Boxes on the row they come from (boxes steps). */
  rowUnits: number;
  contents: Content[];
};

/** Walk the route: one big location at a time, the same order the office sees lit up in 3D. A step is one physical pallet. */
export function PickStep({ outboundId, lane, done, total, shortText, metres, steps }: { outboundId: string; lane: number; done: number; total: number; shortText: string | null; metres: number; steps: Step[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState<{ code: string; finished: boolean; base: number } | null>(null);
  const current = steps[0];

  const leaves = current?.kind === "boxes" && current.take !== null ? current.rowUnits - current.take : 0;
  const what = current?.contents[0];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="h-2.5 flex-1 border-[1.5px] border-dock-ink bg-white" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total} aria-label="Pick progress">
          <div className="h-full bg-dock-ink" style={{ width: `${(done / Math.max(1, total)) * 100}%` }} />
        </div>
        <span className="mono text-sm font-semibold">{label ? `${Math.max(done, label.base + 1)}/${total}` : !current ? `${done}/${total}` : `Step ${done + 1} of ${total}`}</span>
      </div>
      {shortText && <p className="bg-dock-red/10 px-3 py-2 text-sm text-dock-red">Missing in stock: {shortText}. The office knows.</p>}

      {label ? (
        <>
          <div className="dock-card overflow-hidden bg-white">
            <div className="bg-dock-yellow px-4 py-5 text-center">
              <p className="cond flex items-center justify-center gap-1.5 text-xs font-semibold">
                <Printer size={13} aria-hidden /> Label the new pallet
              </p>
              <p className="mono text-3xl font-bold tracking-wide">{label.code}</p>
              <p className="mt-1 text-sm">It goes to EXP {lane} with the order.</p>
            </div>
          </div>
          <button
            onClick={() => {
              setLabel(null);
              router.refresh();
            }}
            className="cond flex min-h-16 w-full items-center justify-center gap-3 bg-dock-ink px-4 py-4 text-xl font-bold text-dock-yellow"
          >
            {label.finished ? "Finish" : "Labelled, next step"}
          </button>
        </>
      ) : (
        current && (
          <>
            <div className="dock-card overflow-hidden bg-white">
              <div className="bg-dock-ink px-4 py-5 text-center">
                <p className="cond text-[11px] text-white/50">Go to</p>
                <p className="cond text-6xl font-bold tracking-wide text-dock-yellow">{current.location}</p>
                {current.level && <p className="cond text-sm text-white/60">level {current.level}</p>}
              </div>
              {current.kind === "pallet" ? (
                <div className="border-t-[1.5px] border-dock-ink px-4 py-3 text-center">
                  <p className="text-sm font-medium">{current.code ? <>Take pallet <span className="mono font-bold">{current.code}</span></> : "Take the whole pallet"} {current.mixed && <span className="cond bg-dock-ink px-1.5 py-0.5 text-[10px] text-dock-yellow">MIXED</span>}</p>
                  <ul className="mono mt-1 space-y-0.5 text-sm">
                    {current.contents.map((c, i) => (
                      <li key={i} className="font-semibold">
                        {c.sku} {c.lot && <span className="font-normal text-dock-ink/50">· lot {c.lot}</span>} <span className="font-normal text-dock-ink/60">· {c.units} {c.word}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="border-t-[1.5px] border-dock-ink bg-dock-yellow px-4 py-3 text-center">
                  <p className="cond text-xs font-semibold">Take only</p>
                  <p className="cond text-5xl font-bold leading-none">
                    {what?.units} <span className="text-3xl">{what?.word}</span>
                  </p>
                  <p className="mono mt-1 text-base font-bold">
                    of {what?.sku} {what?.lot && <span className="font-normal">· lot {what.lot}</span>}
                  </p>
                  <p className="mt-1 text-sm font-medium">
                    {current.code ? <>from {current.mixed ? "mixed " : ""}pallet <span className="mono font-bold">{current.code}</span></> : "from this pallet"}
                    {" · "}
                    {leaves > 0 ? `leaves ${leaves} here` : "the rest of the pallet stays"}
                  </p>
                  <p className="mt-1 text-sm font-semibold">They go onto a new pallet: you label it next.</p>
                </div>
              )}
              <p className="mono px-4 py-2 text-center text-xs text-dock-ink/55">then to EXP {lane}</p>
            </div>
            <button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  try {
                    const result = await pick(outboundId, current.stockId, current.take ?? undefined);
                    if (result.error) return setError(result.error);
                    if (result.newCode) setLabel({ code: result.newCode, finished: !!result.done, base: done });
                    else router.refresh();
                  } catch {
                    setError("Could not do it. Reload and try again.");
                  }
                })
              }
              className="cond flex min-h-16 w-full items-center justify-center gap-3 bg-dock-yellow px-4 py-4 text-xl font-bold ring-[1.5px] ring-dock-ink active:brightness-90 disabled:opacity-60"
            >
              <Check size={24} aria-hidden /> {pending ? "…" : current.kind === "boxes" ? `Picked ${current.take} ${what?.word}` : current.code ? `Picked ${current.code}` : "Picked the pallet"}
            </button>
            {error && <p role="alert" className="text-sm text-dock-red">{error}</p>}
          </>
        )
      )}

      {!label && steps.length > 1 && (
        <div className="dock-console px-4 py-3 text-[12.5px]">
          <p className="cond mb-1.5 flex items-center gap-1.5 text-[11px] text-white/50">
            <Route size={12} /> Route · ≈{metres} m
          </p>
          <ol className="mono space-y-0.5">
            {steps.map((s, i) => (
              <li key={s.key} className={i === 0 ? "text-dock-yellow" : "text-white/70"}>
                {String(done + i + 1).padStart(2, " ")} {s.location}{" "}
                <span className="text-white/40">
                  {s.kind === "boxes" ? `${s.take} ${s.contents[0].sku}` : s.code ?? s.contents[0].sku}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
