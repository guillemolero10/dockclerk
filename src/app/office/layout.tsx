import { redirect } from "next/navigation";
import { OfficeSidebar } from "@/components/office-sidebar";
import { getAlerts } from "@/lib/alerts";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export default async function OfficeLayout({ children }: LayoutProps<"/office">) {
  const session = await getSession();
  if (session?.role !== "office") redirect("/");

  // Everything waiting for the office: messages not read yet plus drafts not approved yet.
  // Plus the alerts that need acting on now.
  const [newMessages, pendingDrafts, alerts] = await Promise.all([
    db.message.count({ where: { status: "NEW" } }),
    db.draft.count({ where: { status: "PENDING" } }),
    // A badge is not worth breaking every office page for.
    getAlerts().catch((error) => {
      console.error("Alerts failed", error);
      return [];
    }),
  ]);
  const inboxCount = newMessages + pendingDrafts;

  return (
    <div className="dock-app flex min-h-screen">
      <OfficeSidebar inboxCount={inboxCount} alertCount={alerts.filter((a) => a.level === "red").length} />
      <div className="dock-grid min-w-0 flex-1">{children}</div>
    </div>
  );
}
