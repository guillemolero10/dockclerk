"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, Bot } from "lucide-react";
import { putAwayAll, putAwayPallet } from "@/app/operator/actions";

/** One pallet at a time: from the receiving lane to the slot the clerk suggests (or another one). */
export function PutAwayStep({
  warehouse,
  left,
  pallet,
  suggestion,
  why,
}: {
  warehouse: string;
  left: number;
  pallet: { id: string; from: string; sku: string; description: string; lot: string | null; client: string; units: number };
  suggestion: string | null;
  why: string;
}) {
  const router = useRouter();
  const [slot, setSlot] = useState(suggestion ?? "");
  const [editing, setEditing] = useState(!suggestion);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (job: () => Promise<unknown>) =>
    start(async () => {
      setError(null);
      try {
        await job();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not do it.");
      }
    });

  return (
    <div className="space-y-4">
      <p className="mono text-xs text-dock-ink/50">{left} pallets waiting</p>
      <div className="dock-card overflow-hidden bg-white">
        <div className="px-4 py-3">
          <p className="cond text-[11px] text-dock-ink/50">From {pallet.from.replace("-", " ")}</p>
          <p className="mono font-semibold">
            {pallet.sku} {pallet.lot && <span className="text-dock-ink/50">· {pallet.lot}</span>}
          </p>
          <p className="truncate text-xs text-dock-ink/55">
            {pallet.client} · {pallet.units} units
          </p>
        </div>
        <div className="flex justify-center bg-dock-concrete-2 py-1 text-dock-ink/40">
          <ArrowDown size={18} />
        </div>
        <div className="bg-dock-ink px-4 py-5 text-center">
          <p className="cond flex items-center justify-center gap-1 text-[11px] text-white/50">
            {suggestion && !editing ? (
              <>
                <Bot size={12} /> Suggested slot · {why}
              </>
            ) : (
              "Slot"
            )}
          </p>
          {editing ? (
            <input
              value={slot}
              onChange={(e) => setSlot(e.target.value.toUpperCase())}
              placeholder="C-07-3"
              className="mono mx-auto mt-1 block w-40 bg-white px-2 py-1 text-center text-3xl font-bold text-dock-ink"
            />
          ) : (
            <p className="cond mt-1 text-6xl font-bold tracking-wide text-dock-yellow">{slot}</p>
          )}
        </div>
      </div>

      <button disabled={pending || !slot} onClick={() => run(() => putAwayPallet(pallet.id, slot))} className="cond w-full bg-dock-yellow px-4 py-4 text-base font-semibold ring-[1.5px] ring-dock-ink disabled:opacity-50">
        {pending ? "…" : `Placed in ${slot || "…"}`}
      </button>
      {!editing && (
        <button onClick={() => setEditing(true)} className="w-full text-center text-xs text-dock-ink/50 underline">
          Put it somewhere else
        </button>
      )}
      {error && <p className="text-sm text-dock-red">{error}</p>}

      {left > 1 && (
        <button disabled={pending} onClick={() => run(() => putAwayAll(warehouse))} className="cond w-full border-[1.5px] border-dock-ink bg-white px-4 py-3 text-sm">
          Put all {left} where suggested
        </button>
      )}
    </div>
  );
}
