"use client";

import { useState, useTransition } from "react";
import { FlaskConical } from "lucide-react";
import { analyzeNow } from "@/app/office/analyst/actions";
import { useT } from "@/lib/i18n/client";

const WINDOWS = [30, 90, 182] as const;

/** Run the analyst now on a chosen stretch of history. */
export function AnalyzeForm({ initial }: { initial: number }) {
  const { t } = useT();
  const [days, setDays] = useState(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-stretch gap-2">
        <div className="dock-card flex bg-white p-0.5">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setDays(w)}
              aria-pressed={days === w}
              className={`cond px-3 py-1.5 text-xs ${days === w ? "bg-dock-ink text-dock-yellow" : "text-dock-ink/60 hover:text-dock-ink"}`}
            >
              {t(`an.win.${w}` as "an.win.30")}
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
          <FlaskConical size={15} /> {pending ? t("an.studying", { n: days }) : t("an.analyze")}
        </button>
      </div>
      {error && <p className="text-xs text-dock-red">{error}</p>}
    </div>
  );
}
