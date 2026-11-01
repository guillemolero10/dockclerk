import { LegacyTabs } from "@/components/legacy-tabs";
import { getT } from "@/lib/i18n/server";

// The warehouse's existing software, simulated. DockClerk writes into it after human approval.
export default async function LegacyLayout({ children }: LayoutProps<"/office/legacy">) {
  const { t } = await getT();
  return (
    <main className="p-6">
      <p className="mb-3 text-xs text-zinc-500">
        {t("lgc.note")}
      </p>
      <div className="legacy overflow-hidden shadow-2xl shadow-black/50">
        <div className="legacy-titlebar">ALMACENES DEL VINALOPÓ — Gestión de almacén v4.2</div>
        <LegacyTabs />
        <div className="legacy-panel mx-2 mb-2 max-h-[calc(100vh-140px)] overflow-auto">{children}</div>
      </div>
    </main>
  );
}
