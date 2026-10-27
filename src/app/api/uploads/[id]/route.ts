import { db } from "@/lib/db";

// Ids are random and unguessable; the links only appear to people who already see the receipt.
export async function GET(_: Request, { params }: RouteContext<"/api/uploads/[id]">) {
  const { id } = await params;
  const upload = await db.upload.findUnique({ where: { id } });
  if (!upload) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(upload.data), {
    headers: { "Content-Type": upload.mime, "Cache-Control": "private, max-age=86400, immutable" },
  });
}
