import { WarehouseView } from "@/components/warehouse/warehouse-view";
import { getWarehouseSnapshot } from "@/lib/warehouse/snapshot";

export const dynamic = "force-dynamic";

export default async function WarehousePage({ searchParams }: PageProps<"/office/warehouse">) {
  const { pick } = await searchParams;
  const snapshot = await getWarehouseSnapshot();
  return <WarehouseView snapshot={snapshot} initialPick={typeof pick === "string" ? pick : null} />;
}
