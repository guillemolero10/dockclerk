"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLang } from "./actions";
import { useT } from "./client";
import type { Lang } from "./core";

/** The ES / EN button. `tone` is the background it sits on; `big` gives the 44 px targets the handheld needs. */
export function LangSwitch({ tone = "dark", big = false }: { tone?: "dark" | "light"; big?: boolean }) {
  const { lang, t } = useT();
  const router = useRouter();
  const [pending, start] = useTransition();

  const choose = (next: Lang) => {
    if (next === lang || pending) return;
    start(async () => {
      await setLang(next);
      router.refresh();
    });
  };

  const idle = tone === "dark" ? "text-white/55 hover:text-white" : "text-dock-ink/55 hover:text-dock-ink";
  const frame = tone === "dark" ? "border-white/25" : "border-dock-ink/30";
  const size = big ? "min-h-11 min-w-11 px-2.5" : "min-h-8 min-w-8 px-2";

  return (
    <div role="group" aria-label={t("lang.label")} className={`cond inline-flex shrink-0 border ${frame} text-xs font-semibold ${pending ? "opacity-60" : ""}`}>
      {(["es", "en"] as const).map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-pressed={lang === code}
          onClick={() => choose(code)}
          className={`${size} ${lang === code ? "bg-dock-yellow text-dock-ink" : idle}`}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
