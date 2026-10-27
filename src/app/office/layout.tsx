import { redirect } from "next/navigation";
import { OfficeSidebar } from "@/components/office-sidebar";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export default async function OfficeLayout({ children }: LayoutProps<"/office">) {
  const session = await getSession();
  if (session?.role !== "office") redirect("/");

  // Everything waiting for the office: messages not read yet plus drafts not approved yet.
  const [newMessages, pendingDrafts] = await Promise.all([
    db.message.count({ where: { status: "NEW" } }),
    db.draft.count({ where: { status: "PENDING" } }),
  ]);
  const inboxCount = newMessages + pendingDrafts;

  return (
    <div className="dock-app flex min-h-screen">
      <OfficeSidebar inboxCount={inboxCount} />
      <div className="dock-grid min-w-0 flex-1">{children}</div>
    </div>
  );
}
