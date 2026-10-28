"use client";

import { useActionState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { login, type LoginState } from "@/app/actions";

/** The sign-in form. The server action answers with one generic error, whatever was wrong. */
export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, null);

  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="cond text-xs text-white/50">Username</span>
        <input
          name="username"
          defaultValue={state?.username ?? ""}
          required
          maxLength={64}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="mt-1 w-full border border-white/15 bg-black/40 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/25 focus:border-dock-yellow"
        />
      </label>
      <label className="block">
        <span className="cond text-xs text-white/50">Password</span>
        <input
          name="password"
          type="password"
          required
          maxLength={256}
          autoComplete="current-password"
          className="mt-1 w-full border border-white/15 bg-black/40 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/25 focus:border-dock-yellow"
        />
      </label>

      {state?.error && (
        <p role="alert" className="border border-dock-yellow/40 bg-dock-yellow/10 px-3 py-2 text-sm text-dock-yellow">
          {state.error}
        </p>
      )}

      <button
        disabled={pending}
        className="cond group inline-flex w-full items-center justify-center gap-2 bg-dock-yellow px-4 py-2.5 text-sm font-semibold text-dock-ink transition hover:brightness-95 disabled:opacity-60"
      >
        {pending ? (
          <>
            <Loader2 size={15} className="animate-spin" /> Signing in…
          </>
        ) : (
          <>
            Sign in <ArrowRight size={15} className="transition group-hover:translate-x-0.5" />
          </>
        )}
      </button>
    </form>
  );
}
