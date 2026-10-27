"use client";

import { useState, useTransition } from "react";
import { FlaskConical } from "lucide-react";
import { analyzeNow } from "@/app/office/analyst/actions";

const WINDOWS = [
  { days: 30, label: "30 days" },
  { days: 90, label: "3 months" },
  { days: 182, label: "6 months" },
];

/** Run the analyst now on a chosen stretch of history. */
export function AnalyzeForm({ initial }: { initial: number }) {
  const [days, setDays] = useState(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-stretch gap-2">
        <div className="dock-card flex bg-white p-0.5">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              type="button"
              onClick={() => setDays(w.days)}
              aria-pressed={days === w.days}
              className={`cond px-3 py-1.5 text-xs ${days === w.days ? "bg-dock-ink text-dock-yellow" : "text-dock-ink/60 hover:text-dock-ink"}`}
            >
              {w.label}
            </button>
          ))}
        </div>
        <button
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              try {
                await analyzeNow(days);
              } catch (err) {
                // redirect() is thrown on purpose; anything else is a real error.
                if (err instanceof Error && !err.message.includes("NEXT_REDIRECT")) setError(err.message);
              }
            })
          }
          className="cond flex items-center gap-2 bg-dock-yellow px-4 text-sm font-semibold text-dock-ink ring-[1.5px] ring-dock-ink disabled:opacity-60"
        >
          <FlaskConical size={15} /> {pending ? `Studying ${days} days…` : "Analyze now"}
        </button>
      </div>
      {error && <p className="text-xs text-dock-red">{error}</p>}
    </div>
  );
}
