import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import { PickStep } from "@/components/operator/pick-step";
import { db } from "@/lib/db";
import { openPickPlans } from "@/lib/ops/floor";
import { describeShortage } from "@/lib/warehouse/picking";
import { dispatchLane } from "@/lib/warehouse/lanes";
import { makeLayout, parseLocation } from "@/lib/warehouse/layout";
import { pickRoute } from "@/lib/warehouse/route";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";
// The server actions of this page (prepare / pick) run under this limit; a transaction may take up to 20 s.
export const maxDuration = 60;

export default async function PickPage({ params }: PageProps<"/operator/pick/[id]">) {
  await requireRole("operator");
  const { id } = await params;
  const outbound = await db.outbound.findUnique({ where: { id }, include: { client: true, consignee: true, warehouse: true, appointment: true } });
  if (!outbound) return <p className="p-6">Not found.</p>;

  if (outbound.status !== "REQUESTED") {
    const picked = (await db.stock.aggregate({ where: { outboundId: id }, _sum: { pallets: true } }))._sum.pallets ?? 0;
    // Pallets made up in this pick from loose boxes: they need a label.
    const made = await db.stock.findMany({ where: { outboundId: id, splitFrom: { not: null } }, select: { palletCode: true }, distinct: ["palletCode"], orderBy: { palletCode: "asc" } });
    return (
      <main className="space-y-4 px-4 py-6">
        <Back code={outbound.warehouse?.code} />
        <div className="hazard p-1">
          <div className="bg-dock-ink px-5 py-6 text-center text-white">
            <Check className="mx-auto text-dock-yellow" size={28} />
            <p className="mt-2 text-lg font-semibold">Nº {outbound.number} is prepared</p>
            <p className="text-sm text-white/60">{picked} {picked === 1 ? "pallet" : "pallets"} waiting in the dispatch lane for the truck.</p>
          </div>
          {made.length > 0 && (
            <div className="bg-white px-4 py-3 text-sm">
              <p className="cond text-[11px] text-dock-ink/55">New pallets made from loose boxes: check they carry a label</p>
              <p className="mono font-semibold">{made.map((m) => m.palletCode).join(" · ")}</p>
            </div>
          )}
        </div>
      </main>
    );
  }

  const { plans, stock, open } = await openPickPlans();
  const plan = plans.get(id);
  const warehouse = plan?.warehouseId ? await db.warehouse.findUnique({ where: { id: plan.warehouseId } }) : null;
  if (!plan || !warehouse) return <p className="p-6">There is no stock to pick this outbound.</p>;

  const layout = makeLayout(warehouse);
  const lane = dispatchLane(layout, stock.filter((s) => s.warehouseId === warehouse.id), id);
  const byId = new Map(stock.map((s) => [s.id, s]));
  const keyOf = (st: (typeof plan.steps)[number]) => (st.kind === "pallet" ? st.stockIds[0] : st.stockId);
  const route = pickRoute(layout, plan.steps.map((st) => ({ id: keyOf(st), loc: st.location })), lane);
  const stepByKey = new Map(plan.steps.map((st) => [keyOf(st), st]));
  const items = await db.item.findMany({ where: { id: { in: stock.filter((s) => plan.stockIds.includes(s.id) || plan.steps.some((st) => st.kind === "pallet" && st.stockIds.includes(s.id))).map((s) => s.itemId) } } });
  const wordOf = (itemId: string) => ({ BOX: "boxes", BAG: "bags", PALLET: "units" } as const)[items.find((i) => i.id === itemId)?.unit ?? "BOX"];
  const skuOf = (itemId: string) => items.find((i) => i.id === itemId)?.sku ?? "?";
  const describe = (key: string) => {
    const st = stepByKey.get(key)!;
    const loc = parseLocation(st.location);
    const level = loc?.kind === "rack" ? loc.level : null;
    if (st.kind === "pallet") {
      const rows = st.stockIds.map((id) => byId.get(id)!);
      return { key, kind: "pallet" as const, stockId: st.stockIds[0], location: st.location, level, code: st.palletCode, mixed: rows.length > 1, take: null, rowUnits: 0, contents: rows.map((r) => ({ sku: skuOf(r.itemId), lot: r.lot, units: r.units, word: wordOf(r.itemId) })) };
    }
    const row = byId.get(st.stockId)!;
    return { key, kind: "boxes" as const, stockId: st.stockId, location: st.location, level, code: st.palletCode, mixed: st.mixed, take: st.units, rowUnits: row.units, contents: [{ sku: skuOf(row.itemId), lot: row.lot, units: st.units, word: wordOf(row.itemId) }] };
  };
  // Steps already done: the pallets in the dispatch lane for this outbound (a pallet that kept its ID counts once).
  const doneSteps = new Set(stock.filter((s) => s.outboundId === id).map((s) => s.palletCode ?? s.id)).size;

  return (
    <main className="space-y-4 px-4 py-4">
      <Back code={warehouse.code} />
      <header>
        <p className="cond text-[11px] text-dock-ink/50">
          Pick · Nº {outbound.number} · {warehouse.code}
        </p>
        <h1 className="text-xl font-semibold leading-tight">{outbound.client.name}</h1>
        <p className="text-xs text-dock-ink/55">→ {outbound.consignee?.name ?? "—"}</p>
      </header>
      <PickStep
        outboundId={id}
        lane={lane}
        done={doneSteps}
        total={doneSteps + plan.steps.length}
        shortText={plan.shortLines.length ? describeShortage(plan.shortLines, (itemId) => open.find((o) => o.id === id)?.lines.find((l) => l.itemId === itemId)?.item) : null}
        metres={route.metres}
        steps={route.order.map(describe)}
      />
    </main>
  );
}

function Back({ code }: { code?: string }) {
  return (
    <Link href={`/operator${code ? `?w=${code}` : ""}`} className="cond flex items-center gap-1 text-xs text-dock-ink/50">
      <ArrowLeft size={13} /> Tasks
    </Link>
  );
}
