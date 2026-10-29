"use client";
import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { request } from "@/lib/client-request";
import { useI18n } from "@/components/LocaleProvider";
import { PERMISSIONS, type Permission } from "@/lib/permissions-catalog";
import { AdminModal } from "@/components/admin/AdminModal";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
type Token = {
  _id: string;
  name: string;
  ownerId: string;
  prefix: string;
  scopes: string[];
  resourceMode: "all" | "selected";
  fileIds: string[];
  folderSlugs: string[];
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
};
export function TokenManager({ admin }: { admin: boolean }) {
  const { t, dateLocale } = useI18n(),
    [all, setAll] = useState(false),
    { data, error, mutate } = useSWR(
      `/api/tokens${all ? "?all=true" : ""}`,
      (url: string) => request(url).then((r) => r.json()),
    );
  const [open, setOpen] = useState(false),
    [editing, setEditing] = useState<Token | null>(null),
    [name, setName] = useState(""),
    [scopes, setScopes] = useState<string[]>([]),
    [resourceMode, setResourceMode] = useState("all"),
    [fileIds, setFileIds] = useState(""),
    [folders, setFolders] = useState(""),
    [expires, setExpires] = useState(""),
    [busy, setBusy] = useState(false),
    [secret, setSecret] = useState(""),
    [revoke, setRevoke] = useState<Token | null>(null),
    [copied, setCopied] = useState(false);
  const permissions: Permission[] = data?.permissions || [];
  const groups = [...new Set(permissions.map((p) => p.split(":")[0]))];
  function begin(token: Token | null) {
    setEditing(token);
    setName(token?.name || "");
    setScopes(token?.scopes || ["files:list", "files:read", "files:download"]);
    setResourceMode(token?.resourceMode || "all");
    setFileIds(token?.fileIds.join(", ") || "");
    setFolders(token?.folderSlugs.join(", ") || "");
    setExpires("");
    setOpen(true);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const body = {
        ...(editing ? { id: editing._id } : {}),
        name,
        scopes,
        resourceMode,
        fileIds: fileIds
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        folderSlugs: folders
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        ...(!editing && expires
          ? { expiresAt: new Date(expires).toISOString() }
          : {}),
      };
      const response = await request("/api/tokens", {
          method: editing ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        result = await response.json();
      setOpen(false);
      if (result.secret) {
        setSecret(result.secret);
        setCopied(false);
      }
      await mutate();
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!revoke) return;
    await request("/api/tokens", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: revoke._id }),
    });
    setRevoke(null);
    await mutate();
  }
  return (
    <div className="page-wrap">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">{t("API tokens")}</h1>
          <p className="page-description">
            {t(
              "Explicit permissions, resource restrictions and immediate revocation.",
            )}
          </p>
        </div>
        <button
          className="primary-button"
          onClick={() => begin(null)}
          disabled={!data}
        >
          {t("Create API token")}
        </button>
      </div>
      <div className="my-5 flex flex-wrap items-center justify-between gap-4">
        <Link href="/docs" className="text-sm text-orange-400">
          {t("API documentation")} →
        </Link>
        {admin && (
          <label className="flex min-h-11 items-center gap-3 text-sm text-ink-dim">
            <input
              type="checkbox"
              checked={all}
              onChange={(e) => setAll(e.target.checked)}
            />
            {t("Show all workspace tokens")}
          </label>
        )}
      </div>
      {error && (
        <p role="alert" className="text-rose-400">
          {t("Unable to load API tokens.")}
        </p>
      )}
      {!data && !error && <p className="muted">{t("Loading…")}</p>}
      <div className="space-y-3">
        {data?.data?.map((token: Token) => (
          <article key={token._id} className="panel">
            <div className="flex flex-col justify-between gap-4 sm:flex-row">
              <div className="min-w-0">
                <h2 className="break-words font-semibold">{token.name}</h2>
                <code className="text-xs text-ink-faint">{token.prefix}</code>
                <p className="mt-2 text-xs text-ink-faint">
                  {t("Expires")}:{" "}
                  {new Date(token.expiresAt).toLocaleString(dateLocale)} ·{" "}
                  {t(
                    token.revokedAt
                      ? "Revoked"
                      : new Date(token.expiresAt) < new Date()
                        ? "Expired"
                        : "Active",
                  )}
                </p>
                <p className="mt-1 text-xs text-ink-faint">
                  {t("Last used")}:{" "}
                  {token.lastUsedAt
                    ? new Date(token.lastUsedAt).toLocaleString(dateLocale)
                    : t("Never")}
                </p>
                {all && (
                  <p className="mt-1 break-all text-xs text-ink-faint">
                    {t("Owner ID")}: {token.ownerId}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap items-start gap-2">
                {!token.revokedAt && new Date(token.expiresAt) > new Date() && (
                  <>
                    <button
                      className="secondary-button"
                      onClick={() => begin(token)}
                    >
                      {t("Edit permissions")}
                    </button>
                    <button
                      className="danger-button"
                      onClick={() => setRevoke(token)}
                    >
                      {t("Revoke")}
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {token.scopes.map((scope) => (
                <code
                  key={scope}
                  className="rounded bg-white/5 px-2 py-1 text-[11px] text-orange-300/70"
                >
                  {scope}
                </code>
              ))}
            </div>
            <p className="mt-3 break-words text-xs text-ink-faint">
              {token.resourceMode === "all"
                ? t("All resources accessible to the owner")
                : t("Selected resources only")}
              {token.resourceMode === "selected" &&
                `: ${[...token.folderSlugs, ...token.fileIds].join(", ")}`}
            </p>
          </article>
        ))}
        {data?.data?.length === 0 && (
          <div className="panel muted">{t("No API tokens yet.")}</div>
        )}
      </div>
      <AdminModal
        open={open}
        title={t(editing ? "Edit API token" : "Create API token")}
        onClose={() => !busy && setOpen(false)}
        size="xl"
      >
        <form onSubmit={save} className="space-y-5">
          <label className="field-label">
            {t("Token name")}
            <input
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="field"
            />
          </label>
          {!editing && (
            <label className="field-label">
              {t("Expiry (optional)")}
              <input
                type="datetime-local"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
                className="field"
              />
              <span className="muted">
                {t("Default: {days} days. Maximum: {max} days.", {
                  days: data?.policy?.defaultLifetimeDays || 30,
                  max: data?.policy?.maxLifetimeDays || 365,
                })}
              </span>
            </label>
          )}
          <fieldset>
            <legend className="mb-3 text-sm font-semibold">
              {t("Permissions")}
            </legend>
            <div className="mb-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  setScopes(
                    permissions.filter((p) =>
                      [
                        "files:list",
                        "files:read",
                        "files:download",
                        "folders:list",
                        "folders:read",
                      ].includes(p),
                    ),
                  )
                }
              >
                {t("Read-only preset")}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setScopes(["files:upload"])}
              >
                {t("Upload only")}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setScopes([...permissions])}
              >
                {t("Select all available")}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setScopes([])}
              >
                {t("Clear selection")}
              </button>
            </div>
            <div className="space-y-3">
              {groups.map((group) => (
                <details
                  key={group}
                  open
                  className="rounded-card border border-white/10 p-3"
                >
                  <summary className="min-h-9 cursor-pointer text-sm font-medium capitalize text-orange-400">
                    {group}
                  </summary>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {permissions
                      .filter((p) => p.startsWith(group + ":"))
                      .map((scope) => (
                        <label
                          key={scope}
                          className="flex min-h-12 cursor-pointer gap-3 rounded-lg bg-white/[0.02] p-3"
                        >
                          <input
                            className="mt-1 h-4 w-4 shrink-0 accent-orange-500"
                            type="checkbox"
                            checked={scopes.includes(scope)}
                            onChange={(e) =>
                              setScopes((current) =>
                                e.target.checked
                                  ? [...current, scope]
                                  : current.filter((s) => s !== scope),
                              )
                            }
                          />
                          <span className="min-w-0">
                            <code className="break-all text-[11px] text-ink">
                              {scope}
                            </code>
                            <small className="mt-1 block text-xs text-ink-faint">
                              {t(PERMISSIONS[scope])}
                            </small>
                          </span>
                        </label>
                      ))}
                  </div>
                </details>
              ))}
            </div>
          </fieldset>
          <label className="field-label">
            {t("Resource access")}
            <select
              className="field"
              aria-label={t("Resource access")}
              value={resourceMode}
              onChange={(e) => setResourceMode(e.target.value)}
            >
              <option value="all">
                {t("All resources accessible to the owner")}
              </option>
              <option value="selected">{t("Selected resources only")}</option>
            </select>
          </label>
          {resourceMode === "selected" && (
            <div className="space-y-4">
              <label className="field-label">
                {t("Folder slugs (comma-separated)")}
                <input
                  className="field"
                  value={folders}
                  onChange={(e) => setFolders(e.target.value)}
                  placeholder="documents, images, project-assets-a1b2c3d4"
                />
              </label>
              <label className="field-label">
                {t("File IDs (comma-separated)")}
                <textarea
                  className="field font-mono"
                  rows={3}
                  value={fileIds}
                  onChange={(e) => setFileIds(e.target.value)}
                />
              </label>
              <p className="muted">
                {t(
                  "Selected folders include their current and future files. File-only tokens cannot upload, move or duplicate files outside allowed folders.",
                )}
              </p>
            </div>
          )}
          <p className="muted">
            {t(
              "Token permissions never bypass the owner’s current role or file access rules. Secrets are displayed once.",
            )}
          </p>
          <button
            disabled={busy || !scopes.length}
            className="primary-button w-full sm:w-auto"
          >
            {t(
              busy
                ? "Saving…"
                : editing
                  ? "Save permissions"
                  : "Create API token",
            )}
          </button>
        </form>
      </AdminModal>
      <AdminModal
        open={!!secret}
        title={t("Copy your API token now")}
        onClose={() => setSecret("")}
      >
        <p className="mb-4 text-sm text-ink-dim">
          {t(
            "This secret will not be shown again. Keep it private and send it only in the Authorization header.",
          )}
        </p>
        <textarea
          readOnly
          aria-label={t("API token secret")}
          className="field min-h-28 font-mono text-sm"
          value={secret}
        />
        <button
          className="primary-button mt-4"
          onClick={async () => {
            await navigator.clipboard.writeText(secret);
            setCopied(true);
          }}
        >
          {t(copied ? "Copied!" : "Copy token")}
        </button>
      </AdminModal>
      <ConfirmDialog
        open={!!revoke}
        title={t("Revoke API token")}
        description={t(
          "This token will stop working immediately. You can create a replacement later.",
        )}
        dangerous
        onConfirm={remove}
        onCancel={() => setRevoke(null)}
      />
    </div>
  );
}
