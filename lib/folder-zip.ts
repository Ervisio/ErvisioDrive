import fs from "node:fs/promises";
import { Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { NextRequest, NextResponse } from "next/server";
import FolderModel from "@/models/CdnFolder";
import FileModel from "@/models/CdnFile";
import { attachChains } from "@/lib/folders";
import { canReadFile, canReadFolder, type Actor } from "@/lib/policy";
import { requirePermission } from "@/lib/permissions";
import { fail } from "@/lib/http";
import { filePath } from "@/lib/storage";
import { decryptRange, type Encryption } from "@/lib/crypto-store";

export type ZipEntry = {
  path: string;
  file?: { folder: string; storedName: string; size: number; encryption?: Encryption | null };
};

/** A safe, unique sibling name, including on case-insensitive extractors. */
export function zipName(name: string, used: Set<string>) {
  const base = name.normalize("NFC").replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, "_")
    .replace(/[. ]+$/g, "") || "unnamed";
  const safe = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base) ? `_${base}` : base;
  let result = safe, index = 1;
  while (used.has(result.toLowerCase())) {
    const dot = safe.lastIndexOf(".");
    result = dot > 0 ? `${safe.slice(0, dot)} (${index++})${safe.slice(dot)}` : `${safe} (${index++})`;
  }
  used.add(result.toLowerCase());
  return result;
}

/** Produce only one input chunk at a time; cancellation closes the current file. */
export async function* zipChunks(entries: ZipEntry[], signal?: AbortSignal) {
  signal?.throwIfAborted();
  const archive = new ZipArchive({ zlib: { level: 6 }, forceZip64: true });
  const sources = new Set<Readable>();
  const abort = () => {
    for (const source of sources) source.destroy();
    archive.abort();
    archive.destroy(new Error("Download cancelled"));
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for (const entry of entries) {
      if (!entry.file) {
        archive.append(Buffer.alloc(0), { name: entry.path, type: "directory" });
        continue;
      }
      const file = entry.file;
      // Readable.from is lazy: only the file currently being archived is opened.
      const source = Readable.from((async function* () {
        const handle = await fs.open(filePath(file.folder, file.storedName), "r");
        try {
          if (file.encryption) {
            yield* decryptRange(handle, file.encryption, file.size, 0, Math.max(0, file.size - 1));
          } else {
            yield* handle.createReadStream({ autoClose: false, highWaterMark: 64 * 1024 });
          }
        } finally {
          await handle.close();
        }
      })());
      sources.add(source);
      source.once("close", () => sources.delete(source));
      source.once("error", (error) => archive.destroy(error));
      archive.append(source, { name: entry.path });
    }
    void archive.finalize().catch((error) => archive.destroy(error));
    yield* archive;
  } finally {
    signal?.removeEventListener("abort", abort);
    for (const source of sources) source.destroy();
    archive.abort();
    archive.destroy();
  }
}

export async function folderZip(req: NextRequest, actor: Actor, slug: string) {
  requirePermission(actor, "folders:read", "files:download");
  const folders = attachChains(await FolderModel.find().lean<any[]>());
  const root = folders.find((f) => f.slug === slug);
  if (!root) return fail(404, "Folder not found");
  if (!canReadFolder(actor, root)) return fail(403, "Folder access denied");
  const included = [root, ...folders.filter((f) => f.ancestors?.includes(slug) && canReadFolder(actor, f))]
    .sort((a, b) => (a.ancestors?.length || 0) - (b.ancestors?.length || 0));
  const bySlug = new Map(included.map((f) => [f.slug, f]));
  const paths = new Map<string, string>(), siblings = new Map<string, Set<string>>();
  const names = (parent: string) => {
    if (!siblings.has(parent)) siblings.set(parent, new Set());
    return siblings.get(parent)!;
  };
  const rootName = zipName(root.name, new Set());
  const entries: ZipEntry[] = [];
  for (const folder of included) {
    const parent = folder.slug === slug ? "" : paths.get(folder.parent);
    // Never traverse a hidden intermediate directory.
    if (parent === undefined) continue;
    const name = folder.slug === slug ? rootName : zipName(folder.name, names(parent));
    const location = `${parent}${name}/`;
    paths.set(folder.slug, location);
    entries.push({ path: location });
  }
  const files = await FileModel.find({ folder: { $in: [...paths.keys()] } }).lean<any[]>();
  for (const file of files) {
    if (!canReadFile(actor, file, bySlug.get(file.folder))) continue;
    const parent = paths.get(file.folder)!;
    entries.push({ path: parent + zipName(file.name, names(parent)), file });
  }
  if (entries.some((e) => Buffer.byteLength(e.path) > 65535))
    return fail(413, "A folder ZIP path exceeds 65,535 bytes");
  const stream = Readable.from(zipChunks(entries, req.signal));
  const abort = () => stream.destroy(new Error("Download cancelled"));
  req.signal.addEventListener("abort", abort, { once: true });
  stream.once("close", () => req.signal.removeEventListener("abort", abort));
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="folder.zip"; filename*=UTF-8''${encodeURIComponent(rootName + ".zip").replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
