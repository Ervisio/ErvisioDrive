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
export type Folder = {
  slug?: string;
  allowedUsers?: string[];
  createdBy?: string;
};
export type DriveFile = {
  _id?: unknown;
  folder?: string;
  allowedUsers?: string[];
  uploadedBy?: string;
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
function folderAcl(actor: Actor, folder?: Folder | null) {
  return (
    actor.role === "admin" ||
    !folder?.allowedUsers?.length ||
    folder.createdBy === actor.id ||
    folder.allowedUsers.includes(actor.id)
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
  return (
    actor.role === "admin" ||
    (folderAcl(actor, folder) &&
      (!file.allowedUsers?.length ||
        file.uploadedBy === actor.id ||
        file.allowedUsers.includes(actor.id)))
  );
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
