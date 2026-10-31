"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
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
  faPlus,
  faLock,
  faFolder,
  faChartSimple,
  faCloud,
} from "@fortawesome/free-solid-svg-icons";
import { formatBytes } from "@/lib/format";
import { request } from "@/lib/client-request";
import type { Actor } from "@/lib/policy";
import { useI18n, LanguageSwitch } from "@/components/LocaleProvider";

interface ShellFolder {
  slug: string;
  name: string;
  allowedUsers: string[];
  parent: string | null;
  ancestors: string[];
}

const initials = (value: string) =>
  value.split(/[\s-_]+/).filter(Boolean).map((word) => word[0]).join("").slice(0, 2).toUpperCase();

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
    params = useSearchParams(),
    activeFolder = path === "/" ? params.get("folder") : null,
    [error, setError] = useState(""),
    [mobile, setMobile] = useState(false),
    [account, setAccount] = useState(false),
    [railOpen, setRailOpen] = useState(false),
    [tip, setTip] = useState<{ label: string; x: number; y: number } | null>(null),
    drawer = useRef<HTMLDialogElement>(null),
    accountRef = useRef<HTMLDivElement>(null);
  const { data: usage } = useSWR(
    "/api/storage",
    (url) => fetch(url).then((r) => (r.ok ? r.json() : null)),
    { refreshInterval: 10000 },
  );
  const { data: foldersData } = useSWR<{ data: ShellFolder[] }>(
    "/api/admin/cdn/folders",
    (url: string) => request(url).then((r) => r.json()),
  );
  // The mobile navigation lists accessible top-level folders.
  const allFolders = foldersData?.data ?? [],
    visible = new Set(allFolders.map((f) => f.slug)),
    folders = allFolders.filter((f) => !f.parent || !visible.has(f.parent)),
    // Inside a subfolder, its top-level folder stays highlighted.
    open = allFolders.find((f) => f.slug === activeFolder),
    activeRoot =
      [...(open?.ancestors ?? []), open?.slug].find(
        (slug) => slug && folders.some((f) => f.slug === slug),
      ) ?? activeFolder;
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
  // The rail's state is kept per browser, like the folder panel.
  useEffect(() => {
    try {
      setRailOpen(localStorage.getItem("drive-rail") === "open");
    } catch {}
  }, []);
  const toggleRail = (open: boolean) => {
    setRailOpen(open);
    setTip(null);
    try {
      localStorage.setItem("drive-rail", open ? "open" : "collapsed");
    } catch {}
  };
  // One fixed tooltip next to the hovered or focused item, so the rail's scroll never clips it.
  const showTip = (target: Element) => {
    const el = target.closest<HTMLElement>("[data-tip]");
    if (railOpen || !el) return setTip(null);
    const box = el.getBoundingClientRect();
    setTip({ label: el.dataset.tip ?? "", x: box.right + 12, y: box.top + box.height / 2 });
  };
  useEffect(() => {
    setMobile(false);
    setAccount(false);
  }, [path, params]);
  useEffect(() => {
    if (!account) return;
    const close = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccount(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [account]);
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
    { href: "/stats", label: "Statistics", icon: faChartSimple },
    ...(actor.role === "admin"
      ? [{ href: "/admin", label: "Users and access", icon: faUsers }]
      : []),
    { href: "/tokens", label: "API tokens", icon: faKey },
    { href: "/settings", label: "Settings", icon: faGear },
    { href: "/docs", label: "Documentation", icon: faBook },
  ];
  const current = (href: string) =>
    href === "/" ? path === "/" && !activeFolder : path === href;
  // Each member sees their own space; quotas are null when unlimited.
  const space = usage?.data
    ? {
        usedBytes: usage.data.member?.usedBytes ?? usage.data.usedBytes,
        quotaBytes: usage.data.member?.quotaBytes ?? usage.data.quotaBytes,
      }
    : null;
  const used = space?.quotaBytes
    ? Math.min(100, (100 * space.usedBytes) / space.quotaBytes)
    : 0;
  const spaceLabel = space
    ? space.quotaBytes
      ? `${formatBytes(space.usedBytes)} / ${formatBytes(space.quotaBytes)}`
      : `${formatBytes(space.usedBytes)} · ${t("Unlimited")}`
    : "";
  const pageLabel = t(links.find((l) => l.href === path)?.label || "My drive");
  const meter = space && (
    <div>
      {space.quotaBytes ? (
        <div
          role="meter"
          aria-label={t("Storage usage")}
          aria-valuenow={space.usedBytes}
          aria-valuemin={0}
          aria-valuemax={space.quotaBytes}
          className="mb-2 h-1 overflow-hidden rounded-full bg-white/10"
        >
          <div className="h-full rounded-full bg-accent" style={{ width: `${used}%` }} />
        </div>
      ) : null}
      <p className="text-[13px] text-ink-dim">{spaceLabel}</p>
    </div>
  );
  return (
    <div className={`app-shell bg-backdrop text-ink ${railOpen ? "rail-open" : ""}`}>
      <nav
        className="rail"
        aria-label={t("Main navigation")}
        onPointerOver={(e) => showTip(e.target as Element)}
        onPointerLeave={() => setTip(null)}
        onFocus={(e) => e.target.matches(":focus-visible") && showTip(e.target)}
        onBlur={() => setTip(null)}
        onScrollCapture={() => setTip(null)}
      >
        <div className="rail-top">
          <button
            onClick={() => toggleRail(!railOpen)}
            aria-label={t(railOpen ? "Collapse sidebar" : "Expand sidebar")}
            aria-expanded={railOpen}
            data-tip={t("Expand sidebar")}
            className="rail-toggle"
          >
            <Icon icon={faBars} />
          </button>
          <Link href="/" className="rail-brand">
            <b>
              <Icon icon={faHardDrive} />
            </b>
            <span className="truncate">{siteName}</span>
          </Link>
        </div>
        <div className="rail-links">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-label={t(link.label)}
              aria-current={current(link.href) ? "page" : undefined}
              data-tip={t(link.label)}
              className="rail-item"
            >
              <Icon icon={link.icon} />
              <span className="rail-label">{t(link.label)}</span>
            </Link>
          ))}
        </div>
        <div className="rail-folders">
          <span className="rail-sep" />
          <Link
            href="/?new=folder"
            className="rail-item add"
            aria-label={t("New folder")}
            data-tip={t("New folder")}
          >
            <Icon icon={faPlus} />
            <span className="rail-label">{t("New folder")}</span>
          </Link>
        </div>
        {space && (
          <div className="rail-foot">
            <div
              className="usage-ring"
              style={{ "--used": used } as React.CSSProperties}
              data-tip={`${t("Storage usage")}: ${spaceLabel}`}
              aria-label={`${t("Storage usage")}: ${spaceLabel}`}
              role="img"
            >
              <span>{space.quotaBytes ? `${Math.round(used)}%` : "∞"}</span>
            </div>
            <div className="usage-card">
              <b>
                <Icon icon={faCloud} />
                {t("Storage usage")}
              </b>
              {meter}
            </div>
          </div>
        )}
      </nav>
      {tip && !railOpen && (
        <span className="rail-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
          {tip.label}
        </span>
      )}
      <dialog
        ref={drawer}
        className="mobile-drawer"
        onCancel={() => setMobile(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setMobile(false);
        }}
        aria-label={t("Main navigation")}
      >
        <div className="flex min-h-dvh flex-col p-3">
          <div className="flex h-14 items-center gap-3 px-2">
            <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-accent text-accent-on">
              <Icon icon={faHardDrive} />
            </span>
            <span className="min-w-0 flex-1 truncate text-lg font-semibold">
              {siteName}
            </span>
            <button
              aria-label={t("Close navigation")}
              onClick={() => setMobile(false)}
              className="icon-button h-11 w-11"
            >
              <Icon icon={faXmark} />
            </button>
          </div>
          <nav className="mt-3 space-y-0.5" aria-label={t("Main navigation")}>
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={current(link.href) ? "page" : undefined}
                className={`panel-item min-h-12 ${current(link.href) ? "active" : ""}`}
              >
                <Icon icon={link.icon} />
                {t(link.label)}
              </Link>
            ))}
          </nav>
          {folders.length > 0 && (
            <>
              <p className="px-4 pb-1 pt-5 text-[13px] font-semibold text-ink-dim">
                {t("Folders")}
              </p>
              {folders.map((folder) => (
                <Link
                  key={folder.slug}
                  href={`/?folder=${encodeURIComponent(folder.slug)}`}
                  className={`panel-item min-h-12 ${activeRoot === folder.slug ? "active" : ""}`}
                >
                  <Icon icon={folder.allowedUsers.length ? faLock : faFolder} />
                  <span className="truncate">{folder.name}</span>
                </Link>
              ))}
            </>
          )}
          <div className="mt-auto px-4 py-4">{meter}</div>
        </div>
      </dialog>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-2 bg-backdrop px-2 sm:px-4 lg:pl-1">
          <button
            onClick={() => setMobile(true)}
            aria-label={t("Open navigation")}
            className="icon-button h-11 w-11 lg:hidden"
          >
            <Icon icon={faBars} />
          </button>
          <div id="shell-search" className="flex min-w-0 max-w-[720px] flex-1 items-center">
            {path !== "/" && (
              <p className="truncate px-2 text-lg font-medium lg:hidden">{pageLabel}</p>
            )}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <span className="hidden sm:inline-flex">
              <LanguageSwitch />
            </span>
            <div className="relative" ref={accountRef}>
              <button
                onClick={() => setAccount((open) => !open)}
                aria-label={t("Account")}
                aria-expanded={account}
                className="grid h-11 w-11 place-items-center rounded-full hover:bg-white/[0.07]"
              >
                <span className="avatar h-8 w-8 text-[13px]">
                  {initials(actor.name || actor.email)}
                </span>
              </button>
              {account && (
                <div className="menu-popover right-0 top-12 w-72">
                  <div className="px-4 pb-3 pt-2">
                    <p className="truncate text-sm font-semibold">{actor.name}</p>
                    <p className="truncate text-xs text-ink-faint" title={actor.email}>
                      {actor.email}
                    </p>
                    <span className="status-badge mt-2 bg-accent-soft text-accent-ink">
                      {t(actor.role === "admin" ? "Administrator" : "Member")}
                    </span>
                  </div>
                  <div className="border-t border-white/[0.08] px-4 py-2 sm:hidden">
                    <LanguageSwitch />
                  </div>
                  <button
                    className="border-t border-white/[0.08]"
                    onClick={() => signOut({ callbackUrl: "/login" })}
                  >
                    <Icon icon={faRightFromBracket} />
                    {t("Sign out")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="main-content" className="min-w-0 lg:pr-4">
          {children}
        </main>
      </div>
      {error && (
        <div
          role="alert"
          className="fixed inset-x-3 bottom-4 z-[100] flex items-start gap-3 rounded-card bg-ink p-4 text-sm text-sheet shadow-float sm:inset-x-auto sm:right-6 sm:max-w-md"
        >
          <span className="min-w-0 flex-1 break-words">{t(error)}</span>
          <button
            aria-label={t("Dismiss error")}
            onClick={() => setError("")}
            className="grid h-11 w-11 shrink-0 place-items-center"
          >
            <Icon icon={faXmark} />
          </button>
        </div>
      )}
    </div>
  );
}
