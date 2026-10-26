"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
export function Activate() {
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
      setError("Le password non coincidono");
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
      if (!response.ok)
        throw new Error(body.error || "Attivazione non riuscita");
      setDone(true);
      setPassword("");
      setConfirm("");
      setToken("");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Errore di connessione",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#111118] p-8">
        <p className="mb-4 text-xs uppercase tracking-widest text-orange-400">
          ErvisioDrive
        </p>
        <h1 className="text-xl font-bold">
          {done ? "Password impostata" : "Imposta la tua password"}
        </h1>
        {done ? (
          <>
            <p className="my-5 text-sm text-white/50">
              Puoi accedere con email e password. Le sessioni precedenti sono
              state chiuse.
            </p>
            <Link href="/login" className="text-orange-400">
              Vai al login →
            </Link>
          </>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <p className="text-sm text-white/40">
              Usa almeno 12 caratteri. L’invito è monouso e valido per 48 ore.
            </p>
            <label className="block text-sm">
              Nuova password
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
              Ripeti password
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
              {busy ? "Salvataggio…" : "Imposta password"}
            </button>
            <p className="text-xs text-white/30">
              Se il link è scaduto chiedi un nuovo invito all’amministratore.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
