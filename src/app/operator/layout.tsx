import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { getSession } from "@/lib/session";

/** The handheld: one phone-wide column, big targets, works with gloves on. */
export default async function OperatorLayout({ children }: LayoutProps<"/operator">) {
  const session = await getSession();
  if (session?.role !== "operator") redirect("/");

  return (
    <div className="dock-app min-h-screen">
      <div className="mx-auto min-h-screen w-full max-w-md bg-dock-concrete shadow-[0_0_0_1.5px_#15130f] md:my-0">
        <div className="hazard h-2" />
        <header className="flex items-center gap-2.5 bg-dock-ink px-4 py-3">
          <Link href="/operator" className="flex items-center gap-2.5">
            <span className="cond grid h-7 w-7 place-items-center bg-dock-yellow text-xs font-bold text-dock-ink">DC</span>
            <span className="text-sm font-semibold text-white">DockClerk</span>
            <span className="cond text-[11px] text-white/40">Floor</span>
          </Link>
          <Link href="/" className="ml-auto text-white/40 hover:text-white" aria-label="Switch role">
            <LogOut size={16} />
          </Link>
        </header>
        {children}
      </div>
    </div>
  );
}
