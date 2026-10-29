import FolderModel from "@/models/CdnFolder";

/** Deepest nesting accepted for custom folders. */
export const MAX_FOLDER_DEPTH = 32;

/** Attaches the containing folder documents so their grants are inherited. */
export function attachChains<T extends { slug: string; ancestors?: string[] }>(
  folders: T[],
) {
  const bySlug = new Map(folders.map((f) => [f.slug, f]));
  return folders.map((f) => ({
    ...f,
    inherited: (f.ancestors || [])
      .map((slug) => bySlug.get(slug))
      .filter((a): a is T => !!a),
  }));
}
export async function loadFolder(slug: string) {
  const folder = await FolderModel.findOne({ slug }).lean<any>();
  if (!folder) return null;
  const inherited = folder.ancestors?.length
    ? await FolderModel.find({ slug: { $in: folder.ancestors } }).lean<any[]>()
    : [];
  return { ...folder, inherited };
}
/** Strips the inherited documents before a folder is returned to a client. */
export function publicFolder({ inherited, ...folder }: any) {
  return { ...folder, parent: folder.parent ?? null, ancestors: folder.ancestors || [] };
}
/** Every folder slug in `slugs` plus all the subfolders below them. */
export function withDescendants(
  slugs: string[],
  folders: { slug: string; ancestors?: string[] }[],
) {
  const roots = new Set(slugs);
  return [
    ...roots,
    ...folders
      .filter((f) => !roots.has(f.slug) && f.ancestors?.some((a) => roots.has(a)))
      .map((f) => f.slug),
  ];
}
