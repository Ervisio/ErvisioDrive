"use client";
import { LanguageSwitch, useI18n } from "@/components/LocaleProvider";
import { useState } from "react";
import { signIn } from "next-auth/react";
export function Login({
  error,
  googleEnabled,
  cognitoEnabled,
}: {
  error: boolean;
  googleEnabled: boolean;
  cognitoEnabled: boolean;
}) {
  const { t, dateLocale } = useI18n();

  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [localError, setLocalError] = useState("");
  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setLocalError("");
    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (result?.ok) window.location.assign("/");
      else
        setLocalError(
          t("Invalid email or password, or access has been revoked."),
        );
    } catch {
      setLocalError(t("Sign-in failed. Please try again shortly."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0a0a0f] p-6 text-white">
      <div className="w-full max-w-md rounded-2xl border border-white/[0.06] bg-[#111118] p-6 sm:p-10 shadow-2xl">
        <div className="mb-5 flex justify-end">
          <LanguageSwitch />
        </div>
        <div className="mb-8 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 text-2xl font-bold">
          E
        </div>
        <p className="mb-3 text-xs font-medium uppercase tracking-[.2em] text-orange-400">
          {t("Your workspace")}
        </p>
        <h1 className="text-3xl font-bold tracking-tight">ErvisioDrive</h1>
        <p className="mb-8 mt-4 text-sm leading-relaxed text-white/40">
          {t("Files, folders and ideas. Everything in its place.")}
          <br />
          {t("Sign in with your authorized account.")}
        </p>
        {error && (
          <p
            role="alert"
            className="mb-5 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300"
          >
            {t(
              "Sign-in failed. Choose an authorized account or contact an administrator.",
            )}
          </p>
        )}
        <form onSubmit={login} className="mb-6 space-y-4">
          <label className="block text-xs text-white/50">
            Email
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-2 block w-full rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white"
            />
          </label>
          <label className="block text-xs text-white/50">
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-2 block w-full rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white"
            />
          </label>
          {localError && (
            <p role="alert" className="text-xs text-rose-400">
              {localError}
            </p>
          )}
          <button
            disabled={busy}
            className="w-full rounded-xl bg-orange-500 p-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? t("Signing in…") : t("Sign in")}
          </button>
          <p className="text-xs text-white/30">
            {t(
              "Ask your administrator for an invitation to activate or recover your account.",
            )}
          </p>
        </form>
        {googleEnabled && (
          <button
            onClick={() => signIn("google", { callbackUrl: "/" })}
            className="flex w-full items-center justify-center gap-3 rounded-xl bg-white px-5 py-3.5 text-sm font-semibold text-[#111118] hover:bg-orange-50"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
              <path
                fill="#4285f4"
                d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"
              />
              <path
                fill="#34a853"
                d="M12 22c2.7 0 4.96-.9 6.62-2.42l-3.24-2.51c-.9.6-2.04.96-3.38.96-2.6 0-4.8-1.76-5.59-4.13H3.07v2.59A10 10 0 0 0 12 22Z"
              />
              <path
                fill="#fbbc05"
                d="M6.41 13.9A6 6 0 0 1 6.1 12c0-.66.11-1.3.31-1.9V7.51H3.07A10 10 0 0 0 2 12c0 1.61.39 3.14 1.07 4.49l3.34-2.59Z"
              />
              <path
                fill="#ea4335"
                d="M12 5.97c1.47 0 2.79.5 3.83 1.51l2.87-2.87A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.93 5.51l3.34 2.59C7.2 7.73 9.4 5.97 12 5.97Z"
              />
            </svg>
            {t("Continue with Google")}
          </button>
        )}
        {cognitoEnabled && (
          <button
            onClick={() => signIn("cognito", { callbackUrl: "/" })}
            className="secondary-button mt-3 w-full"
          >
            {t("Continue with AWS Cognito")}
          </button>
        )}
        <p className="mt-6 text-center text-[11px] leading-relaxed text-white/25">
          {t(
            "Access is restricted to email addresses authorized by an administrator.",
          )}
        </p>
      </div>
    </main>
  );
}
