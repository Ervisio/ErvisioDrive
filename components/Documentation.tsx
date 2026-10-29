"use client";
import { useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { API_OPERATIONS } from "@/lib/api-operations";
import { PERMISSIONS, permissionNames } from "@/lib/permissions-catalog";
import { schemas } from "@/lib/openapi";
export function Documentation() {
  const { t } = useI18n(),
    [tab, setTab] = useState("Overview"),
    [search, setSearch] = useState("");
  const examples = {
    "List files": `curl "$BASE/api/v1/files?limit=25" \\\n+  -H "Authorization: Bearer $ERVISIO_TOKEN"`,
    "Upload a file": `curl -X POST "$BASE/api/v1/files/upload" \\\n+  -H "Authorization: Bearer $ERVISIO_TOKEN" \\\n+  -F 'folder=documents' -F 'files=@report.pdf'`,
    "Download a file": `curl "$BASE/api/v1/files/FILE_ID/download" \\\n+  -H "Authorization: Bearer $ERVISIO_TOKEN" \\\n+  --output report.pdf`,
    "Rename a file": `curl -X PATCH "$BASE/api/v1/files/FILE_ID/name" \\\n+  -H "Authorization: Bearer $ERVISIO_TOKEN" \\\n+  -H 'Content-Type: application/json' \\\n+  --data '{"name":"report-final.pdf"}'`,
    "Issue a restricted token": `curl -X POST "$BASE/api/v1/tokens" \\\n+  -H "Authorization: Bearer $ERVISIO_TOKEN" \\\n+  -H 'Content-Type: application/json' \\\n+  --data '{"name":"Backups","scopes":["files:list","files:download"],"resourceMode":"selected","folderSlugs":["documents"]}'`,
  };
  return (
    <div className="page-wrap">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">{t("Documentation")}</h1>
          <p className="page-description">
            {t("Drive guide, API reference and authentication setup.")}
          </p>
        </div>
        <a
          href="/api/openapi.json"
          download="ervisiodrive-openapi.json"
          className="secondary-button"
        >
          {t("Download OpenAPI")}
        </a>
      </div>
      <nav className="tab-strip mt-6" aria-label={t("Documentation sections")}>
        {["Overview", "Endpoints", "Permissions", "Examples", "Cognito"].map(
          (item) => (
            <button
              key={item}
              onClick={() => setTab(item)}
              className={tab === item ? "tab active" : "tab"}
              aria-pressed={tab === item}
            >
              {t(item)}
            </button>
          ),
        )}
      </nav>
      {tab === "Overview" && (
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {[
            [
              "Files and folders",
              "Upload files, create folders inside folders and switch between grid, list and Explorer views. Sort by name, type, size, creation or modification date. Select several files to delete, move or download them together. Open Actions on any file to preview, edit, rename, move, duplicate, share or delete it.",
            ],
            [
              "Authentication",
              "Use email/password, Google or AWS Cognito. All providers require a whitelisted email. One-time invitations activate local passwords; they expire after 48 hours.",
            ],
            [
              "API tokens",
              "Create tokens in API tokens. Choose explicit permissions, expiry and optional file/folder restrictions. The secret is shown once and stored only as a hash.",
            ],
            [
              "Permission checks",
              "Every API request requires a Bearer token, an enabled API, an active owner, the required scope, the owner’s current role and content access. Resource restrictions apply even to admin-owned tokens.",
            ],
            [
              "Delegation",
              "A token cannot issue permissions, resources or a lifetime beyond its own. Users cannot create admin permissions. Whitelisting an administrator additionally requires members:role; issuing invitations requires members:invite.",
            ],
            [
              "Public download links",
              "A public share is a separate download capability that does not require an API token. Creating it requires shares:create and ownership/admin rights. Password, expiry and download limits are optional unless settings impose them. Disable public sharing in Settings to block existing links too.",
            ],
            [
              "Storage",
              "The disk quota is selected at setup and grows only as files are written. Expand it with setup.sh --resize or setup.bat --resize. Settings can reduce upload limits without exceeding the host limit.",
            ],
            [
              "API conventions",
              "Use /api/v1 and Authorization: Bearer TOKEN. JSON responses contain success and data, or success:false and error. Collections use limit (1–100) and cursor. Keep following nextCursor until null. X-Request-Id helps correlate errors with audit events.",
            ],
          ].map(([heading, text]) => (
            <section key={heading} className="panel">
              <h2 className="font-semibold text-orange-400">{t(heading)}</h2>
              <p className="mt-3 text-sm leading-relaxed text-ink-dim">
                {t(text)}
              </p>
            </section>
          ))}
        </div>
      )}
      {tab === "Endpoints" && (
        <div className="mt-5 space-y-3">
          <input
            aria-label={t("Search API reference")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Search paths, permissions or operations…")}
            className="field"
          />
          {API_OPERATIONS.filter((operation) =>
            `${operation.path} ${operation.scope} ${operation.summary}`
              .toLowerCase()
              .includes(search.toLowerCase()),
          ).map((operation) => (
            <details className="panel" key={operation.method + operation.path}>
              <summary className="flex cursor-pointer flex-wrap items-center gap-3">
                <span className="rounded bg-orange-500/10 px-2 py-1 font-mono text-xs font-bold text-orange-400">
                  {operation.method}
                </span>
                <code className="min-w-0 break-all text-sm">
                  /api/v1{operation.path}
                </code>
              </summary>
              <p className="mt-4 text-sm text-ink-dim">
                {t(operation.summary)}
              </p>
              <p className="mt-3 text-xs text-ink-faint">
                {t("Required permission")}:{" "}
                <code className="text-orange-300">
                  {operation.scope || t("Valid token only")}
                </code>
              </p>
              {operation.body && (
                <>
                  <h3 className="mb-2 mt-5 text-sm font-medium">
                    {t("Request body")}
                    {operation.body === "upload"
                      ? " · multipart/form-data"
                      : " · application/json"}
                  </h3>
                  <pre className="max-h-96 overflow-auto rounded-card bg-black/30 p-4 text-xs leading-relaxed text-ink-dim">
                    {JSON.stringify(schemas[operation.body], null, 2)}
                  </pre>
                </>
              )}
              <p className="mt-4 text-xs leading-relaxed text-ink-faint">
                {t(
                  "401: invalid token · 403: insufficient permission or content access · 409: conflict · 413: quota/size limit · 429: rate limited. The OpenAPI document includes all request and response schemas.",
                )}
              </p>
            </details>
          ))}
        </div>
      )}
      {tab === "Permissions" && (
        <div className="mt-5 space-y-3">
          <p className="page-description">
            {t(
              "No wildcards or implicit grants. Select only what each integration needs.",
            )}
          </p>
          {permissionNames.map((scope) => (
            <div
              key={scope}
              className="panel flex flex-col justify-between gap-2 sm:flex-row"
            >
              <code className="break-all text-sm text-orange-300">{scope}</code>
              <p className="text-sm text-ink-dim">{t(PERMISSIONS[scope])}</p>
            </div>
          ))}
        </div>
      )}
      {tab === "Examples" && (
        <div className="mt-5 space-y-4">
          <p className="muted">
            {t(
              "Set BASE to your service URL and ERVISIO_TOKEN to your secret. These examples run on your server or terminal; never put tokens in URLs.",
            )}
          </p>
          {Object.entries(examples).map(([title, code]) => (
            <section className="panel" key={title}>
              <h2 className="mb-3 font-medium">{t(title)}</h2>
              <pre className="overflow-x-auto rounded-card bg-black/30 p-4 text-xs leading-relaxed text-ink-dim">
                {code}
              </pre>
            </section>
          ))}
        </div>
      )}
      {tab === "Cognito" && (
        <article className="panel mt-5 space-y-5 text-sm leading-relaxed text-ink-dim">
          <h2 className="text-lg font-bold text-white">AWS Cognito</h2>
          <p>
            {t(
              "Create a Cognito User Pool and an app client with the authorization code grant. Configure a managed login domain, allow openid email profile, and add your callback URL.",
            )}
          </p>
          <code className="block break-all rounded-card bg-black/30 p-4">
            https://drive.example.com/api/auth/callback/cognito
          </code>
          <p>
            {t(
              "Set the following variables in .env, then restart Docker Compose. The issuer is the user-pool issuer, not the managed login domain.",
            )}
          </p>
          <pre className="overflow-x-auto rounded-card bg-black/30 p-4 text-xs">{`COGNITO_ISSUER='https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_POOLID'\nCOGNITO_CLIENT_ID='your-app-client-id'\nCOGNITO_CLIENT_SECRET='your-client-secret'`}</pre>
          <p>
            {t(
              "Clients with a secret and public clients using PKCE are supported. For a public client, leave COGNITO_CLIENT_SECRET empty. email_verified must be true. The provider identity is bound to issuer + sub; Cognito groups never grant workspace admin rights.",
            )}
          </p>
          <p>
            {t(
              "Whitelisting remains mandatory even if Cognito allows self-registration. Configure Cognito MFA and password policies in AWS. Cognito sign-in does not turn Cognito access tokens into ErvisioDrive API tokens.",
            )}
          </p>
          <a
            className="text-orange-400"
            href="https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html"
            target="_blank"
            rel="noreferrer"
          >
            AWS Cognito documentation ↗
          </a>
        </article>
      )}
    </div>
  );
}
