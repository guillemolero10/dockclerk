import Link from "next/link";
import { ArrowDownToLine, ArrowRight, ArrowUpFromLine, Check, ChevronRight, MoveRight, PackageCheck } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { FloorVoice } from "@/components/operator/floor-voice";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { madridDayRange, madridHm } from "@/lib/format";
import { openPickPlans } from "@/lib/ops/floor";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // the floor voice note waits for Meta to transcribe it (about 2 s, 25 s at most)

export default async function OperatorHome({ searchParams }: PageProps<"/operator">) {
  await requireRole("operator");
  const { t } = await getT();
  const { w } = await searchParams;
  const warehouses = await db.warehouse.findMany({ orderBy: { code: "asc" } });
  const here = warehouses.find((x) => x.code === w) ?? warehouses[0];
  if (!here) return <p className="p-6">{t("op.noWarehouse")}</p>;
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
    // `pallets` is 1 on the head row of each physical pallet and 0 on the other rows of a mixed one: the sum counts pallets.
    db.stock.groupBy({ by: ["location"], where: { warehouseId: here.id, location: { startsWith: "REC-" } }, _sum: { pallets: true }, orderBy: { location: "asc" } }),
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
  const waitingTotal = waiting.reduce((sum, g) => sum + (g._sum.pallets ?? 0), 0);

  // The one thing to do next: a truck at the dock, else pallets waiting, else the nearest order (one already started first), else the next truck.
  const atDock = unloads.find((i) => i.appointment?.status === "ARRIVED" || i.status === "RECEIVING");
  const pickFirst = [...toPick].sort((x, y) => Number((plans.plans.get(y.id)?.picked.length ?? 0) > 0) - Number((plans.plans.get(x.id)?.picked.length ?? 0) > 0))[0];
  const comingNext = unloads.find((i) => i !== atDock);
  type Now = { phase: 1 | 2 | 3; href: string; title: string; where: string; cta: string };
  let now: Now | null = null;
  if (atDock) {
    now = {
      phase: 1,
      href: `/operator/receive/${atDock.id}`,
      title: t("op.now.unload", { client: atDock.client.name }),
      where: atDock.appointment?.dock ? t("op.now.unloadWhere", { n: atDock.appointment.dock }) : t("op.now.unloadNoDock"),
      cta: t("op.btn.unload"),
    };
  } else if (waitingTotal > 0) {
    now = { phase: 2, href: `/operator/putaway?w=${here.code}`, title: t("op.now.putAway_p", { n: waitingTotal }), where: t("op.now.putAwayWhere"), cta: t("op.btn.putAway") };
  } else if (pickFirst) {
    const started = (plans.plans.get(pickFirst.id)?.picked.length ?? 0) > 0;
    now = {
      phase: 3,
      href: `/operator/pick/${pickFirst.id}`,
      title: t("op.now.pick", { n: pickFirst.number }),
      where: t("op.now.pickWhere", { client: pickFirst.client.name, to: pickFirst.consignee?.name ?? "—" }),
      cta: started ? t("op.btn.pickOn") : t("op.btn.pick"),
    };
  } else if (comingNext) {
    now = {
      phase: 1,
      href: `/operator/receive/${comingNext.id}`,
      title: t("op.now.coming", { client: comingNext.client.name }),
      where: t("op.now.comingWhere", { time: comingNext.appointment ? madridHm(comingNext.appointment.startsAt) : t("op.now") }),
      cta: t("op.btn.coming"),
    };
  }

  return (
    <main className="space-y-5 px-4 py-4">
      <AutoRefresh seconds={15} />
      <nav className="flex gap-1.5" aria-label={t("op.floor")}>
        {warehouses.map((x) => (
          <Link
            key={x.code}
            href={`/operator?w=${x.code}`}
            className={`cond flex min-h-12 flex-1 items-center justify-center border-[1.5px] border-dock-ink px-3 text-base font-semibold ${x.id === here.id ? "bg-dock-ink text-dock-yellow" : "bg-white"}`}
          >
            {x.code}
          </Link>
        ))}
      </nav>

      <section aria-label={t("st.now")}>
        {now ? (
          <Link href={now.href} className="dock-card block overflow-hidden bg-dock-ink text-white active:translate-x-0.5 active:translate-y-0.5">
            <span className="block px-4 pb-3 pt-4">
              <span className="cond block text-xs text-dock-yellow">{t("st.now")} · {now.phase} {[t("op.unload"), t("op.putAway"), t("op.pick")][now.phase - 1]}</span>
              <span className="mt-1 block break-words text-2xl font-bold leading-tight">{now.title}</span>
              <span className="mt-1 block break-words text-sm text-white/65">{now.where}</span>
            </span>
            <span className="cond flex min-h-16 items-center justify-center gap-3 bg-dock-yellow px-4 py-4 text-xl font-bold text-dock-ink">
              {now.cta} <ArrowRight size={22} aria-hidden />
            </span>
          </Link>
        ) : (
          <div className="dock-card flex items-center gap-3 bg-white px-4 py-4">
            <Check size={26} aria-hidden />
            <div>
              <p className="text-lg font-semibold">{t("op.now.none")}</p>
              <p className="text-sm text-dock-ink/55">{t("op.now.noneHint")}</p>
            </div>
          </div>
        )}
      </section>

      <p className="cond text-center text-xs text-dock-ink/50">{t("op.flow")}</p>

      <div className="space-y-3">
        <Phase n={1} active={now?.phase === 1} title={t("op.unload")} nothing={t("op.nothing")} count={unloads.length} icon={<ArrowDownToLine size={16} />}>
          {unloads.map((i) => (
            <Task
              key={i.id}
              href={`/operator/receive/${i.id}`}
              time={i.appointment ? madridHm(i.appointment.startsAt) : t("op.now")}
              dock={i.appointment?.dock}
              dockWord={t("op.dockN", { n: i.appointment?.dock ?? "" })}
              title={i.client.name}
              detail={i.receipt?.notePallets ? t("op.notePallets_p", { n: i.receipt.notePallets }) : t("op.noNote")}
              chip={i.appointment?.status === "ARRIVED" || i.status === "RECEIVING" ? t("op.atDock") : t("op.coming")}
              hot={i.appointment?.status === "ARRIVED" || i.status === "RECEIVING"}
            />
          ))}
        </Phase>

        <Phase n={2} active={now?.phase === 2} title={t("op.putAway")} nothing={t("op.nothing")} count={waitingTotal} icon={<MoveRight size={16} />}>
          {waiting.map((g) => (
            <Task key={g.location} href={`/operator/putaway?w=${here.code}`} title={t("op.inLane_p", { n: g._sum.pallets ?? 0, lane: g.location.replace("-", " ") })} detail={t("op.suggests")} chip={t("op.waiting")} />
          ))}
        </Phase>

        <Phase n={3} active={now?.phase === 3} title={t("op.pick")} nothing={t("op.nothing")} count={toPick.length} icon={<ArrowUpFromLine size={16} />}>
          {toPick.map((o) => {
            const plan = plans.plans.get(o.id)!;
            return (
              <Task
                key={o.id}
                href={`/operator/pick/${o.id}`}
                time={o.appointment ? madridHm(o.appointment.startsAt) : undefined}
                dock={o.appointment?.dock}
                dockWord={t("op.dockN", { n: o.appointment?.dock ?? "" })}
                title={`Nº ${o.number} · ${o.client.name}`}
                detail={`→ ${o.consignee?.name ?? "—"}`}
                chip={plan.picked.length ? t("op.pickedOf", { a: plan.picked.length, b: plan.stockIds.length }) : t("op.pallets_p", { n: plan.stockIds.length })}
                hot={plan.picked.length > 0}
              />
            );
          })}
        </Phase>

        <Phase n={4} active={false} title={t("op.readyToLoad")} nothing={t("op.nothing")} count={prepared.length} icon={<PackageCheck size={16} />}>
          {prepared.map((o) => (
            <Task
              key={o.id}
              time={o.appointment ? madridHm(o.appointment.startsAt) : undefined}
              dock={o.appointment?.dock}
              dockWord={t("op.dockN", { n: o.appointment?.dock ?? "" })}
              title={`Nº ${o.number} · ${o.client.name}`}
              detail={t("op.inDispatch_p", { n: o._count.picked })}
              chip={t("op.prepared")}
            />
          ))}
        </Phase>
      </div>

      <FloorVoice warehouse={here.code} />
    </main>
  );
}

/** One phase of the route the goods follow, 1 to 4. A phase with nothing to do shrinks to one grey line with a tick. */
function Phase({ n, active, title, nothing, count, icon, children }: { n: number; active: boolean; title: string; nothing: string; count: number; icon: React.ReactNode; children: React.ReactNode }) {
  const badge = (
    <span className={`cond grid h-7 w-7 shrink-0 place-items-center text-sm font-bold ${count === 0 ? "bg-dock-concrete-2 text-dock-ink/40" : active ? "bg-dock-yellow ring-2 ring-dock-ink" : "bg-dock-ink text-dock-yellow"}`}>{count === 0 ? <Check size={15} aria-hidden /> : n}</span>
  );
  if (count === 0)
    return (
      <section className="flex items-center gap-2.5 px-1 text-dock-ink/45" aria-label={title}>
        {badge}
        <h2 className="cond flex items-center gap-1.5 text-sm">
          {n} · {title}
        </h2>
        <span className="text-xs">· {nothing}</span>
      </section>
    );
  return (
    <section aria-label={title}>
      <h2 className="cond mb-2 flex items-center gap-2.5 text-base">
        {badge}
        {icon} {title} <span className="mono bg-dock-ink px-1.5 text-xs text-dock-yellow">{count}</span>
      </h2>
      <div className="space-y-2 border-l-[3px] border-dock-ink pl-3 ml-3.5">{children}</div>
    </section>
  );
}

function Task({ href, time, dock, dockWord, title, detail, chip, hot }: { href?: string; time?: string; dock?: number; dockWord?: string; title: string; detail: string; chip: string; hot?: boolean }) {
  const body = (
    <>
      {(time || dock) && (
        <span className="flex w-14 shrink-0 flex-col items-center justify-center border-r-[1.5px] border-dock-ink bg-dock-ink py-2 text-dock-yellow">
          <span className="mono text-sm font-semibold">{time ?? ""}</span>
          {dock && <span className="cond text-[10px] text-white/60">{dockWord}</span>}
        </span>
      )}
      <span className="min-w-0 flex-1 px-3 py-3">
        <span className="block truncate text-base font-semibold">{title}</span>
        <span className="block truncate text-xs text-dock-ink/55">{detail}</span>
      </span>
      <span className={`cond mr-2 shrink-0 self-center px-1.5 py-0.5 text-[11px] ${hot ? "bg-dock-yellow" : "bg-dock-concrete-2 text-dock-ink/60"}`}>{chip}</span>
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
