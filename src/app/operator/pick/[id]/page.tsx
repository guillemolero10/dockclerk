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
    return (
      <main className="space-y-4 px-4 py-6">
        <Back code={outbound.warehouse?.code} />
        <div className="hazard p-1">
          <div className="bg-dock-ink px-5 py-6 text-center text-white">
            <Check className="mx-auto text-dock-yellow" size={28} />
            <p className="mt-2 text-lg font-semibold">Nº {outbound.number} is prepared</p>
            <p className="text-sm text-white/60">{picked} pallets waiting in the dispatch lane for the truck.</p>
          </div>
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
  const remaining = plan.stockIds.filter((s) => !plan.picked.includes(s));
  const route = pickRoute(layout, remaining.map((s) => ({ id: s, loc: byId.get(s)!.location })), lane);
  const items = await db.item.findMany({ where: { id: { in: plan.stockIds.map((s) => byId.get(s)!.itemId) } } });
  const describe = (stockId: string) => {
    const s = byId.get(stockId)!;
    const loc = parseLocation(s.location);
    return {
      id: s.id,
      location: s.location,
      level: loc?.kind === "rack" ? loc.level : null,
      sku: items.find((i) => i.id === s.itemId)!.sku,
      lot: s.lot,
      units: s.units,
      word: ({ BOX: "boxes", BAG: "bags", PALLET: "units" } as const)[items.find((i) => i.id === s.itemId)!.unit],
      /** Boxes to take when the plan takes only part of this pallet. */
      take: plan.split.find((p) => p.stockId === stockId)?.units ?? null,
    };
  };

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
        done={plan.picked.length}
        total={plan.stockIds.length}
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
