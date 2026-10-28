import { WarehouseSetup } from "@/components/warehouse/warehouse-setup";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function WarehouseSetupPage({ searchParams }: PageProps<"/office/warehouse/setup">) {
  await requireRole("office");
  const { code } = await searchParams;
  const warehouse =
    typeof code === "string"
      ? await db.warehouse.findUnique({ where: { code }, include: { _count: { select: { stock: true, inbounds: true, outbounds: true } } } })
      : null;

  return (
    <WarehouseSetup
      existing={
        warehouse
          ? {
              code: warehouse.code,
              name: warehouse.name,
              city: warehouse.city,
              dims: { length: warehouse.length, width: warehouse.width, height: warehouse.height, aisleWidth: warehouse.aisleWidth, docks: warehouse.docks },
              pallets: warehouse._count.stock,
              hasHistory: warehouse._count.stock + warehouse._count.inbounds + warehouse._count.outbounds > 0,
            }
          : null
      }
    />
  );
}
