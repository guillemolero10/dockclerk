import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, Bot, ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { BookingForm } from "@/components/dock/booking-form";
import { DockTimeline } from "@/components/dock/dock-timeline";
import { getDockDay, type DockSlot } from "@/lib/dock/day";
import { madridHm, madridYmd } from "@/lib/format";
import { clerkSchedule, updateSlot } from "./actions";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

const shiftDay = (ymd: string, days: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

export default async function DockPage({ searchParams }: PageProps<"/office/dock">) {
  await requireRole("office");
  const params = await searchParams;
  const str = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : undefined);
  const today = madridYmd();
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(str("day") ?? "") ? str("day")! : today;
  const data = await getDockDay(str("w"), ymd);
  if (!data) return <main className="p-8 text-dock-ink/60">Set up a warehouse first.</main>;

  const code = data.current.code;
  const href = (extra: Record<string, string | null> = {}) => {
    const q = new URLSearchParams({ w: code, day: ymd });
    for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
    return `/office/dock?${q}`;
  };
  const selected = data.slots.find((s) => s.id === str("a")) ?? null;
  const clerkBooked = str("clerk");
  const isToday = ymd === today;
  const dayLabel = data.day.start.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Madrid" });
  const active = data.slots.filter((s) => s.status !== "NO_SHOW");

  return (
    <main className="px-8 py-8">
      <AutoRefresh />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="cond text-sm text-dock-ink/50">Trucks in and out · no overlaps</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Dock</h1>
        </div>
        <div className="flex items-center gap-1">
          <Link href={`/office/dock?w=${code}&day=${shiftDay(ymd, -1)}`} className="dock-card grid h-9 w-9 place-items-center bg-white" aria-label="Previous day">
            <ChevronLeft size={16} />
          </Link>
          <div className="dock-card min-w-[220px] bg-white px-4 py-1.5 text-center">
            <p className="cond text-[10px] text-dock-ink/50">{isToday ? "Today" : ymd === shiftDay(today, 1) ? "Tomorrow" : " "}</p>
            <p className="text-sm font-semibold leading-tight">{dayLabel}</p>
          </div>
          <Link href={`/office/dock?w=${code}&day=${shiftDay(ymd, 1)}`} className="dock-card grid h-9 w-9 place-items-center bg-white" aria-label="Next day">
            <ChevronRight size={16} />
          </Link>
          {!isToday && (
            <Link href={`/office/dock?w=${code}`} className="cond ml-2 text-xs text-dock-ink/50 hover:text-dock-ink">
              Back to today
            </Link>
          )}
        </div>
      </header>

      <nav className="mt-6 flex gap-1.5">
        {data.warehouses.map((w) => (
          <Link
            key={w.code}
            href={`/office/dock?w=${w.code}&day=${ymd}`}
            className={`cond flex items-center gap-3 border-[1.5px] border-dock-ink px-3 py-1.5 text-xs ${w.code === code ? "bg-dock-ink text-dock-yellow" : "bg-white hover:bg-dock-concrete-2"}`}
          >
            {w.code} · {w.name.split("·")[1]?.trim() ?? w.name}
            <span className={`mono text-[11px] ${w.code === code ? "text-white/60" : "text-dock-ink/50"}`}>{w.trucks} truck{w.trucks === 1 ? "" : "s"}</span>
          </Link>
        ))}
      </nav>

      {clerkBooked !== undefined && (
        <p className="mt-4 flex items-center gap-2 border-[1.5px] border-dock-ink bg-dock-ink px-4 py-2 text-sm text-white">
          <Bot size={16} className="text-dock-yellow" />
          {Number(clerkBooked) > 0 ? `The clerk booked ${clerkBooked} truck${clerkBooked === "1" ? "" : "s"}, each as close as possible to when it is needed and never on top of another.` : "The clerk found no free door for the trucks left."}
        </p>
      )}

      <section className="mt-4">
        <DockTimeline
          docks={data.docks}
          slots={data.slots}
          dayStart={data.day.start}
          now={isToday ? new Date() : null}
          selected={selected?.id ?? null}
          hrefFor={(id) => href({ a: id })}
        />
        <p className="mono mt-2 text-[11px] text-dock-ink/45">
          {active.length} truck{active.length === 1 ? "" : "s"} · {active.filter((s) => s.kind === "in").length} unloading, {active.filter((s) => s.kind === "out").length} loading ·
          white = receiving, yellow = dispatch, striped = at the dock
        </p>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="cond flex items-center gap-2 text-sm">
              Waiting for a slot <span className="mono bg-dock-ink px-1.5 text-[11px] text-dock-yellow">{data.waiting.length}</span>
            </h2>
            {data.waiting.length > 0 && (
              <form action={clerkSchedule}>
                <input type="hidden" name="warehouse" value={code} />
                <input type="hidden" name="day" value={ymd} />
                <button className="cond flex items-center gap-2 bg-dock-yellow px-3 py-1.5 text-sm font-semibold text-dock-ink ring-[1.5px] ring-dock-ink hover:brightness-95">
                  <Bot size={15} /> Let the clerk schedule them
                </button>
              </form>
            )}
          </div>
          {data.waiting.length === 0 ? (
            <p className="mt-3 text-sm text-dock-ink/50">Every truck of this day has a door.</p>
          ) : (
            <ul className="dock-card mt-3 divide-y divide-dock-line bg-white">
              {data.waiting.map((o) => (
                <li key={o.key} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  {o.kind === "in" ? <ArrowDownToLine size={16} className="text-dock-ink/50" /> : <ArrowUpFromLine size={16} className="text-dock-ink/50" />}
                  <span className="mono w-14 text-xs font-semibold">Nº {o.number}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{o.client}</span>
                    <span className="block truncate text-xs text-dock-ink/55">
                      {o.kind === "in" ? `from ${o.counterpart}` : `to ${o.counterpart}`}{o.pallets !== null ? ` · ${o.pallets} plt` : ""}
                    </span>
                  </span>
                  <span className="mono text-xs text-dock-ink/60">{o.kind === "in" ? "expected" : "pick up"} ~{madridHm(o.preferred)}</span>
                  <Link href={href({ book: o.key })} scroll={false} className="cond border-[1.5px] border-dock-ink px-2 py-0.5 text-xs hover:bg-dock-yellow">
                    Book
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside>
          {selected ? (
            <SlotDetail slot={selected} closeHref={href()} />
          ) : (
            <BookingForm
              key={str("book") ?? "default"}
              warehouse={code}
              day={ymd}
              docks={data.docks}
              initialKey={str("book") ?? null}
              options={data.waiting.map((o) => ({
                key: o.key,
                kind: o.kind,
                label: `${o.kind === "in" ? "IN" : "OUT"} · Nº ${o.number} · ${o.client}`,
                preferred: madridHm(new Date(Math.max(o.preferred.getTime(), data.day.start.getTime() + 6 * 3600000))),
                minutes: o.minutes,
              }))}
            />
          )}
        </aside>
      </div>
    </main>
  );
}

function SlotDetail({ slot, closeHref }: { slot: DockSlot; closeHref: string }) {
  const canFinish = slot.kind === "in" ? ["RECEIVED", "CLOSED"].includes(slot.orderStatus) : ["PREPARED", "SHIPPED"].includes(slot.orderStatus);
  const button = (action: string, label: string, tone = "border-[1.5px] border-dock-ink hover:bg-dock-concrete-2") => (
    <form action={updateSlot}>
      <input type="hidden" name="id" value={slot.id} />
      <input type="hidden" name="action" value={action} />
      <button className={`cond w-full px-3 py-2 text-sm ${tone}`}>{label}</button>
    </form>
  );

  return (
    <section className="dock-card overflow-hidden bg-white">
      <header className={`flex items-center justify-between px-5 py-3 ${slot.kind === "out" ? "bg-dock-yellow" : "bg-dock-ink text-white"}`}>
        <div>
          <p className="cond text-[11px] opacity-60">{slot.kind === "in" ? "Unloading" : "Loading"} · Dock {slot.dock}</p>
          <p className="mono text-xl font-semibold">
            {madridHm(slot.start)}–{madridHm(slot.end)}
          </p>
        </div>
        <Link href={closeHref} scroll={false} aria-label="Close">
          <X size={18} />
        </Link>
      </header>
      <div className="space-y-3 px-5 py-4 text-sm">
        <div>
          <p className="font-semibold">
            {slot.kind === "in" ? "Inbound" : "Outbound"} Nº {slot.number} · {slot.client}
          </p>
          <p className="text-dock-ink/60">{slot.kind === "in" ? `From ${slot.counterpart}` : `To ${slot.counterpart}`}</p>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="cond text-dock-ink/50">Pallets</dt>
          <dd className="mono">{slot.pallets ?? "from the driver's delivery note"}</dd>
          <dt className="cond text-dock-ink/50">Carrier</dt>
          <dd>{slot.carrier ?? "—"}</dd>
          <dt className="cond text-dock-ink/50">Plate</dt>
          <dd className="mono">{slot.plate ?? "—"}</dd>
          <dt className="cond text-dock-ink/50">Status</dt>
          <dd>
            {slot.status === "ARRIVED" ? `At the dock since ${madridHm(slot.arrivedAt!)}` : slot.status === "NO_SHOW" ? "Did not show up" : slot.status === "DONE" ? "Done" : "Booked"}
            {slot.bookedBy === "clerk" && <span className="text-dock-ink/50"> · booked by the clerk</span>}
          </dd>
        </dl>

        {slot.driverToken && slot.status !== "DONE" && (
          <Link href={`/driver/${slot.driverToken}`} target="_blank" className="flex items-center justify-between border-[1.5px] border-dashed border-dock-ink px-3 py-2 text-xs hover:bg-dock-concrete-2">
            <span>
              <span className="cond block text-[11px] text-dock-ink/50">Driver link, no app needed</span>
              <span className="mono">/driver/{slot.driverToken.slice(0, 10)}…</span>
            </span>
            <ExternalLink size={14} />
          </Link>
        )}

        <div className="grid gap-2 pt-1">
          {slot.status === "BOOKED" && (
            <>
              {button("arrived", "Truck arrived", "bg-dock-ink font-semibold text-dock-yellow")}
              <div className="grid grid-cols-2 gap-2">
                {button("noshow", "No show")}
                {button("cancel", "Cancel booking")}
              </div>
            </>
          )}
          {slot.status === "ARRIVED" &&
            (canFinish ? (
              button("done", slot.kind === "in" ? "Unloaded, truck gone" : "Loaded, truck gone", "bg-dock-ink font-semibold text-dock-yellow")
            ) : (
              <p className="bg-dock-concrete-2 px-3 py-2 text-xs text-dock-ink/70">
                {slot.kind === "in" ? "Waiting for the operator to receive it on the handheld." : "Waiting for the operator to pick it."}
              </p>
            ))}
          {slot.status === "NO_SHOW" && button("cancel", "Free the slot")}
        </div>
      </div>
    </section>
  );
}
