"use client";
import { LanguageSwitch, useI18n } from "@/components/LocaleProvider";
import { useEffect, useState } from "react";
import Link from "next/link";
export function Activate() {
  const { t, dateLocale } = useI18n();

  const [token, setToken] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [error, setError] = useState(""),
    [done, setDone] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setToken(window.location.hash.slice(1));
    window.history.replaceState(null, "", "/activate");
  }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== confirm) {
      setError(t("Passwords do not match"));
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/activate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, password }),
        }),
        body = await response.json();
      if (!response.ok) throw new Error(body.error || t("Activation failed"));
      setDone(true);
      setPassword("");
      setConfirm("");
      setToken("");
    } catch (error) {
      setError(error instanceof Error ? error.message : t("Connection error"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#111118] p-8">
        <div className="mb-4 flex justify-end">
          <LanguageSwitch />
        </div>
        <p className="mb-4 text-xs uppercase tracking-widest text-orange-400">
          ErvisioDrive
        </p>
        <h1 className="text-xl font-bold">
          {done ? t("Password set") : t("Set your password")}
        </h1>
        {done ? (
          <>
            <p className="my-5 text-sm text-white/50">
              {t(
                "You can now sign in with your email and password. Previous sessions have been closed.",
              )}
            </p>
            <Link href="/login" className="text-orange-400">
              {t("Go to sign-in →")}
            </Link>
          </>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <p className="text-sm text-white/40">
              {t(
                "Use at least 12 characters. Invitations can be used once and expire after 48 hours.",
              )}
            </p>
            <label className="block text-sm">
              {t("New password")}
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-2 block w-full rounded-lg border border-white/10 bg-white/5 p-3"
              />
            </label>
            <label className="block text-sm">
              {t("Repeat password")}
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="mt-2 block w-full rounded-lg border border-white/10 bg-white/5 p-3"
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-rose-400">
                {error}
              </p>
            )}
            <button
              disabled={!token || busy}
              className="w-full rounded-lg bg-orange-500 p-3 text-sm font-semibold disabled:opacity-40"
            >
              {busy ? t("Saving…") : t("Set password")}
            </button>
            <p className="text-xs text-white/30">
              {t(
                "If this link has expired, ask your administrator for a new invitation.",
              )}
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
