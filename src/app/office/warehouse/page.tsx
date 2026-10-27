import Link from "next/link";
import { redirect } from "next/navigation";
import { WarehouseView, type Mode } from "@/components/warehouse/warehouse-view";
import { getWarehouseSnapshot } from "@/lib/warehouse/snapshot";

export const dynamic = "force-dynamic";

export default async function WarehousePage({ searchParams }: PageProps<"/office/warehouse">) {
  const { w, pick, color } = await searchParams;
  const code = typeof w === "string" ? w : undefined;
  const pickId = typeof pick === "string" ? pick : null;
  const mode: Mode = color === "age" || color === "expiry" ? color : "customer";

  const snapshot = await getWarehouseSnapshot(code);
  if (!snapshot) {
    return (
      <main className="grid h-screen place-items-center">
        <div className="text-center">
          <p className="text-dock-ink/60">No warehouse set up yet.</p>
          <Link href="/office/warehouse/setup" className="cond mt-3 inline-block bg-dock-ink px-4 py-2 text-sm text-dock-yellow">
            Add your first warehouse
          </Link>
        </div>
      </main>
    );
  }

  // Coming from an approved order: open the building it will leave from.
  const order = pickId ? snapshot.orders.find((o) => o.id === pickId) : null;
  if (order?.warehouse && order.warehouse !== snapshot.current) {
    redirect(`/office/warehouse?w=${order.warehouse}&pick=${pickId}`);
  }

  return <WarehouseView key={snapshot.current} snapshot={snapshot} initialPick={pickId} initialMode={mode} />;
}
