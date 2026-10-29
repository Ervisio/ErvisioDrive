"use client";
import { useI18n } from "@/components/LocaleProvider";
import { useState } from "react";
import useSWR from "swr";
import { request } from "@/lib/client-request";
import Link from "next/link";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { AdminModal } from "@/components/admin/AdminModal";
import { Icon } from "@/components/ui/Icon";
import { faFolderOpen, faGauge } from "@fortawesome/free-solid-svg-icons";
import { formatBytes } from "@/lib/format";
type Member = {
  _id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  isOwner: boolean;
  quotaGb?: number | null;
  lastLogin: string | null;
};
const fetcher = (url: string) => request(url).then((r) => r.json());
const initials = (text: string) =>
  text
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
export function MemberManager() {
  const { t, dateLocale } = useI18n();

  const { data, error, isLoading, mutate } = useSWR(
    "/api/admin/members",
    fetcher,
  );
  const { data: settings } = useSWR("/api/settings", fetcher),
    { data: stats, mutate: refreshStats } = useSWR(
      "/api/stats?range=30d",
      fetcher,
    );
  const defaultGb: number = settings?.data?.userQuotaGb ?? 0,
    used = new Map<string, number>(
      (stats?.storage?.byMember ?? []).map(
        (row: { memberId: string; bytes: number }) => [row.memberId, row.bytes],
      ),
    );
  const [quotaFor, setQuotaFor] = useState<Member | null>(null);
  const [email, setEmail] = useState(""),
    [role, setRole] = useState("member"),
    [busy, setBusy] = useState(false),
    [remove, setRemove] = useState<Member | null>(null),
    [invitation, setInvitation] = useState("");
  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await request("/api/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      setInvitation((await result.json()).invitation || "");
      setEmail("");
      await mutate();
    } finally {
      setBusy(false);
    }
  }
  async function invite(member: Member) {
    const result = await request("/api/admin/members", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: member._id, action: "invite" }),
    });
    setInvitation((await result.json()).invitation);
  }
  async function change(member: Member) {
    await request("/api/admin/members", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: member._id,
        role: member.role === "admin" ? "member" : "admin",
      }),
    });
    await mutate();
  }
  async function saveQuota(member: Member, quotaGb: number | null) {
    await request("/api/admin/members", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: member._id, quotaGb }),
    });
    setQuotaFor(null);
    await Promise.all([mutate(), refreshStats()]);
  }
  async function revoke() {
    if (!remove) return;
    await request("/api/admin/members", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: remove._id }),
    });
    setRemove(null);
    await mutate();
  }
  return (
    <div className="page-wrap">
      <h1 className="text-xl font-bold">{t("Users and access")}</h1>
      <p className="mt-2 text-sm text-ink-faint">
        {t(
          "Add authorized email addresses. Revoking access immediately blocks sessions and links created by that user.",
        )}
      </p>
      <form
        onSubmit={add}
        className="my-8 flex flex-wrap gap-3 rounded-sheet border border-white/[0.06] bg-sheet p-5"
      >
        <label className="min-w-0 basis-full sm:basis-auto flex-1 text-xs text-ink-dim">
          {t("Authorized email")}
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nome@esempio.it"
            className="mt-2 block w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white"
          />
        </label>
        <label className="text-xs text-ink-dim">
          {t("Role")}
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="mt-2 block rounded-lg border border-white/10 bg-surface px-3 py-2.5 text-sm text-white"
          >
            <option value="member">{t("Member")}</option>
            <option value="admin">{t("Administrator")}</option>
          </select>
        </label>
        <button
          disabled={busy}
          className="self-end rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-semibold text-accent-on disabled:opacity-40"
        >
          {busy ? t("Adding…") : t("Authorize email")}
        </button>
      </form>
      {invitation && (
        <div className="mb-6 rounded-card border border-orange-500/20 bg-orange-500/5 p-5">
          <p className="text-sm text-orange-400">
            {t("One-time invitation · valid for 48 hours")}
          </p>
          <p className="my-3 text-xs text-ink-faint">
            {t(
              "Send this privately to the authorized person to set or reset their password.",
            )}
          </p>
          <input
            aria-label={t("Invitation link")}
            readOnly
            value={invitation}
            className="w-full rounded-lg bg-black/30 p-3 font-mono text-xs"
          />
          <div className="mt-3 flex gap-4">
            <button
              onClick={() => navigator.clipboard.writeText(invitation)}
              className="text-xs text-orange-400"
            >
              {t("Copy link")}
            </button>
            <button
              onClick={() => setInvitation("")}
              className="text-xs text-ink-faint"
            >
              {t("Hide")}
            </button>
          </div>
        </div>
      )}
      {isLoading && <p className="text-ink-faint">{t("Loading…")}</p>}
      {error && (
        <p role="alert" className="text-rose-400">
          {t("Unable to load users.")}
        </p>
      )}
      <div className="member-grid">
        {data?.data?.map((member: Member) => {
          const quota = member.quotaGb ?? defaultGb,
            bytes = used.get(member._id) ?? 0,
            percent = quota > 0 ? (bytes / (quota * 1024 ** 3)) * 100 : null;
          return (
            <article key={member._id} className="member-card">
              <header>
                <span className="member-avatar" aria-hidden="true">
                  {initials(member.name || member.email)}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-semibold">
                    {member.name || member.email}
                  </p>
                  <p className="truncate text-xs text-ink-faint">
                    {member.isOwner
                      ? t("Owner")
                      : member.role === "admin"
                        ? t("Administrator")
                        : t("Member")}
                    {" · "}
                    {member.name
                      ? member.email
                      : t("Waiting for first sign-in")}
                  </p>
                </div>
              </header>
              <div className="member-usage">
                <b>{formatBytes(bytes)}</b>
                <span className="text-ink-faint">
                  {quota > 0
                    ? t(member.quotaGb == null ? "of {quota} GB (default)" : "of {quota} GB", {
                        quota,
                      })
                    : t("· unlimited quota")}
                </span>
                {percent !== null && percent > 90 && (
                  <span className="member-warn">{t("almost full")}</span>
                )}
              </div>
              {percent !== null ? (
                <div
                  className="usage-bar"
                  role="meter"
                  aria-label={t("Space used by {name}", {
                    name: member.name || member.email,
                  })}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(Math.min(100, percent))}
                  data-warn={percent > 90 || undefined}
                >
                  <span style={{ width: `${Math.min(100, percent)}%` }} />
                </div>
              ) : (
                <p className="text-xs text-ink-faint">{t("No cap")}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  className="secondary-button"
                  onClick={() => setQuotaFor(member)}
                >
                  <Icon icon={faGauge} /> {t("Quota")}
                </button>
                <Link
                  className="secondary-button"
                  href={`/?owner=${member._id}`}
                >
                  <Icon icon={faFolderOpen} /> {t("Browse files")}
                </Link>
              </div>
              <footer className="member-actions">
                <span>
                  {t("Last sign-in")}:{" "}
                  {member.lastLogin
                    ? new Date(member.lastLogin).toLocaleString(dateLocale)
                    : t("Never")}
                </span>
                <span className="flex flex-wrap gap-3">
                  <button
                    onClick={() => invite(member)}
                    className="text-ink-dim hover:text-white"
                  >
                    {t("Invite / reset")}
                  </button>
                  {!member.isOwner && (
                    <>
                      <button
                        onClick={() => change(member)}
                        className="text-ink-dim hover:text-white"
                      >
                        {member.role === "admin"
                          ? t("Make member")
                          : t("Make admin")}
                      </button>
                      <button
                        onClick={() => setRemove(member)}
                        className="text-rose-400"
                      >
                        {t("Revoke")}
                      </button>
                    </>
                  )}
                </span>
              </footer>
            </article>
          );
        })}
      </div>
      {quotaFor && (
        <QuotaDialog
          member={quotaFor}
          defaultGb={defaultGb}
          bytes={used.get(quotaFor._id) ?? 0}
          onClose={() => setQuotaFor(null)}
          onSave={(quotaGb) => saveQuota(quotaFor, quotaGb)}
        />
      )}
      <ConfirmDialog
        open={!!remove}
        title={t("Revoke access")}
        description={t(
          "Revoke access for {email}? Existing sessions and shared links will stop working. Files remain in the drive.",
          { email: remove?.email ?? "" },
        )}
        onConfirm={revoke}
        onCancel={() => setRemove(null)}
      />
    </div>
  );
}

function QuotaDialog({
  member,
  defaultGb,
  bytes,
  onClose,
  onSave,
}: {
  member: Member;
  defaultGb: number;
  bytes: number;
  onClose: () => void;
  onSave: (quotaGb: number | null) => Promise<void>;
}) {
  const { t } = useI18n();
  const current = member.quotaGb ?? null;
  const [mode, setMode] = useState<"default" | "custom" | "off">(
    current === null ? "default" : current === 0 ? "off" : "custom",
  );
  const [value, setValue] = useState(current ? String(current) : ""),
    [busy, setBusy] = useState(false);
  const gb = Number(value.trim().replace(",", ".")),
    valid = mode !== "custom" || (value.trim() !== "" && Number.isFinite(gb) && gb > 0);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      await onSave(mode === "default" ? null : mode === "off" ? 0 : gb);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AdminModal
      open
      title={t("Quota for {name}", { name: member.name || member.email })}
      onClose={onClose}
      size="md"
    >
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-ink-faint">
          {t("Uses {used}.", { used: formatBytes(bytes) })}
        </p>
        <div className="seg seg-wide" role="group" aria-label={t("Quota")}>
          <button type="button" aria-pressed={mode === "default"} onClick={() => setMode("default")}>
            {defaultGb > 0
              ? t("Default · {quota} GB", { quota: defaultGb })
              : t("Default · unlimited")}
          </button>
          <button type="button" aria-pressed={mode === "custom"} onClick={() => setMode("custom")}>
            {t("Custom")}
          </button>
          <button type="button" aria-pressed={mode === "off"} onClick={() => setMode("off")}>
            {t("Unlimited")}
          </button>
        </div>
        {mode === "custom" && (
          <label className="field-label">
            {t("Personal quota (GB)")}
            <input
              className="field"
              inputMode="decimal"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
        )}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" className="secondary-button" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button className="primary-button" disabled={busy || !valid}>
            {t(busy ? "Saving…" : "Save")}
          </button>
        </div>
      </form>
    </AdminModal>
  );
}
