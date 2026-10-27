import { redirect } from "next/navigation";
import { ReceiptSheet } from "@/components/receipt-sheet";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Office and floor see every receipt; a customer only its own. */
export default async function ReceiptPage({ params }: PageProps<"/receipts/[id]">) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/");
  if (session.role === "customer") {
    const own = await db.inbound.findFirst({ where: { id, clientId: session.clientId }, select: { id: true } });
    if (!own) redirect("/portal");
  }
  return <ReceiptSheet inboundId={id} />;
}
