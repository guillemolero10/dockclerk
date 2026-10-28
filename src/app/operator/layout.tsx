import Link from "next/link";
import { LogOut } from "lucide-react";
import { logout } from "@/app/actions";
import { requireRole } from "@/lib/session";

/** The handheld: one phone-wide column, big targets, works with gloves on. */
export default async function OperatorLayout({ children }: LayoutProps<"/operator">) {
  await requireRole("operator");

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
          <form action={logout} className="ml-auto">
            <button className="text-white/40 hover:text-white" aria-label="Sign out" title="Sign out">
              <LogOut size={16} />
            </button>
          </form>
        </header>
        {children}
      </div>
    </div>
  );
}
