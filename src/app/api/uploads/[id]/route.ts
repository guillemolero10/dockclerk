import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Photos, signatures and voice notes: who may open one. */
async function mayOpen(id: string, driverToken: string | null) {
  const session = await getSession();
  // The warehouse's own people see everything it holds.
  if (session?.role === "office" || session?.role === "operator") return true;

  // Anyone else only sees the files that appear on a receipt of their own delivery.
  const path = `/api/uploads/${id}`;
  const onReceiptOf = async (inbound: Prisma.InboundWhereInput) =>
    !!(await db.dockReceipt.findFirst({
      where: { OR: [{ noteImageUrl: path }, { palletImageUrl: path }, { signatureUrl: path }], inbound },
      select: { id: true },
    }));

  if (session?.role === "customer" && session.clientId && (await onReceiptOf({ clientId: session.clientId }))) return true;
  // The driver has no account: the secret in the link he was sent opens the files of that one delivery.
  if (driverToken && (await onReceiptOf({ driverToken }))) return true;
  return false;
}

export async function GET(request: Request, { params }: RouteContext<"/api/uploads/[id]">) {
  const { id } = await params;
  const upload = (await mayOpen(id, new URL(request.url).searchParams.get("t"))) ? await db.upload.findUnique({ where: { id } }) : null;
  // The same answer for "does not exist" and "not yours": nobody can probe which ids exist.
  if (!upload) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(upload.data), {
    headers: {
      "Content-Type": upload.mime,
      // Never let a browser guess a different type, and never run anything from a file opened directly.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}
