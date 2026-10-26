export type Actor = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
};
export type Folder = { allowedUsers?: string[]; createdBy?: string };
export type DriveFile = {
  allowedUsers?: string[];
  uploadedBy?: string;
  expiresAt?: Date | null;
};
export function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
export function validEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
export function canReadFolder(actor: Actor, folder?: Folder | null) {
  return (
    actor.role === "admin" ||
    !folder?.allowedUsers?.length ||
    folder.createdBy === actor.id ||
    folder.allowedUsers.includes(actor.id)
  );
}
export function canReadFile(
  actor: Actor,
  file: DriveFile,
  folder?: Folder | null,
) {
  if (file.expiresAt && new Date(file.expiresAt).getTime() <= Date.now())
    return false;
  return (
    actor.role === "admin" ||
    (canReadFolder(actor, folder) &&
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
export function safeName(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 255 ||
    /[\x00-\x1f\x7f/\\]/.test(value)
  )
    throw new Error("Nome non valido");
  return value.trim();
}
export function positiveInteger(value: unknown, max: number) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0 || n > max)
    throw new Error("Numero non valido");
  return n;
}
