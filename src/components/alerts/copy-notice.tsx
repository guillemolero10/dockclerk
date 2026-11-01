"use client";

import { useState } from "react";
import { Check, Copy, MessageSquareText } from "lucide-react";
import { useT } from "@/lib/i18n/client";

/** The notice the clerk wrote for the customer, ready to paste into an email or WhatsApp. */
export function CopyNotice({ text, label }: { text: string; label?: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="cond flex items-center gap-1.5 text-[11px] text-dock-ink/60 underline hover:text-dock-ink">
        <MessageSquareText size={13} /> {label ?? t("al.notice")}
      </button>
    );
  }
  return (
    <div className="mt-1 w-full border-[1.5px] border-dock-ink bg-white p-3">
      <p className="cond mb-1 text-[10px] text-dock-ink/50">{t("al.noticeHelp")}</p>
      <p className="text-sm">{text}</p>
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        }}
        className="cond mt-2 flex items-center gap-1.5 bg-dock-ink px-3 py-1.5 text-xs text-dock-yellow"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? t("al.copied") : t("al.copy")}
      </button>
    </div>
  );
}
