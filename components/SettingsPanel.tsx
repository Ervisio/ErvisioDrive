"use client";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { request } from "@/lib/client-request";
import { useI18n, LanguageSwitch } from "@/components/LocaleProvider";
import { useEditorLayout } from "@/components/admin/cdn/CdnTextEditor";
import { LimitSettings } from "@/components/LimitSettings";
import type { settingsDefaults } from "@/lib/settings";
type Settings = typeof settingsDefaults;
export function SettingsPanel({ admin }: { admin: boolean }) {
  const { t } = useI18n(),
    { data, error, mutate } = useSWR(admin ? "/api/settings" : null, (url) =>
      request(url).then((r) => r.json()),
    );
  const [draft, setDraft] = useState<Settings | null>(null),
    [tab, setTab] = useState("General"),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [editorLayout, setEditorLayout] = useEditorLayout();
  useEffect(() => {
    if (data?.data) setDraft(data.data);
  }, [data]);
  const set = (key: keyof Settings, value: unknown) => {
    setDraft((current) => (current ? { ...current, [key]: value } : null));
    setSaved(false);
  };
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    try {
      await request("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      await mutate();
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }
  const toggle = (key: keyof Settings, label: string, description: string) => (
    <label className="setting-row">
      <span>
        <strong>{t(label)}</strong>
        <small>{t(description)}</small>
      </span>
      <input
        type="checkbox"
        checked={!!draft?.[key]}
        onChange={(e) => set(key, e.target.checked)}
        className="h-5 w-5 shrink-0 accent-orange-500"
      />
    </label>
  );
  const number = (
    key: keyof Settings,
    label: string,
    min: number,
    max: number,
  ) => (
    <label className="field-label">
      {t(label)}
      <input
        type="number"
        min={min}
        max={max}
        required
        value={Number(draft?.[key] ?? 0)}
        onChange={(e) => set(key, Number(e.target.value))}
        className="field"
      />
    </label>
  );
  return (
    <div className="page-wrap">
      <h1 className="page-title">{t("Settings")}</h1>
      <p className="page-description">
        {t("Personal preferences and workspace configuration.")}
      </p>
      <section className="panel my-6">
        <div className="setting-row">
          <span>
            <strong>{t("Language")}</strong>
            <small>
              {t(
                "English is the default. Your choice is saved on this device.",
              )}
            </small>
          </span>
          <LanguageSwitch />
        </div>
        <label className="setting-row">
          <span>
            <strong>{t("Text editor")}</strong>
            <small>
              {t(
                "How text and code files open. Full screen is always one click away. Saved on this device.",
              )}
            </small>
          </span>
          <select
            value={editorLayout}
            onChange={(e) => setEditorLayout(e.target.value as "dialog" | "panel")}
            className="field w-auto"
          >
            <option value="dialog">{t("Dialog")}</option>
            <option value="panel">{t("Side panel")}</option>
          </select>
        </label>
      </section>
      {admin && (
        <>
          {error && (
            <p role="alert" className="text-rose-400">
              {t("Unable to load settings.")}
            </p>
          )}
          {!draft && !error && <p>{t("Loading…")}</p>}
          {draft && (
            <form onSubmit={save}>
              <nav className="tab-strip" aria-label={t("Settings sections")}>
                {["General", "Space and limits", "Authentication", "API & security"].map(
                  (item) => (
                    <button
                      type="button"
                      key={item}
                      onClick={() => setTab(item)}
                      aria-pressed={tab === item}
                      className={tab === item ? "tab active" : "tab"}
                    >
                      {t(item)}
                    </button>
                  ),
                )}
              </nav>
              <div className="panel mt-4 space-y-5">
                {tab === "General" && (
                  <>
                    <label className="field-label">
                      {t("Workspace name")}
                      <input
                        className="field"
                        required
                        maxLength={60}
                        value={draft.siteName}
                        onChange={(e) => set("siteName", e.target.value)}
                      />
                    </label>
                    <label className="field-label">
                      {t("Default language")}
                      <select
                        className="field"
                        value={draft.defaultLocale}
                        onChange={(e) => set("defaultLocale", e.target.value)}
                      >
                        <option value="en">English</option>
                        <option value="it">Italiano</option>
                      </select>
                    </label>
                    <p className="muted">
                      {t("Used when a visitor has not selected a language.")}
                    </p>
                  </>
                )}
                {tab === "Space and limits" && (
                  <>
                    <LimitSettings
                      draft={draft}
                      environment={data.environment}
                      set={set}
                    />
                    <p className="muted">
                      {t(
                        "To expand the disk quota, run setup.sh --resize or setup.bat --resize on the host.",
                      )}
                    </p>
                  </>
                )}
                {tab === "Authentication" && (
                  <>
                    <p className="muted">
                      {t(
                        "Local email/password sign-in remains available for account recovery. Every provider requires a whitelisted email.",
                      )}
                    </p>
                    {toggle(
                      "googleEnabled",
                      "Google sign-in",
                      "Enable Google when OAuth credentials are configured on the server.",
                    )}
                    <p className="muted">
                      Google:{" "}
                      {t(
                        data.environment.googleConfigured
                          ? "Configured"
                          : "Not configured",
                      )}
                    </p>
                    {toggle(
                      "cognitoEnabled",
                      "AWS Cognito sign-in",
                      "Use your Cognito user pool through the authorization code flow with PKCE.",
                    )}
                    <p className="muted">
                      AWS Cognito:{" "}
                      {t(
                        data.environment.cognitoConfigured
                          ? "Configured"
                          : "Not configured",
                      )}
                    </p>
                    <div className="rounded-card bg-black/20 p-4 text-xs">
                      <p className="mb-2 text-ink-faint">
                        {t("Server environment")}
                      </p>
                      <code className="break-all">
                        COGNITO_ISSUER=
                        {data.environment.cognitoIssuer ||
                          "https://cognito-idp.REGION.amazonaws.com/USER_POOL_ID"}
                        <br />
                        COGNITO_CLIENT_ID=
                        {data.environment.cognitoClientId || "…"}
                        <br />
                        COGNITO_CLIENT_SECRET=…
                      </code>
                      <p className="mt-4 text-ink-faint">{t("Callback URL")}</p>
                      <code className="break-all">
                        {data.environment.callbackBase}
                        /api/auth/callback/cognito
                      </code>
                    </div>
                    <p className="muted">
                      {t(
                        "Provider secrets stay in the server environment and are never exposed by the settings API. Restart the stack after changing them.",
                      )}
                    </p>
                  </>
                )}
                {tab === "API & security" && (
                  <>
                    {toggle(
                      "apiEnabled",
                      "Enable API",
                      "Disable all Bearer API access immediately without affecting browser sessions.",
                    )}
                    {toggle(
                      "membersCanCreateTokens",
                      "Allow member API access",
                      "When disabled, existing member tokens stop working too.",
                    )}
                    {number(
                      "defaultTokenLifetimeDays",
                      "Default token lifetime (days)",
                      1,
                      365,
                    )}
                    {number(
                      "maxTokenLifetimeDays",
                      "Maximum token lifetime (days)",
                      1,
                      365,
                    )}
                    {toggle(
                      "sharingEnabled",
                      "Enable public download links",
                      "Disabling this also blocks existing public links.",
                    )}
                    {number(
                      "maxShareLifetimeHours",
                      "Maximum public link lifetime (hours; 0 = unlimited)",
                      0,
                      87600,
                    )}
                  </>
                )}
              </div>
              <div className="sticky bottom-0 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-card border border-white/10 bg-sheet/95 p-4 backdrop-blur">
                <span role="status" className="text-sm text-emerald-400">
                  {saved ? t("Settings saved") : ""}
                </span>
                <button disabled={busy} className="primary-button">
                  {t(busy ? "Saving…" : "Save settings")}
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}
