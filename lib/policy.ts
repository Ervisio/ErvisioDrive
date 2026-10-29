export type ApiRestrictions = {
  id: string;
  scopes: string[];
  resourceMode: "all" | "selected";
  fileIds: string[];
  folderSlugs: string[];
  expiresAt: string;
  ancestorIds?: string[];
  constraints?: {
    resourceMode: "all" | "selected";
    fileIds: string[];
    folderSlugs: string[];
  }[];
};
export type Actor = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  api?: ApiRestrictions;
};
export type Visibility = "private" | "members";
export type Folder = {
  slug?: string;
  allowedUsers?: string[];
  createdBy?: string;
  visibility?: Visibility;
};
export type DriveFile = {
  _id?: unknown;
  folder?: string;
  allowedUsers?: string[];
  uploadedBy?: string;
  visibility?: Visibility;
  expiresAt?: Date | null;
};
export const normalizeEmail = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";
export const validEmail = (value: string) =>
  value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export function tokenAllowsFolder(actor: Actor, slug: string) {
  return (
    !actor.api ||
    [actor.api, ...(actor.api.constraints || [])].every(
      (rule) => rule.resourceMode === "all" || rule.folderSlugs.includes(slug),
    )
  );
}
export function tokenAllowsFile(actor: Actor, file: DriveFile) {
  return (
    !actor.api ||
    [actor.api, ...(actor.api.constraints || [])].every(
      (rule) =>
        rule.resourceMode === "all" ||
        rule.fileIds.includes(String(file._id)) ||
        rule.folderSlugs.includes(file.folder || ""),
    )
  );
}
// Every member has a private space. Content is visible to its owner, to the
// people it was shared with, to everyone when its visibility is "members", and
// to administrators. Built-in categories (no folder document) are just views.
function folderAcl(actor: Actor, folder?: Folder | null) {
  return (
    actor.role === "admin" ||
    !folder ||
    folder.visibility === "members" ||
    folder.createdBy === actor.id ||
    !!folder.allowedUsers?.includes(actor.id)
  );
}
export function canReadFolder(actor: Actor, folder?: Folder | null) {
  return (
    tokenAllowsFolder(actor, folder?.slug || "") && folderAcl(actor, folder)
  );
}
export function canReadFile(
  actor: Actor,
  file: DriveFile,
  folder?: Folder | null,
) {
  if (file.expiresAt && new Date(file.expiresAt).getTime() <= Date.now())
    return false;
  if (!tokenAllowsFile(actor, file)) return false;
  if (actor.role === "admin" || file.uploadedBy === actor.id) return true;
  const shared =
    file.visibility === "members" || !!file.allowedUsers?.includes(actor.id);
  // Inside a custom folder, folder access covers its files unless a file is
  // restricted to specific people.
  if (folder)
    return folderAcl(actor, folder) && (shared || !file.allowedUsers?.length);
  return shared;
}
export function canManage(actor: Actor, owner?: string) {
  return actor.role === "admin" || actor.id === owner;
}
export function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export class InputError extends Error {}
export function safeName(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 255 ||
    /[\x00-\x1f\x7f/\\]/.test(value)
  )
    throw new InputError("Invalid name");
  return value.trim();
}
export function positiveInteger(value: unknown, max: number) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0 || n > max)
    throw new InputError("Invalid number");
  return n;
}
