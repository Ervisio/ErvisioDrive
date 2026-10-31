# ErvisioDrive API v1

Base path: `/api/v1`. Full schemas, operation parameters and response codes: [OpenAPI contract](openapi.json), also downloadable from `/api/openapi.json` and the in-app Documentation page. [Every permission is listed here](PERMISSIONS.md).

## Authentication

Create an API token in the browser's **API tokens** section. Copy the secret immediately; it is returned once. Assign a descriptive name, minimal scopes, expiry and optional resource restrictions. The server stores only its SHA-256 digest and a masked identifier.

```bash
export BASE='https://drive.example.com'
read -rs ERVISIO_TOKEN
export ERVISIO_TOKEN
curl "$BASE/api/v1/me" -H "Authorization: Bearer $ERVISIO_TOKEN"
```

Use `Authorization: Bearer edv_<64 lowercase hexadecimal characters>`. Never put tokens in query strings. Requests do not accept browser cookies or AWS/Google JWTs in place of these credentials. Browser administration routes intentionally remain session-only and retain CSRF/origin checks.

This API targets server-to-server clients. It does not enable permissive cross-origin browser CORS. A server client does not need an Origin header. Use HTTPS outside localhost.

## Permission model

A request is allowed only when **every applicable check succeeds**:

1. The API is enabled; the token is valid, unexpired and unrevoked.
2. Its owner and all delegated ancestors' owners still exist in the whitelist.
3. The token has the exact operation scope; its owner's current role allows that scope. No implicit wildcards are accepted.
4. Every ancestor's current scopes, roles and resource bounds still allow the operation.
5. The target matches the token's resource restrictions.
6. The owner's current file/folder ACL allows access. ACL/share changes additionally require content ownership or administrator rights.

`admin` is not a token wildcard: a token owned by an administrator is still limited by its scopes and resource envelope. Member tokens cannot get account/settings/audit/other-owner token administration permissions.

### Resource envelope

`resourceMode: "all"` means all resources **currently accessible to the owner**. It does not bypass ACL.

`resourceMode: "selected"` requires nonempty `fileIds` and/or `folderSlugs`. Within one envelope, a file is allowed if its ID is selected **or** its current folder is selected. Across a delegation chain, every envelope must allow it.

- A selected folder includes its current and future files.
- File-only tokens can read/rename/delete a selected file according to scope, but cannot upload or copy/move into unselected folders.
- Folder lists and file counts are filtered too; access is checked before serialization.
- Built-in folder slugs: `images`, `videos`, `audio`, `documents`, `other`.
- Custom slugs come from the folder response. A selected folder also covers every subfolder inside it, including subfolders created later.
- Restricted tokens cannot create top-level folders or move a folder to the top level, since the result would leave their envelope. They can create and move folders inside one they allow.
- Resource bounds constrain content operations. Explicit workspace administration scopes still govern workspace settings, members and audit independently.

### Delegation and management

Creating a token requires `tokens:create`. Every assigned scope must be delegable by the caller and valid for the target owner's current role. Another owner requires `tokens:manage:any` as well. A delegated token's default expiry is clamped to its parent's expiry; an explicitly longer expiry is rejected. Maximum delegation depth is five ancestors.

Parent revocation cascades to descendants. Parent scope/resource changes and owner role changes are checked again on every request. API callers may edit their own token or descendants only; they cannot use a short-lived restricted token to rewrite unrelated long-lived tokens. Browser administrators can deliberately manage other accounts' tokens.

`members:create` alone can whitelist ordinary members **without issuing an invitation**. To create an administrator, also grant `members:role`. To issue an invitation, pass `issueInvitation:true` and grant `members:invite`. Reset invitations are credentials; handle returned invitation URLs privately.

## Response and errors

```json
{"success":true,"data":{"id":"..."}}
```

```json
{"success":false,"error":"Missing permission: files:delete"}
```

Binary downloads return file bytes instead of JSON. Text-content reads use `{success:true,content:"..."}`. ACL reads return `allowedUsers` and the legacy `isPublic` property: true means all **whitelisted members**, not anonymous public access. Operations with no representation return `{success:true}`.

Error messages are canonical English for integrations. UI messages are localized independently. `X-Request-Id` correlates requests with audit entries. Audit records contain action, actor, token ID, redacted target, status and timestamp, never Bearer secrets or bodies.

| Status | Meaning |
| --- | --- |
| 400 | Invalid body, ID, resource envelope, scope or pagination |
| 401 | Missing, invalid, expired or revoked token/ancestor; WWW-Authenticate: Bearer |
| 403 | Scope, current role, envelope, ownership or ACL denies access |
| 404 | Operation or resource not found |
| 409 | File busy, folder holds files and no `files` choice was given, protected owner or conflicting data |
| 411 | Multipart upload missing Content-Length |
| 413 | Body/file/editor limit or file quota exceeded |
| 415 | File cannot be edited as text |
| 416 | Invalid byte range |
| 429 | Token rate limit; Retry-After header indicates when to retry |
| 500 | Internal failure |
| 503 | API disabled or service unavailable |

Settings control requests/minute/token. File mutations also share a per-owner write limit. Retry rate limits after the header's delay; retry 409 file-busy conflicts with bounded backoff. POST upload/copy/share/token creation has **no idempotency-key guarantee**: do not automatically retry an ambiguous successful POST, as it could create duplicates.

## Pagination

`GET /files`, `/folders`, `/members`, `/tokens`, `/audit` accept `limit` (1–100, default 50) and an optional 24-hex `cursor`. Results are ordered by descending object ID.

```bash
curl "$BASE/api/v1/files?limit=25" -H "Authorization: Bearer $ERVISIO_TOKEN"
```

```json
{"success":true,"data":[],"pagination":{"limit":25,"nextCursor":null}}
```

Pass `pagination.nextCursor` to the next request until null. Collections are live rather than snapshot-isolated. New records inserted while paging may appear on a fresh first page.

The file collection defaults to all accessible custom and built-in folders. `folder=documents` or a custom slug restricts it. `recursive=true` together with `folder` also includes every subfolder. `search` is a literal, case-insensitive name substring up to 200 characters. This differs intentionally from the browser UI's original **All** category, which separates custom folders.

## Upload and download

```bash
curl -X POST "$BASE/api/v1/files/upload" \
  -H "Authorization: Bearer $ERVISIO_TOKEN" \
  -F 'folder=documents' -F 'files=@report.pdf' -F 'files=@notes.txt'
```

Required permission: `files:upload`. Up to 20 files/request; their total encoded contents must fit the effective upload limit (default 100 MiB). `Content-Length` is required, so use clients that send a known multipart length. `expiresIn` optionally sets file expiry in seconds (1–31,536,000).

A custom destination slug overrides MIME routing. Built-in/all destinations use MIME routing; token restrictions must permit **every resulting destination**. Entire batches are validated before writing. Physical disk and application quota limits still apply.

```bash
curl "$BASE/api/v1/files/FILE_ID/download" \
  -H "Authorization: Bearer $ERVISIO_TOKEN" --output report.pdf

curl "$BASE/api/v1/files/FILE_ID/download" \
  -H "Authorization: Bearer $ERVISIO_TOKEN" -H 'Range: bytes=0-1023' --output first-kib.bin
```

Required permission: `files:download`. A valid range returns 206 and Content-Range. Invalid ranges return 416. The metadata's `url` is a **browser-session URL**; API clients should use the download operation above.

## Rename, move, expiry, text

Each change has a separate endpoint/scope. Each body must contain exactly the relevant field, so rename permission cannot also change a folder or expiry.

```bash
curl -X PATCH "$BASE/api/v1/files/FILE_ID/name" \
  -H "Authorization: Bearer $ERVISIO_TOKEN" -H 'Content-Type: application/json' \
  --data '{"name":"report-final.pdf"}'

curl -X PATCH "$BASE/api/v1/files/FILE_ID/folder" \
  -H "Authorization: Bearer $ERVISIO_TOKEN" -H 'Content-Type: application/json' \
  --data '{"folder":"project-assets-a1b2c3d4"}'

curl -X PATCH "$BASE/api/v1/files/FILE_ID/expiry" \
  -H "Authorization: Bearer $ERVISIO_TOKEN" -H 'Content-Type: application/json' \
  --data '{"expiresAt":null}'
```

`GET /files/{id}/content` requires `files:content:read`; `PUT` requires `files:content:write` and `{content:"UTF-8 text"}`. Maximum content size is 2 MiB after UTF-8 encoding. Quota growth is reserved before writes. Content writes are serialized per file; there is no ETag/version precondition in this version.

## Subfolders

Folders nest up to 32 levels. Each folder carries `parent` (the containing slug, or `null`) and `ancestors` (every containing slug, outermost first). Access granted on a folder opens all of its subfolders, and the owner of a folder also manages the subfolders others create inside it.

```bash
# Create a subfolder
curl -X POST "$BASE/api/v1/folders" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' --data '{"name":"Contracts","parent":"clients-a1b2c3d4"}'
# List the direct subfolders of a folder (parent=root lists the top level)
curl "$BASE/api/v1/folders?parent=clients-a1b2c3d4" -H "Authorization: Bearer $TOKEN"
# Move a folder, with everything inside it, to the top level
curl -X PATCH "$BASE/api/v1/folders/contracts-e5f6a7b8" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' --data '{"parent":null}'
# Delete a folder, its subfolders and every file inside them
curl -X DELETE "$BASE/api/v1/folders/clients-a1b2c3d4?files=delete" -H "Authorization: Bearer $TOKEN"
```

A folder cannot move into itself or one of its subfolders (400). Deleting a folder that holds files, directly or in a subfolder, needs `files=keep` (files go back to their automatic category) or `files=delete`.

## Bulk file actions

`POST /files/bulk-delete` (`files:delete`) takes `{"ids":[...]}`; `POST /files/bulk-move` (`files:move`) takes `{"ids":[...],"folder":"slug"}`. Up to 500 IDs per call. Each file is checked exactly like its single-file endpoint and one failure does not stop the others. The response lists every outcome:

```json
{ "success": false, "succeeded": 41, "failed": 1,
  "data": [{ "id": "…", "status": 200 }, { "id": "…", "status": 403, "error": "File access denied or file expired" }] }
```

## Access and sharing

```bash
curl -X POST "$BASE/api/v1/files/FILE_ID/access" \
  -H "Authorization: Bearer $ERVISIO_TOKEN" -H 'Content-Type: application/json' \
  --data '{"email":"member@example.com"}'

curl -X POST "$BASE/api/v1/files/FILE_ID/shares" \
  -H "Authorization: Bearer $ERVISIO_TOKEN" -H 'Content-Type: application/json' \
  --data '{"password":"private-download","maxDownloads":5,"expiresAt":"2030-01-01T12:00:00Z"}'
```

The file owner or administrator must perform grant/share changes, with the relevant scope. Folder and file ACL intersect. Removing the last explicit grant restores workspace-wide access to whitelisted users, matching the original drive model.

A share response contains a secret `token` for `/api/download/{token}`. That public capability is separate from the API and can be used without login. Passwords are bcrypt-hashed; password submission uses a POST form, never a query parameter. Global share-lifetime limits can require a shorter expiry than the example. Every successful request, including partial requests, consumes a download atomically. API/share secrets must be handled privately.

Revoke a public link with `DELETE /shares/{token}` (`shares:revoke`). Revocation, expiry, file deletion/expiry or creator removal blocks it. Disabling public sharing also blocks existing links.

## Token example

```bash
curl -X POST "$BASE/api/v1/tokens" \
  -H "Authorization: Bearer $ERVISIO_TOKEN" -H 'Content-Type: application/json' \
  --data '{"name":"Backup reader","scopes":["files:list","files:read","files:download"],"resourceMode":"selected","folderSlugs":["documents"]}'
```

The response's `secret` appears only at creation. `GET /tokens` returns metadata only. Revoke with `DELETE /tokens/{id}`. To change scopes or resources, `PATCH /tokens/{id}` with the fields in the OpenAPI schema. Token identity, ownership and expiry are immutable; create a replacement to change expiry. Existing token lifetimes do not change retroactively when the maximum setting is reduced.

## JavaScript client

```js
const base = process.env.ERVISIO_URL;
const headers = {Authorization: `Bearer ${process.env.ERVISIO_TOKEN}`};
let cursor;
do {
  const url = new URL('/api/v1/files', base);
  url.searchParams.set('limit', '100');
  if (cursor) url.searchParams.set('cursor', cursor);
  const response = await fetch(url, {headers});
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${body.error}`);
  for (const file of body.data) console.log(file._id, file.name);
  cursor = body.pagination.nextCursor;
} while (cursor);
```

## Python client

```python
import os, requests
base = os.environ['ERVISIO_URL'].rstrip('/')
headers = {'Authorization': 'Bearer ' + os.environ['ERVISIO_TOKEN']}
response = requests.get(base + '/api/v1/files', headers=headers,
                        params={'limit': 25}, timeout=30)
response.raise_for_status()
print(response.json()['data'])
```

## Contract maintenance

The operation registry drives routing metadata, permission documentation and OpenAPI generation. Run `npm run docs:generate` after contract changes. Tests validate the OpenAPI document, compare it to the checked-in contract, and exercise scope denials, resource bounds, delegation, role changes, expiry, revocation and Cognito claims against a disposable database.

### Folder ZIP downloads

`GET /api/v1/folders/{slug}/download` requires both `files:download` and `folders:read`. It streams an `application/zip` attachment containing the named folder, readable descendants and empty folders. Expired files and files outside the caller’s ACL or token restrictions are excluded. Stored encrypted files are decrypted during download. Duplicate or unsafe names are made safe and unique in the archive. The session UI exposes the same operation as **Download ZIP** in folder menus.

Archives use ZIP64, supporting large files and more than 65,535 entries. Byte ranges are not supported for generated archives. Downloads stream with bounded file buffers, without staging a ZIP on disk.
