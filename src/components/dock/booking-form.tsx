"use client";

import { startTransition, useActionState, useState } from "react";
import { AlertTriangle, CalendarPlus, Check } from "lucide-react";
import { bookSlot, type BookState } from "@/app/office/dock/actions";

export type BookingOption = { key: string; kind: "in" | "out"; label: string; preferred: string; minutes: number };

/** Book a door for a truck. If the door is taken, the server says by whom and offers the next free slot. */
export function BookingForm({
  warehouse,
  day,
  options,
  docks,
  initialKey,
}: {
  warehouse: string;
  day: string;
  options: BookingOption[];
  docks: { n: number; kind: "in" | "out" }[];
  initialKey: string | null;
}) {
  const [state, action, pending] = useActionState<BookState, FormData>(bookSlot, null);
  const [key, setKey] = useState(initialKey ?? options[0]?.key ?? "");
  const option = options.find((o) => o.key === key) ?? options[0];
  const [time, setTime] = useState(option?.preferred ?? "08:00");
  const [dock, setDock] = useState("auto");

  if (!option) {
    return (
      <div className="dock-card bg-white p-5 text-sm text-dock-ink/60">
        {state?.ok && <OkLine text={state.ok} />}
        Every truck of this day has a slot.
      </div>
    );
  }

  const pick = (next: string) => {
    setKey(next);
    const o = options.find((x) => x.key === next);
    if (o) setTime(o.preferred);
    setDock("auto");
  };

  return (
    // Submitted by hand: a form `action` would be reset by React afterwards, wiping the chosen door.
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="dock-card space-y-3 bg-white p-5"
    >
      <h2 className="cond flex items-center gap-2 text-sm">
        <CalendarPlus size={15} /> Book a slot
      </h2>
      <input type="hidden" name="warehouse" value={warehouse} />
      <input type="hidden" name="day" value={day} />

      <label className="block">
        <span className="cond text-[11px] text-dock-ink/50">Truck</span>
        <select name="order" value={option.key} onChange={(e) => pick(e.target.value)} className="dock-input mt-1">
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="cond text-[11px] text-dock-ink/50">From</span>
          <input name="time" type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} className="dock-input mono mt-1" />
        </label>
        <label className="block">
          <span className="cond text-[11px] text-dock-ink/50">Door</span>
          <select name="dock" value={dock} onChange={(e) => setDock(e.target.value)} className="dock-input mt-1">
            <option value="auto">First free</option>
            {docks
              .filter((d) => d.kind === option.kind)
              .map((d) => (
                <option key={d.n} value={d.n}>
                  Dock {d.n}
                </option>
              ))}
          </select>
        </label>
      </div>
      <p className="mono text-[11px] text-dock-ink/50">
        {option.kind === "in" ? "Unloading" : "Loading"} takes about {option.minutes} min
      </p>

      {state?.error && (
        <div className="space-y-2 border-[1.5px] border-dock-ink bg-dock-yellow px-3 py-2 text-sm">
          <p className="flex items-start gap-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {state.error}
          </p>
          {state.suggestion && (
            <button
              type="button"
              onClick={() => {
                setDock(String(state.suggestion!.dock));
                setTime(state.suggestion!.time);
              }}
              className="cond bg-dock-ink px-2 py-1 text-xs text-dock-yellow"
            >
              Use dock {state.suggestion.dock} at {state.suggestion.time}
            </button>
          )}
        </div>
      )}
      {state?.ok && <OkLine text={state.ok} />}

      <button disabled={pending} className="cond w-full bg-dock-ink px-4 py-2 text-sm font-semibold text-dock-yellow disabled:opacity-60">
        {pending ? "Booking…" : "Book slot"}
      </button>
    </form>
  );
}

function OkLine({ text }: { text: string }) {
  return (
    <p className="mb-2 flex items-center gap-2 text-sm text-green-700">
      <Check size={15} /> {text}
    </p>
  );
}
