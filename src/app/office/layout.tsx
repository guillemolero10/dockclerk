import { redirect } from "next/navigation";
import { OfficeSidebar } from "@/components/office-sidebar";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

export default async function OfficeLayout({ children }: LayoutProps<"/office">) {
  const session = await getSession();
  if (session?.role !== "office") redirect("/");

  const inboxCount = await db.message.count({ where: { status: "NEW" } });

  return (
    <div className="dock-app flex min-h-screen">
      <OfficeSidebar inboxCount={inboxCount} />
      <div className="dock-grid min-w-0 flex-1">{children}</div>
    </div>
  );
}
