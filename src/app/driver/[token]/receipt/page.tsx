import { ReceiptSheet } from "@/components/receipt-sheet";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function DriverReceiptPage({ params }: PageProps<"/driver/[token]/receipt">) {
  const { token } = await params;
  const inbound = await db.inbound.findUnique({ where: { driverToken: token }, select: { id: true } });
  if (!inbound) return <p className="p-8">This link is not valid any more.</p>;
  return <ReceiptSheet inboundId={inbound.id} driverToken={token} />;
}
