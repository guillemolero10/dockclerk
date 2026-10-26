import Link from "next/link";
import { redirect } from "next/navigation";
import { LegacyTabs } from "@/components/legacy-tabs";
import { getSession } from "@/lib/session";

export default async function OfficeLayout({ children }: LayoutProps<"/office">) {
  const session = await getSession();
  if (session?.role !== "office") redirect("/");

  return (
    <div className="flex min-h-screen flex-col bg-neutral-100 dark:bg-neutral-950">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-900">
        <Link href="/" className="font-semibold">DockClerk <span className="font-normal text-neutral-500">· Office</span></Link>
        <span className="text-xs text-neutral-500">Simulated legacy software · invented data</span>
      </header>

      <main className="flex-1 p-3">
        <div className="legacy mx-auto max-w-7xl">
          <div className="legacy-titlebar">ALMACENES DEL VINALOPÓ — Gestión de almacén v4.2</div>
          <LegacyTabs />
          <div className="legacy-panel mx-2 mb-2 overflow-auto">{children}</div>
        </div>
      </main>
    </div>
  );
}
