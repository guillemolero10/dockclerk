import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, ChevronRight, MoveRight, PackageCheck } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { FloorVoice } from "@/components/operator/floor-voice";
import { db } from "@/lib/db";
import { madridDayRange, madridHm } from "@/lib/format";
import { openPickPlans } from "@/lib/ops/floor";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function OperatorHome({ searchParams }: PageProps<"/operator">) {
  await requireRole("operator");
  const { w } = await searchParams;
  const warehouses = await db.warehouse.findMany({ orderBy: { code: "asc" } });
  const here = warehouses.find((x) => x.code === w) ?? warehouses[0];
  if (!here) return <p className="p-6">No warehouse set up yet.</p>;
  const today = madridDayRange();

  const [unloads, waiting, plans, prepared] = await Promise.all([
    db.inbound.findMany({
      where: {
        warehouseId: here.id,
        status: { in: ["EXPECTED", "RECEIVING"] },
        OR: [{ appointment: { startsAt: { gte: today.start, lt: today.end } } }, { status: "RECEIVING" }],
      },
      include: { client: true, appointment: true, receipt: true },
    }),
    db.stock.groupBy({ by: ["location"], where: { warehouseId: here.id, location: { startsWith: "REC-" } }, _count: true, orderBy: { location: "asc" } }),
    openPickPlans(),
    db.outbound.findMany({
      where: { status: "PREPARED", warehouseId: here.id },
      include: { client: true, appointment: true, _count: { select: { picked: true } } },
      orderBy: { deadline: "asc" },
    }),
  ]);
  unloads.sort((a, b) => (a.appointment?.startsAt.getTime() ?? 0) - (b.appointment?.startsAt.getTime() ?? 0));

  const toPick = await db.outbound.findMany({
    where: { id: { in: [...plans.plans].filter(([, p]) => p.warehouseId === here.id).map(([id]) => id) } },
    include: { client: true, consignee: true, appointment: true },
    orderBy: [{ deadline: "asc" }],
  });
  const waitingTotal = waiting.reduce((sum, g) => sum + g._count, 0);

  return (
    <main className="space-y-5 px-4 py-4">
      <AutoRefresh seconds={15} />
      <nav className="flex gap-1.5">
        {warehouses.map((x) => (
          <Link
            key={x.code}
            href={`/operator?w=${x.code}`}
            className={`cond flex-1 border-[1.5px] border-dock-ink px-3 py-2 text-center text-sm ${x.id === here.id ? "bg-dock-ink text-dock-yellow" : "bg-white"}`}
          >
            {x.code}
          </Link>
        ))}
      </nav>

      <Section title="Unload" count={unloads.length} icon={<ArrowDownToLine size={15} />}>
        {unloads.map((i) => (
          <Task
            key={i.id}
            href={`/operator/receive/${i.id}`}
            time={i.appointment ? madridHm(i.appointment.startsAt) : "now"}
            dock={i.appointment?.dock}
            title={i.client.name}
            detail={i.receipt?.notePallets ? `${i.receipt.notePallets} pallets on the note` : "No delivery note yet"}
            chip={i.appointment?.status === "ARRIVED" || i.status === "RECEIVING" ? "At the dock" : "Coming"}
            hot={i.appointment?.status === "ARRIVED" || i.status === "RECEIVING"}
          />
        ))}
      </Section>

      <Section title="Put away" count={waitingTotal} icon={<MoveRight size={15} />}>
        {waiting.map((g) => (
          <Task key={g.location} href={`/operator/putaway?w=${here.code}`} title={`${g._count} pallets in ${g.location.replace("-", " ")}`} detail="The clerk suggests a slot for each one" chip="Waiting" />
        ))}
      </Section>

      <Section title="Pick" count={toPick.length} icon={<ArrowUpFromLine size={15} />}>
        {toPick.map((o) => {
          const plan = plans.plans.get(o.id)!;
          return (
            <Task
              key={o.id}
              href={`/operator/pick/${o.id}`}
              time={o.appointment ? madridHm(o.appointment.startsAt) : undefined}
              dock={o.appointment?.dock}
              title={`Nº ${o.number} · ${o.client.name}`}
              detail={`→ ${o.consignee?.name ?? "—"}`}
              chip={plan.picked.length ? `${plan.picked.length}/${plan.stockIds.length} picked` : `${plan.stockIds.length} pallets`}
              hot={plan.picked.length > 0}
            />
          );
        })}
      </Section>

      {prepared.length > 0 && (
        <Section title="Ready to load" count={prepared.length} icon={<PackageCheck size={15} />}>
          {prepared.map((o) => (
            <Task
              key={o.id}
              time={o.appointment ? madridHm(o.appointment.startsAt) : undefined}
              dock={o.appointment?.dock}
              title={`Nº ${o.number} · ${o.client.name}`}
              detail={`${o._count.picked} pallets waiting in the dispatch lane`}
              chip="Prepared"
            />
          ))}
        </Section>
      )}

      <FloorVoice warehouse={here.code} />
    </main>
  );
}

function Section({ title, count, icon, children }: { title: string; count: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="cond mb-2 flex items-center gap-2 text-sm">
        {icon} {title} <span className="mono bg-dock-ink px-1.5 text-[11px] text-dock-yellow">{count}</span>
      </h2>
      <div className="space-y-2">{count ? children : <p className="text-sm text-dock-ink/45">Nothing right now.</p>}</div>
    </section>
  );
}

function Task({ href, time, dock, title, detail, chip, hot }: { href?: string; time?: string; dock?: number; title: string; detail: string; chip: string; hot?: boolean }) {
  const body = (
    <>
      {(time || dock) && (
        <span className="flex w-14 shrink-0 flex-col items-center justify-center border-r-[1.5px] border-dock-ink bg-dock-ink py-2 text-dock-yellow">
          <span className="mono text-sm font-semibold">{time ?? ""}</span>
          {dock && <span className="cond text-[10px] text-white/60">Dock {dock}</span>}
        </span>
      )}
      <span className="min-w-0 flex-1 px-3 py-2.5">
        <span className="block truncate font-semibold">{title}</span>
        <span className="block truncate text-xs text-dock-ink/55">{detail}</span>
      </span>
      <span className={`cond mr-2 shrink-0 self-center px-1.5 py-0.5 text-[10px] ${hot ? "bg-dock-yellow" : "bg-dock-concrete-2 text-dock-ink/60"}`}>{chip}</span>
      {href && <ChevronRight size={16} className="mr-2 shrink-0 text-dock-ink/40" />}
    </>
  );
  return href ? (
    <Link href={href} className="dock-card flex items-stretch overflow-hidden bg-white active:translate-x-0.5 active:translate-y-0.5">
      {body}
    </Link>
  ) : (
    <div className="flex items-stretch overflow-hidden border-[1.5px] border-dock-line bg-white">{body}</div>
  );
}
