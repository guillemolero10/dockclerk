import { ReceiptSheet } from "@/components/receipt-sheet";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function DriverReceiptPage({ params }: PageProps<"/driver/[token]/receipt">) {
  const { token } = await params;
  const { t } = await getT();
  const inbound = await db.inbound.findUnique({ where: { driverToken: token }, select: { id: true } });
  if (!inbound) return <p className="p-8">{t("dr.linkInvalid")}</p>;
  return <ReceiptSheet inboundId={inbound.id} driverToken={token} />;
}
