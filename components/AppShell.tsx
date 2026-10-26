"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Icon } from "@/components/ui/Icon";
import {
  faHardDrive,
  faUsers,
  faBook,
  faRightFromBracket,
} from "@fortawesome/free-solid-svg-icons";
import useSWR from "swr";
import { formatBytes } from "@/lib/format";
import type { Actor } from "@/lib/policy";

export function AppShell({
  actor,
  children,
}: {
  actor: Actor;
  children: React.ReactNode;
}) {
  const { data: usage } = useSWR(
    "/api/storage",
    (url) => fetch(url).then((r) => (r.ok ? r.json() : null)),
    { refreshInterval: 10000 },
  );
  const path = usePathname(),
    [error, setError] = useState("");
  useEffect(() => {
    const listener = (event: Event) =>
      setError((event as CustomEvent<string>).detail);
    window.addEventListener("drive-error", listener);
    const reject = (event: PromiseRejectionEvent) => {
      if (event.reason instanceof Error) {
        setError(event.reason.message);
        event.preventDefault();
      }
    };
    window.addEventListener("unhandledrejection", reject);
    return () => {
      window.removeEventListener("drive-error", listener);
      window.removeEventListener("unhandledrejection", reject);
    };
  }, []);
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(""), 7000);
      return () => clearTimeout(timer);
    }
  }, [error]);
  const links = [
    { href: "/", label: "Il mio drive", icon: faHardDrive },
    ...(actor.role === "admin"
      ? [{ href: "/admin", label: "Utenti e accessi", icon: faUsers }]
      : []),
    { href: "/docs", label: "Guida", icon: faBook },
  ];
  return (
    <div className="admin-shell min-h-screen bg-[#0a0a0f] text-white">
      <aside className="admin-sidebar fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-white/[0.06] md:flex">
        <Link
          href="/"
          className="flex items-center gap-3 p-6 text-lg font-bold"
        >
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-orange-500/15 text-orange-400">
            <Icon icon={faHardDrive} />
          </span>
          ErvisioDrive
        </Link>
        <p className="px-6 pb-3 text-[10px] font-semibold uppercase tracking-[.2em] text-white/25">
          Workspace
        </p>
        <nav className="flex-1 space-y-2 px-3">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm ${path === link.href ? "bg-orange-500/10 text-orange-400" : "text-white/45 hover:bg-white/5 hover:text-white"}`}
            >
              <Icon icon={link.icon} />
              {link.label}
            </Link>
          ))}
        </nav>
        {usage?.data && (
          <div className="px-6 pb-5">
            <p className="mb-2 text-[11px] text-white/35">
              {formatBytes(usage.data.usedBytes)} di{" "}
              {formatBytes(usage.data.quotaBytes)}
            </p>
            <div className="h-1 overflow-hidden rounded bg-white/10">
              <div
                className="h-full bg-orange-500"
                style={{
                  width: `${Math.min(100, (100 * usage.data.usedBytes) / usage.data.quotaBytes)}%`,
                }}
              />
            </div>
          </div>
        )}
        <div className="m-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <p className="truncate text-sm font-medium">{actor.name}</p>
          <p
            className="mt-1 truncate text-xs text-white/35"
            title={actor.email}
          >
            {actor.email}
          </p>
          <span className="mt-3 inline-block rounded-md bg-orange-500/10 px-2 py-1 text-[10px] text-orange-400">
            {actor.role === "admin" ? "Amministratore" : "Membro"}
          </span>
          <button
            className="mt-4 flex w-full items-center gap-2 text-xs text-white/40 hover:text-white"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <Icon icon={faRightFromBracket} />
            Esci
          </button>
        </div>
      </aside>
      <div className="md:ml-60">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.04] px-6 py-4">
          <span className="text-xs text-white/35">
            ErvisioDrive <span className="mx-2 text-white/15">/</span>
            {links.find((l) => l.href === path)?.label || "Drive"}
          </span>
          <span className="text-[11px] text-emerald-400/70">
            ● Accesso riservato
          </span>
          <nav className="flex w-full flex-wrap gap-4 md:hidden">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-sm text-orange-400"
              >
                {l.label}
              </Link>
            ))}
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="text-sm text-white/40"
            >
              Esci
            </button>
          </nav>
        </header>
        {children}
      </div>
      {error && (
        <div
          role="alert"
          className="fixed bottom-6 right-6 z-[100] flex max-w-md gap-4 rounded-xl border border-rose-500/30 bg-[#211219] p-4 text-sm shadow-xl"
        >
          <span>{error}</span>
          <button aria-label="Chiudi errore" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
