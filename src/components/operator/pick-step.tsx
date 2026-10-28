"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Route } from "lucide-react";
import { pick } from "@/app/operator/actions";

type Step = { id: string; location: string; level: number | null; sku: string; lot: string | null; units: number; take: number | null };

/** Walk the route: one big location at a time, the same order the office sees lit up in 3D. */
export function PickStep({ outboundId, lane, done, total, short, metres, steps }: { outboundId: string; lane: number; done: number; total: number; short: number; metres: number; steps: Step[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const current = steps[0];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="h-2.5 flex-1 border-[1.5px] border-dock-ink bg-white">
          <div className="h-full bg-dock-ink" style={{ width: `${(done / Math.max(1, total)) * 100}%` }} />
        </div>
        <span className="mono text-sm font-semibold">
          {done}/{total}
        </span>
      </div>
      {short > 0 && <p className="bg-dock-red/10 px-3 py-2 text-sm text-dock-red">{short} pallets are missing in stock; the office knows.</p>}

      {current && (
        <>
          <div className="dock-card overflow-hidden bg-white">
            <div className="bg-dock-ink px-4 py-5 text-center">
              <p className="cond text-[11px] text-white/50">Go to</p>
              <p className="cond text-6xl font-bold tracking-wide text-dock-yellow">{current.location}</p>
              {current.level && <p className="cond text-sm text-white/60">level {current.level}</p>}
            </div>
            <div className="px-4 py-3 text-sm">
              <p className="mono font-semibold">
                {current.sku} {current.lot && <span className="text-dock-ink/50">· lot {current.lot}</span>}
              </p>
              <p className="text-xs text-dock-ink/55">{current.take ? `Take ${current.take} boxes of ${current.units} · the rest stays here` : `1 pallet · ${current.units} units`} · then to EXP {lane}</p>
            </div>
          </div>
          <button
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                try {
                  await pick(outboundId, current.id, current.take ?? undefined);
                  router.refresh();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not do it.");
                }
              })
            }
            className="cond flex w-full items-center justify-center gap-2 bg-dock-yellow px-4 py-4 text-base font-semibold ring-[1.5px] ring-dock-ink disabled:opacity-60"
          >
            <Check size={18} /> {pending ? "…" : current.take ? `Picked ${current.take} boxes, taken to EXP ${lane}` : `Picked, taken to EXP ${lane}`}
          </button>
          {error && <p className="text-sm text-dock-red">{error}</p>}
        </>
      )}

      {steps.length > 1 && (
        <div className="dock-console px-4 py-3 text-[12.5px]">
          <p className="cond mb-1.5 flex items-center gap-1.5 text-[11px] text-white/50">
            <Route size={12} /> Route · ≈{metres} m
          </p>
          <ol className="mono space-y-0.5">
            {steps.map((s, i) => (
              <li key={s.id} className={i === 0 ? "text-dock-yellow" : "text-white/70"}>
                {String(done + i + 1).padStart(2, " ")} {s.location} <span className="text-white/40">{s.sku}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
