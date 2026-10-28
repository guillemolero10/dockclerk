import { redirect } from "next/navigation";
import { ReceiptSheet } from "@/components/receipt-sheet";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The dock receipt of one delivery. The office and the floor (who made it) see any receipt;
 * a customer only the ones of their own deliveries. The driver has his own copy at /driver/[token]/receipt.
 */
export default async function ReceiptPage({ params }: PageProps<"/receipts/[id]">) {
  const { id } = await params;
  const session = await requireRole("office", "operator", "customer");
  if (session.role === "customer") {
    const own = await db.inbound.findFirst({ where: { id, clientId: session.clientId }, select: { id: true } });
    if (!own) redirect("/portal");
  }
  return <ReceiptSheet inboundId={id} />;
}
