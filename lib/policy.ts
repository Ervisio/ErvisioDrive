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
  /** Slugs of the containing folders, outermost first. */
  ancestors?: string[];
  /** The containing folder documents; their grants apply to this folder too. */
  inherited?: Folder[];
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
// A token limited to a folder also reaches every subfolder inside it.
export function tokenAllowsFolder(
  actor: Actor,
  slug: string,
  ancestors: string[] = [],
) {
  return (
    !actor.api ||
    [actor.api, ...(actor.api.constraints || [])].every(
      (rule) =>
        rule.resourceMode === "all" ||
        [slug, ...ancestors].some((s) => rule.folderSlugs.includes(s)),
    )
  );
}
export function tokenAllowsFile(
  actor: Actor,
  file: DriveFile,
  ancestors: string[] = [],
) {
  return (
    !actor.api ||
    [actor.api, ...(actor.api.constraints || [])].every(
      (rule) =>
        rule.resourceMode === "all" ||
        rule.fileIds.includes(String(file._id)) ||
        [file.folder || "", ...ancestors].some((s) =>
          rule.folderSlugs.includes(s),
        ),
    )
  );
}
// Every member has a private space. Content is visible to its owner, to the
// people it was shared with, to everyone when its visibility is "members", and
// to administrators. Built-in categories (no folder document) are just views.
// Access to a folder also opens every subfolder inside it.
function folderAcl(actor: Actor, folder?: Folder | null) {
  const open = (f: Folder) =>
    f.visibility === "members" ||
    f.createdBy === actor.id ||
    !!f.allowedUsers?.includes(actor.id);
  return (
    actor.role === "admin" ||
    !folder ||
    open(folder) ||
    !!folder.inherited?.some(open)
  );
}
export function canReadFolder(actor: Actor, folder?: Folder | null) {
  return (
    tokenAllowsFolder(actor, folder?.slug || "", folder?.ancestors) &&
    folderAcl(actor, folder)
  );
}
/** The owner of a folder also manages the subfolders others create inside it. */
export function canManageFolder(actor: Actor, folder: Folder) {
  return (
    canManage(actor, folder.createdBy) ||
    !!folder.inherited?.some((f) => canManage(actor, f.createdBy))
  );
}
export function canReadFile(
  actor: Actor,
  file: DriveFile,
  folder?: Folder | null,
) {
  if (file.expiresAt && new Date(file.expiresAt).getTime() <= Date.now())
    return false;
  if (!tokenAllowsFile(actor, file, folder?.ancestors)) return false;
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
