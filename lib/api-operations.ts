import type { Permission } from "@/lib/permissions";
export type ApiOperation = {
  method: string;
  path: string;
  scope: Permission | null;
  summary: string;
  handler: string;
  body?: string;
  binary?: boolean;
};
export const API_OPERATIONS: ApiOperation[] = [
  {
    method: "GET",
    path: "/me",
    scope: null,
    summary: "Inspect the current principal and token",
    handler: "me",
  },
  {
    method: "GET",
    path: "/files",
    scope: "files:list",
    summary: "List accessible files with cursor pagination",
    handler: "files",
  },
  {
    method: "POST",
    path: "/files/upload",
    scope: "files:upload",
    summary: "Upload files (multipart/form-data)",
    handler: "upload",
    body: "upload",
  },
  {
    method: "POST",
    path: "/files/bulk-delete",
    scope: "files:delete",
    summary: "Permanently delete up to 500 files; reports each outcome",
    handler: "bulk",
    body: "bulkDelete",
  },
  {
    method: "POST",
    path: "/files/bulk-move",
    scope: "files:move",
    summary: "Move up to 500 files to one destination; reports each outcome",
    handler: "bulk",
    body: "bulkMove",
  },
  {
    method: "GET",
    path: "/files/{id}",
    scope: "files:read",
    summary: "Read file metadata",
    handler: "file",
  },
  {
    method: "GET",
    path: "/files/{id}/download",
    scope: "files:download",
    summary: "Download a file; supports byte ranges",
    handler: "download",
    binary: true,
  },
  {
    method: "PATCH",
    path: "/files/{id}/name",
    scope: "files:rename",
    summary: "Rename a file",
    handler: "rename",
    body: "rename",
  },
  {
    method: "PATCH",
    path: "/files/{id}/folder",
    scope: "files:move",
    summary: "Move a file to an allowed destination",
    handler: "move",
    body: "move",
  },
  {
    method: "PATCH",
    path: "/files/{id}/expiry",
    scope: "files:expiry",
    summary: "Set or clear file expiration",
    handler: "expiry",
    body: "expiry",
  },
  {
    method: "DELETE",
    path: "/files/{id}",
    scope: "files:delete",
    summary: "Permanently delete a file and its links",
    handler: "files",
  },
  {
    method: "POST",
    path: "/files/{id}/copy",
    scope: "files:copy",
    summary: "Duplicate a file in its folder",
    handler: "files",
  },
  {
    method: "GET",
    path: "/files/{id}/content",
    scope: "files:content:read",
    summary: "Read editable text content",
    handler: "files",
  },
  {
    method: "PUT",
    path: "/files/{id}/content",
    scope: "files:content:write",
    summary: "Replace text content (maximum 2 MiB)",
    handler: "files",
    body: "content",
  },
  {
    method: "GET",
    path: "/files/{id}/access",
    scope: "files:access:read",
    summary: "Read explicit file access grants",
    handler: "files",
  },
  {
    method: "POST",
    path: "/files/{id}/access",
    scope: "files:access:write",
    summary: "Grant file access to a whitelisted account",
    handler: "files",
    body: "grant",
  },
  {
    method: "DELETE",
    path: "/files/{id}/access",
    scope: "files:access:write",
    summary: "Remove an explicit file grant",
    handler: "files",
    body: "revokeGrant",
  },
  {
    method: "GET",
    path: "/files/{id}/shares",
    scope: "shares:list",
    summary: "List download links for a file",
    handler: "shares",
  },
  {
    method: "POST",
    path: "/files/{id}/shares",
    scope: "shares:create",
    summary: "Create a public download capability",
    handler: "shares",
    body: "share",
  },
  {
    method: "DELETE",
    path: "/shares/{token}",
    scope: "shares:revoke",
    summary: "Revoke a download capability",
    handler: "share",
  },
  {
    method: "GET",
    path: "/folders",
    scope: "folders:list",
    summary: "List accessible custom folders",
    handler: "folders",
  },
  {
    method: "POST",
    path: "/folders",
    scope: "folders:create",
    summary: "Create a custom folder, optionally inside another (parent)",
    handler: "folders",
    body: "folder",
  },
  {
    method: "GET",
    path: "/folders/{slug}",
    scope: "folders:read",
    summary: "Read folder metadata",
    handler: "folder",
  },
  {
    method: "GET",
    path: "/folders/{slug}/download",
    scope: "files:download",
    summary: "Download a folder and its readable descendants as ZIP (also requires folders:read)",
    handler: "folders",
    binary: true,
  },
  {
    method: "PATCH",
    path: "/folders/{slug}",
    scope: "folders:update",
    summary: "Rename, describe or move a folder (parent) with its subfolders",
    handler: "folders",
    body: "folderUpdate",
  },
  {
    method: "DELETE",
    path: "/folders/{slug}",
    scope: "folders:delete",
    summary: "Delete a folder and its subfolders; ?files=keep|delete for content",
    handler: "folders",
  },
  {
    method: "GET",
    path: "/folders/{slug}/access",
    scope: "folders:access:read",
    summary: "Read explicit folder grants",
    handler: "folders",
  },
  {
    method: "POST",
    path: "/folders/{slug}/access",
    scope: "folders:access:write",
    summary: "Grant folder access",
    handler: "folders",
    body: "grant",
  },
  {
    method: "DELETE",
    path: "/folders/{slug}/access",
    scope: "folders:access:write",
    summary: "Remove a folder grant",
    handler: "folders",
    body: "revokeGrant",
  },
  {
    method: "GET",
    path: "/storage",
    scope: "storage:read",
    summary: "Read file storage usage and quota",
    handler: "storage",
  },
  {
    method: "GET",
    path: "/members",
    scope: "members:list",
    summary: "List whitelist accounts (administrator)",
    handler: "members",
  },
  {
    method: "POST",
    path: "/members",
    scope: "members:create",
    summary: "Whitelist an account (optional invitation)",
    handler: "members",
    body: "member",
  },
  {
    method: "PATCH",
    path: "/members/{id}/role",
    scope: "members:role",
    summary: "Change a member role",
    handler: "memberRole",
    body: "role",
  },
  {
    method: "POST",
    path: "/members/{id}/invitation",
    scope: "members:invite",
    summary: "Issue a new one-time activation/reset invitation",
    handler: "memberInvite",
  },
  {
    method: "DELETE",
    path: "/members/{id}",
    scope: "members:revoke",
    summary: "Remove whitelist access and invalidate sessions/tokens",
    handler: "memberDelete",
  },
  {
    method: "GET",
    path: "/settings",
    scope: "settings:read",
    summary: "Read settings and non-secret provider configuration",
    handler: "settings",
  },
  {
    method: "PATCH",
    path: "/settings",
    scope: "settings:write",
    summary: "Update validated workspace settings",
    handler: "settings",
    body: "settings",
  },
  {
    method: "GET",
    path: "/tokens",
    scope: "tokens:list",
    summary: "List own token metadata (never secrets)",
    handler: "tokens",
  },
  {
    method: "POST",
    path: "/tokens",
    scope: "tokens:create",
    summary: "Issue a bounded API token; secret returned once",
    handler: "tokens",
    body: "tokenCreate",
  },
  {
    method: "PATCH",
    path: "/tokens/{id}",
    scope: "tokens:update",
    summary: "Update token permissions and resource restrictions",
    handler: "tokenUpdate",
    body: "tokenUpdate",
  },
  {
    method: "DELETE",
    path: "/tokens/{id}",
    scope: "tokens:revoke",
    summary: "Immediately revoke an API token",
    handler: "tokenDelete",
  },
  {
    method: "GET",
    path: "/permissions",
    scope: null,
    summary: "List permissions the current principal can delegate",
    handler: "permissions",
  },
  {
    method: "GET",
    path: "/audit",
    scope: "audit:read",
    summary: "Read paginated API security events",
    handler: "audit",
  },
];
export function matchOperation(method: string, parts: string[]) {
  for (const operation of API_OPERATIONS) {
    if (operation.method !== method) continue;
    const pattern = operation.path.split("/").filter(Boolean);
    if (pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let match = true;
    pattern.forEach((part, i) => {
      if (part.startsWith("{")) params[part.slice(1, -1)] = parts[i];
      else if (part !== parts[i]) match = false;
    });
    if (match) return { operation, params };
  }
  return null;
}
