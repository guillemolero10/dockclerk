import Link from "next/link";
import { Bot, Check } from "lucide-react";
import type { DockSlot } from "@/lib/dock/day";
import { DOCK_CLOSE_H, DOCK_OPEN_H } from "@/lib/dock/slots";
import { madridHm } from "@/lib/format";
import { TimelineScroller } from "./timeline-scroller";

const HOUR = 60 * 60 * 1000;
const LATE_AFTER = 15 * 60 * 1000;
const HOURS = Array.from({ length: DOCK_CLOSE_H - DOCK_OPEN_H }, (_, i) => DOCK_OPEN_H + i);
const LABEL_W = 132;
const HOUR_PX = 120;

/** Gantt of the day: one lane per dock door, one block per truck. */
export function DockTimeline({
  docks,
  slots,
  dayStart,
  now,
  selected,
  hrefFor,
}: {
  docks: { n: number; kind: "in" | "out" }[];
  slots: DockSlot[];
  dayStart: Date;
  now: Date | null;
  selected: string | null;
  hrefFor: (id: string | null) => string;
}) {
  const x = (t: number) => ((t - dayStart.getTime()) / HOUR - DOCK_OPEN_H) * HOUR_PX;
  const width = HOURS.length * HOUR_PX;
  const nowX = now ? x(now.getTime()) : null;
  const showNow = nowX !== null && nowX >= 0 && nowX <= width;
  const firstSlot = slots.length ? Math.min(...slots.map((s) => x(s.start.getTime()))) : 0;
  const focus = LABEL_W + (showNow ? nowX! : firstSlot);

  return (
    <div className="dock-card overflow-hidden bg-white">
      <TimelineScroller focusX={focus}>
        <div className="relative" style={{ width: LABEL_W + width }}>
          {/* Hour ruler */}
          <div className="flex border-b-[1.5px] border-dock-ink bg-dock-concrete-2">
            <div className="cond sticky left-0 z-20 shrink-0 bg-dock-concrete-2 px-4 py-2 text-[11px] text-dock-ink/50" style={{ width: LABEL_W }}>
              Door
            </div>
            <div className="relative h-8" style={{ width }}>
              {HOURS.map((h) => (
                <span key={h} className="mono absolute top-2 pl-1.5 text-[11px] text-dock-ink/50" style={{ left: (h - DOCK_OPEN_H) * HOUR_PX }}>
                  {String(h).padStart(2, "0")}:00
                </span>
              ))}
            </div>
          </div>

          {docks.map((dock) => (
            <div key={dock.n} className="flex border-b border-dock-line last:border-0">
              <div className="sticky left-0 z-20 flex shrink-0 flex-col justify-center gap-0.5 border-r border-dock-line bg-white px-4" style={{ width: LABEL_W }}>
                <span className="cond w-fit bg-dock-ink px-2 py-0.5 text-sm font-bold text-dock-yellow">DOCK {dock.n}</span>
                <span className="cond text-[10px] text-dock-ink/45">{dock.kind === "in" ? "Receiving" : "Dispatch"}</span>
              </div>
              <div className="relative h-[78px]" style={{ width }}>
                {HOURS.map((h) => (
                  <span key={h} className="absolute inset-y-0 w-px bg-dock-line/70" style={{ left: (h - DOCK_OPEN_H) * HOUR_PX }} />
                ))}
                {slots
                  .filter((s) => s.dock === dock.n)
                  .map((s) => {
                    const late = s.status === "BOOKED" && now !== null && now.getTime() > s.start.getTime() + LATE_AFTER;
                    const tone =
                      s.status === "DONE"
                        ? "border-dock-line bg-dock-concrete-2 text-dock-ink/45"
                        : s.status === "NO_SHOW"
                          ? "border-dashed border-dock-red bg-white text-dock-red line-through"
                          : late
                            ? "border-dock-red bg-dock-red text-white"
                            : s.kind === "out"
                              ? "border-dock-ink bg-dock-yellow text-dock-ink"
                              : "border-dock-ink bg-white text-dock-ink";
                    return (
                      <Link
                        key={s.id}
                        href={hrefFor(selected === s.id ? null : s.id)}
                        scroll={false}
                        className={`absolute inset-y-2 z-10 overflow-hidden border-[1.5px] px-2 py-1 text-left text-[11px] leading-tight transition hover:brightness-95 ${tone} ${
                          selected === s.id ? "outline outline-[3px] outline-offset-1 outline-dock-ink" : ""
                        }`}
                        style={{ left: x(s.start.getTime()) + 1, width: x(s.end.getTime()) - x(s.start.getTime()) - 2 }}
                        title={`${madridHm(s.start)}–${madridHm(s.end)} · Nº ${s.number} · ${s.client}`}
                      >
                        {s.status === "ARRIVED" && <span className="hazard absolute inset-x-0 top-0 h-1.5" />}
                        <span className="mono flex items-center gap-1 font-semibold">
                          {s.status === "DONE" && <Check size={11} />}
                          {s.bookedBy === "clerk" && s.status === "BOOKED" && <Bot size={11} />}
                          {madridHm(s.start)}
                          {late && <span className="cond ml-auto text-[9px]">Late</span>}
                        </span>
                        <span className="block truncate">
                          Nº {s.number} · {s.client.replace(/,? S\.[AL]\.$/, "")}
                        </span>
                        <span className="block truncate opacity-70">
                          {s.status === "ARRIVED" ? "At the dock" : s.pallets !== null ? `${s.pallets} plt` : "plt on its way"}
                        </span>
                      </Link>
                    );
                  })}
              </div>
            </div>
          ))}

          {showNow && (
            <div className="pointer-events-none absolute bottom-0 top-0 z-10" style={{ left: LABEL_W + nowX! }}>
              <div className="h-full w-0.5 bg-dock-red" />
              <span className="mono absolute -left-5 top-1.5 bg-dock-red px-1 text-[10px] text-white">{madridHm(now!)}</span>
            </div>
          )}
        </div>
      </TimelineScroller>
    </div>
  );
}
