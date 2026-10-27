import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PutAwayStep } from "@/components/operator/putaway-step";
import { db } from "@/lib/db";
import { suggestPutAway } from "@/lib/ops/floor";

export const dynamic = "force-dynamic";

export default async function PutAwayPage({ searchParams }: PageProps<"/operator/putaway">) {
  const { w } = await searchParams;
  const warehouse = await db.warehouse.findFirst({ where: typeof w === "string" ? { code: w } : {}, orderBy: { code: "asc" } });
  if (!warehouse) return <p className="p-6">No warehouse.</p>;
  const waiting = await db.stock.findMany({
    where: { warehouseId: warehouse.id, location: { startsWith: "REC-" } },
    include: { item: true, client: true },
    orderBy: [{ location: "asc" }, { id: "asc" }],
  });
  const next = waiting[0];
  const suggestion = next ? await suggestPutAway(next.id) : null;

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
          left={waiting.length}
          pallet={{ id: next.id, from: next.location, sku: next.item.sku, description: next.item.description, lot: next.lot, client: next.client.name, units: next.units }}
          suggestion={suggestion}
        />
      ) : (
        <p className="dock-card bg-white p-5 text-sm text-dock-ink/60">Nothing waiting in the receiving lanes.</p>
      )}
    </main>
  );
}
