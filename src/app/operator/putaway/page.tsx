import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PutAwayStep } from "@/components/operator/putaway-step";
import { db } from "@/lib/db";
import { planPutAway } from "@/lib/ops/floor";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function PutAwayPage({ searchParams }: PageProps<"/operator/putaway">) {
  await requireRole("operator");
  const { w } = await searchParams;
  const warehouse = await db.warehouse.findFirst({ where: typeof w === "string" ? { code: w } : {}, orderBy: { code: "asc" } });
  if (!warehouse) return <p className="p-6">No warehouse.</p>;
  const waiting = await db.stock.findMany({
    where: { warehouseId: warehouse.id, location: { startsWith: "REC-" } },
    include: { item: true, client: true },
    orderBy: [{ location: "asc" }, { id: "asc" }],
  });
  // One entry per physical pallet: the rows that share an ID and a lane are one (mixed) pallet.
  const groups = new Map<string, typeof waiting>();
  for (const row of waiting) {
    const key = row.palletCode ? `${row.location}|${row.palletCode}` : row.id;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const palletsWaiting = [...groups.values()];
  const rows = palletsWaiting[0] ?? [];
  const next = rows[0];
  const plan = next ? await planPutAway(next.id) : null;

  return (
    <main className="space-y-4 px-4 py-4">
      <Link href={`/operator?w=${warehouse.code}`} className="cond flex items-center gap-1 text-xs text-dock-ink/50">
        <ArrowLeft size={13} /> Tasks
      </Link>
      <h1 className="text-xl font-semibold">Put away · {warehouse.code}</h1>
      {next ? (
        <PutAwayStep
          key={next.id}
          warehouse={warehouse.code}
          left={palletsWaiting.length}
          pallet={{
            id: next.id,
            from: next.location,
            code: next.palletCode,
            client: next.client.name,
            contents: rows.map((r) => ({ sku: r.item.sku, lot: r.lot, units: r.units })),
          }}
          suggestion={plan?.slot ?? null}
          why={plan?.why ?? ""}
        />
      ) : (
        <p className="dock-card bg-white p-5 text-sm text-dock-ink/60">Nothing waiting in the receiving lanes.</p>
      )}
    </main>
  );
}
