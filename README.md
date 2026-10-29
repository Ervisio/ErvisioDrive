# ErvisioDrive

A private, self-hosted drive extracted from FusionHub. Dark UI, folders, previews, text editing and protected sharing, with **local accounts, Google and AWS Cognito**, **granular API tokens**, and **Docker setup**.

**English is the default language.** Italian is available from the language selector and persists on the device. Phone layouts include a navigation drawer, stacked lists, native dialogs, visible file action menus and a touch-friendly move dialog.

## Quick start

Install Docker Engine with Compose v2 on Linux, or Docker Desktop in Linux-container mode on Windows/macOS. Host Node.js and MongoDB installations are not needed.

```bash
git clone https://github.com/Ervisio/ErvisioDrive.git
cd ErvisioDrive
./setup.sh
```

On Windows, run `setup.bat`. The setup asks for the service URL, initial owner email, host storage folder, port and quota in GiB. It generates a session secret, starts the stack and prints a **one-time, 48-hour invitation** for setting the owner's password. The login username is the email supplied during setup.

Defaults: `http://localhost:3000`, loopback binding, 100 GiB file quota. Remote access requires HTTPS through a reverse proxy or tunnel. MongoDB has no published port.

```bash
./setup.sh --non-interactive --admin-email admin@example.com \
  --url https://drive.example.com --storage-path /srv/ervisiodrive/files --quota 500
```

```bat
setup.bat --non-interactive --admin-email admin@example.com --url https://drive.example.com --storage-path D:/ErvisioDrive/files --quota 500
```

## Update an existing installation

```bash
git pull
docker compose up -d --build --wait
```

Existing accounts, passwords, files, sessions and quota are preserved. New settings use safe defaults; no manual data migration is required. Do not run `docker compose down -v` on an installation whose database you need to keep.

## Storage: grow on demand

The selected host directory is bind-mounted at `/data/files`. **No virtual disk or quota-sized file is preallocated.** A 500 GiB quota with 3 GiB of files uses approximately 3 GiB for file data. MongoDB, Docker images and logs occupy additional host space outside the file quota.

Uploads, copies and editor growth reserve quota atomically. Deletion and expiry cleanup release it. This is an application quota; direct writes from the host are outside the counter. The host filesystem must have actual free space.

Expand without moving data:

```bash
./setup.sh --resize 500
# Windows: setup.bat --resize 500
```

Lowering quota below current usage preserves existing files and blocks growth. To change the physical disk, stop `app` and `cleanup`, copy the file directory with permissions intact, change `DRIVE_STORAGE_PATH` in `.env` and restart Compose.

## Settings panel

All members can select their language. Administrators can configure:

- Workspace name and default language for visitors without a saved preference.
- **Space and limits**: total space, per-file upload size, default per-person quota, API request rate and statistics retention. An empty value for total space or upload size follows `.env` (`STORAGE_QUOTA_GB`, `UPLOAD_MAX_MB`); `0` means unlimited.
- Per-person quota in **Users and access**: default, custom or unlimited. Administrators can also browse a member's files.
- Google/Cognito availability after their credentials are configured on the host.
- API availability, member API access, rate limits, token lifetimes and public-link policy.

API/member-sharing switches apply on the next request, including to existing tokens and links. Local login remains available for recovery. Provider secrets stay in `.env`; the settings API never returns them. Storage paths stay under host control through the setup scripts.

## Encryption at rest

Files are encrypted on disk with a per-member key (AES-256-GCM) derived from `STORAGE_ENCRYPTION_KEY`, which setup generates. Back that key up with the database: without it the files cannot be read. Installations created before encryption keep reading their plain files and encrypt new uploads.

## Statistics

**Statistics** shows storage by file type and by member, uploads and downloads over time, and API usage per token: administrators see the whole drive, members see their own files and tokens. The page reads `/api/stats` (`overview`, `tokens`, `tokens/{id}`) with the browser session.

## Ervisio plugin

ErvisioDrive can be managed from an [Ervisio](https://github.com/Ervisio/ervisio) console. Answer **yes** to "Ervisio plugin integration" during setup (or pass `--ervisio yes`): the drive then opens an administration socket at `/run/ervisio-drive/api.sock` on the host. The `/api/plugin/*` routes are served only on that socket, behind a per-process secret; over the network they answer 404.

Install **ErvisioDrive** from **Plugins** in the console. The plugin shows the drive's state and usage, edits space and limits, manages people and quotas, and can publish the drive on its own web address through Caddy. Its source is in [`plugin/`](plugin/); releases are built by `.github/workflows/plugin-release.yml` from `vX.Y.Z` tags.

## Accounts and authentication

There is no public registration. An administrator whitelists email addresses and issues private, one-time activation/reset links. Invitations expire in 48 hours and are stored only as hashes. The token is carried in the URL fragment and removed from the address bar after opening.

Local passwords use salted **scrypt (`N=131072, r=8, p=1`)**, with 12–128 characters. Sessions use HttpOnly cookies, Secure on HTTPS, CSRF protection for sign-in and same-origin checks for browser mutations. Login and activation requests have persistent rate limits.

Every protected request rechecks membership, current role and session version. Removing an account revokes sessions and API access. Resetting a password invalidates browser sessions; API tokens are managed independently. Recreating an email does not restore old credentials. The original owner cannot be removed or demoted from the panel.

Recover the owner from the host:

```bash
docker compose run --rm bootstrap node scripts/ops.mjs reset-owner
```

### Google

Create a Web OAuth client. Register `https://drive.example.com/api/auth/callback/google` (or `http://localhost:3000/api/auth/callback/google` locally), set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and restart Compose. Sign-in requires a whitelisted email, `email_verified=true`, and the account's pinned Google subject.

### AWS Cognito

See [Cognito setup](docs/COGNITO.md). Configure:

```dotenv
COGNITO_ISSUER='https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_POOLID'
COGNITO_CLIENT_ID='your-app-client-id'
COGNITO_CLIENT_SECRET='your-client-secret'
```

The issuer is the **User Pool issuer**, not the managed-login domain. Add `https://drive.example.com/api/auth/callback/cognito` as a callback. Use authorization code, `openid email profile`, and a managed-login domain. Both confidential clients with a secret and public clients using PKCE are supported; public clients leave the secret empty.

OIDC state, PKCE and nonce checks are enabled. The app requires `email_verified=true`, a whitelisted email, and an identity pinned to **issuer + subject**. Cognito groups do not grant workspace roles. Cognito access tokens are **not** accepted as ErvisioDrive API tokens.

## APIs and API tokens

The versioned API is `/api/v1`. Use:

```http
Authorization: Bearer edv_<64 hexadecimal characters>
```

Create tokens in **API tokens**. Each has explicit permissions, mandatory expiry, optional file/folder restrictions, last-use metadata and immediate revocation. The secret is shown once; only its SHA-256 digest is stored. Permissions cover file metadata/download/upload/rename/move/expiry/delete/copy/text/access, folders, sharing, members, settings, storage, token management and audit.

Every request checks token validity, API switches, active owners, **current roles**, explicit scope, resource restrictions and content ACL. Even administrator-owned tokens obey their resource limits. Delegated tokens cannot outlive or exceed their ancestors; revoking a parent revokes descendants, and parent restrictions/scopes are reevaluated at use time. API callers can edit themselves or descendants, not unrelated existing tokens.

- [Detailed API guide and examples](docs/API.md)
- [Permission catalog](docs/PERMISSIONS.md)
- [OpenAPI 3.0 contract](docs/openapi.json), also served at `/api/openapi.json`
- In-app reference: **Documentation**

The API deliberately uses Bearer credentials only, with no session-cookie fallback. Browser endpoints retain CSRF/origin protection. Server-to-server clients do not need an Origin header. Cross-origin browser CORS access is not enabled.

## File and sharing behavior

Members can collaborate on files they can access. Owners and administrators manage ACL and sharing links. Folder and file ACL intersect; empty grants mean all currently whitelisted members, never anonymous public access. The UI's **All** category retains FusionHub's behavior of separating custom folders. The API's default file collection includes all accessible folders.

Direct file URLs require a browser session. API clients download through `/api/v1/files/{id}/download`. HTML, SVG and other active formats are forced to download with `nosniff`/sandbox protections. Byte ranges are supported.

Public shares are separate bearer capabilities with optional password, expiry and download count. Creating one explicitly requires `shares:create` and owner/admin rights. Their holders can download without an account, independently of file ACL. File expiry/deletion, creator removal or link revocation blocks access. Global sharing disable blocks existing links. Each successful request, including a range request, consumes one download. Passwords are submitted in a POST body, not the URL.

The editor supports up to 2 MiB of UTF-8 text. Expired files become inaccessible immediately and are physically cleaned hourly.

## Environment

| Variable | Purpose |
| --- | --- |
| `NEXTAUTH_URL` | Public base URL; use HTTPS remotely |
| `NEXTAUTH_SECRET` | Stable random session secret generated at setup |
| `BOOTSTRAP_ADMIN_EMAIL` | Initial owner email on an empty database only |
| `DRIVE_STORAGE_PATH` | Host file directory |
| `STORAGE_QUOTA_GB` | File quota in GiB, `0` = unlimited; changed through `--resize`, overridable in Settings |
| `UPLOAD_MAX_MB` | Upload size in MiB, `0` = unlimited; default 100, overridable in Settings |
| `STORAGE_ENCRYPTION_KEY` | 64 hex characters; encrypts stored files. Back it up |
| `ERVISIO_SOCKET_DIR` | Host directory for the Ervisio plugin socket; empty for a standalone install |
| `APP_PORT`, `BIND_ADDRESS` | Host port and interface; default 3000 / loopback |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional Google OAuth |
| `COGNITO_ISSUER`, `COGNITO_CLIENT_ID`, `COGNITO_CLIENT_SECRET` | Optional Cognito OIDC |
| `TRUST_PROXY` | Default false; enable only behind a proxy overwriting X-Forwarded-For |
| `MONGODB_URI`, `STORAGE_DIR` | Set by Compose; configure for non-Docker development |

Use a reverse-proxy body limit matching the upload ceiling plus multipart overhead. With `TRUST_PROXY=false`, login/password limits share a bucket rather than trusting client-supplied IP headers.

## Operations and backups

```bash
docker compose logs -f app
docker compose stop
docker compose up -d
docker compose run --rm bootstrap node scripts/ops.mjs cleanup
```

Back up **the file directory, MongoDB dump and `.env` (with `STORAGE_ENCRYPTION_KEY`) together**. Pause `app` and `cleanup` for a consistent snapshot. MongoDB uses the `ervisiodrive_mongo_data` volume.

Reconcile metadata and quota after recovery or an abnormal shutdown:

```bash
docker compose stop app cleanup
docker compose run --rm -e MAINTENANCE_CONFIRMED=true bootstrap node scripts/ops.mjs reconcile
docker compose up -d
```

Missing files are reported; orphaned files are not silently deleted.

## Development and validation

Node.js 22+, MongoDB 8:

```bash
npm ci
cp .env.example .env.local
# Configure local environment; initialize with scripts/ops.mjs bootstrap.
npm run dev
npm run typecheck
npm test
npm run test:integration
npm run build
npm run test:http
npm run docs:generate
```

Integration/HTTP tests use disposable MongoDB instances. CI additionally checks Docker startup/resize and responsive browser flows at phone, tablet and desktop widths. No production accounts or files are used. AWS authentication tests check configuration and authorization policy; a real Cognito tenant must be tested with your own credentials before enabling it for users.

## Origin

Drive UI extracted from `KFScripts/FusionHub` at `ad365d74e3e6f1c5797b289d2ee70c633bbd838c`. Authentication, authorization, APIs, private storage, quota and distribution are independent. No production secrets, cookies or unrelated portal modules were copied. Released under the [MIT license](LICENSE).

[Italian installation reference](docs/README.it.md)
