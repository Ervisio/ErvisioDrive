"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import useSWR from "swr";
import { Icon } from "@/components/ui/Icon";
import {
  faHardDrive,
  faUsers,
  faBook,
  faRightFromBracket,
  faGear,
  faKey,
  faBars,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { formatBytes } from "@/lib/format";
import type { Actor } from "@/lib/policy";
import { useI18n, LanguageSwitch } from "@/components/LocaleProvider";

export function AppShell({
  actor,
  children,
  siteName = "ErvisioDrive",
}: {
  actor: Actor;
  children: React.ReactNode;
  siteName?: string;
}) {
  const { t } = useI18n(),
    path = usePathname(),
    [error, setError] = useState(""),
    [mobile, setMobile] = useState(false),
    drawer = useRef<HTMLDialogElement>(null);
  const { data: usage } = useSWR(
    "/api/storage",
    (url) => fetch(url).then((r) => (r.ok ? r.json() : null)),
    { refreshInterval: 10000 },
  );
  useEffect(() => {
    const listener = (event: Event) =>
      setError((event as CustomEvent<string>).detail);
    window.addEventListener("drive-error", listener);
    return () => window.removeEventListener("drive-error", listener);
  }, []);
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(""), 8000);
      return () => clearTimeout(timer);
    }
  }, [error]);
  useEffect(() => {
    setMobile(false);
  }, [path]);
  useEffect(() => {
    if (mobile) {
      drawer.current?.showModal();
      const previous = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = previous;
        drawer.current?.close();
      };
    }
  }, [mobile]);
  const links = [
    { href: "/", label: "My drive", icon: faHardDrive },
    ...(actor.role === "admin"
      ? [{ href: "/admin", label: "Users and access", icon: faUsers }]
      : []),
    { href: "/tokens", label: "API tokens", icon: faKey },
    { href: "/settings", label: "Settings", icon: faGear },
    { href: "/docs", label: "Documentation", icon: faBook },
  ];
  const navigation = (
    <>
      <Link
        href="/"
        onClick={() => setMobile(false)}
        className="flex min-h-20 items-center gap-3 border-b border-white/5 px-5 text-lg font-bold"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-orange-500/15 text-orange-400">
          <Icon icon={faHardDrive} />
        </span>
        <span className="truncate">{siteName}</span>
      </Link>
      <p className="px-5 pb-2 pt-6 text-[10px] font-semibold uppercase tracking-[.2em] text-white/25">
        {t("Workspace")}
      </p>
      <nav className="flex-1 space-y-1 px-3" aria-label={t("Main navigation")}>
        {links.map((link) => (
          <Link
            onClick={() => setMobile(false)}
            key={link.href}
            href={link.href}
            aria-current={path === link.href ? "page" : undefined}
            className={`flex min-h-12 items-center gap-3 rounded-xl px-4 py-3 text-sm ${path === link.href ? "bg-orange-500/10 text-orange-400" : "text-white/50 hover:bg-white/5 hover:text-white"}`}
          >
            <Icon icon={link.icon} />
            {t(link.label)}
          </Link>
        ))}
      </nav>
      {usage?.data && (
        <div className="px-5 py-5">
          <p className="mb-2 text-xs text-white/40">
            {formatBytes(usage.data.usedBytes)} /{" "}
            {formatBytes(usage.data.quotaBytes)}
          </p>
          <div
            role="meter"
            aria-label={t("Storage usage")}
            aria-valuenow={usage.data.usedBytes}
            aria-valuemin={0}
            aria-valuemax={usage.data.quotaBytes}
            className="h-1.5 overflow-hidden rounded bg-white/10"
          >
            <div
              className="h-full bg-orange-500"
              style={{
                width: `${Math.min(100, (100 * usage.data.usedBytes) / usage.data.quotaBytes)}%`,
              }}
            />
          </div>
        </div>
      )}
      <div className="m-3 rounded-xl border border-white/5 bg-white/[0.02] p-4">
        <p className="truncate text-sm font-medium">{actor.name}</p>
        <p className="mt-1 truncate text-xs text-white/35" title={actor.email}>
          {actor.email}
        </p>
        <span className="mt-3 inline-block rounded bg-orange-500/10 px-2 py-1 text-[10px] text-orange-400">
          {t(actor.role === "admin" ? "Administrator" : "Member")}
        </span>
        <button
          className="mt-3 flex min-h-11 w-full items-center gap-2 text-sm text-white/50 hover:text-white"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          <Icon icon={faRightFromBracket} />
          {t("Sign out")}
        </button>
      </div>
    </>
  );
  return (
    <div className="admin-shell min-h-dvh bg-[#0a0a0f] text-white">
      <aside className="admin-sidebar fixed inset-y-0 left-0 z-30 hidden w-60 flex-col overflow-y-auto border-r border-white/5 lg:flex">
        {navigation}
      </aside>
      <dialog
        ref={drawer}
        className="mobile-drawer"
        onCancel={() => setMobile(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setMobile(false);
        }}
        aria-label={t("Main navigation")}
      >
        <div className="flex min-h-dvh flex-col">
          <button
            aria-label={t("Close navigation")}
            onClick={() => setMobile(false)}
            className="absolute right-2 top-4 grid h-11 w-11 place-items-center rounded-lg bg-[#16161f] text-white/70"
          >
            <Icon icon={faXmark} />
          </button>
          {navigation}
        </div>
      </dialog>
      <div className="min-w-0 lg:ml-60">
        <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between gap-3 border-b border-white/5 bg-[#0a0a0f]/95 px-4 py-2 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => setMobile(true)}
              aria-label={t("Open navigation")}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 text-white/60 lg:hidden"
            >
              <Icon icon={faBars} />
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold lg:hidden">
                {siteName}
              </p>
              <p className="truncate text-xs text-white/40">
                {t(links.find((l) => l.href === path)?.label || "My drive")}
              </p>
            </div>
          </div>
          <LanguageSwitch />
        </header>
        <main id="main-content" className="min-w-0">
          {children}
        </main>
      </div>
      {error && (
        <div
          role="alert"
          className="fixed inset-x-3 bottom-4 z-[100] flex items-start gap-3 rounded-xl border border-rose-500/30 bg-[#211219] p-4 text-sm shadow-xl sm:inset-x-auto sm:right-6 sm:max-w-md"
        >
          <span className="min-w-0 flex-1 break-words">{t(error)}</span>
          <button
            aria-label={t("Dismiss error")}
            onClick={() => setError("")}
            className="grid h-11 w-11 shrink-0 place-items-center"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
