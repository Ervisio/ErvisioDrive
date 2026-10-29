// Streaming multipart upload. Files are never held in memory: each part is
// encrypted (when a key is configured) straight into a temporary file, and
// moved to its folder once the whole request has been received, because form
// fields such as "folder" may arrive after the files.
import Busboy from "busboy";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { NextRequest } from "next/server";
import FileModel from "@/models/CdnFile";
import FolderModel, { BUILTIN_FOLDER_SLUGS } from "@/models/CdnFolder";
import {
  CountStream,
  EncryptStream,
  LimitError,
  encryptionEnabled,
  newEncryption,
  type Encryption,
} from "@/lib/crypto-store";
import { recordEvent } from "@/lib/events";
import { fail, json } from "@/lib/http";
import { withLocks } from "@/lib/locks";
import {
  type Actor,
  canReadFolder,
  positiveInteger,
  safeName,
  tokenAllowsFolder,
} from "@/lib/policy";
import { releaseBytes, reserveBytes } from "@/lib/quota";
import { getSettings, uploadMaxBytes } from "@/lib/settings";
import {
  filePath,
  fileUrl,
  generateStoredName,
  mimeToFolder,
  resolveMimeType,
  storageRoot,
} from "@/lib/storage";

const builtins = new Set<string>(BUILTIN_FOLDER_SLUGS);
const incoming = (storedName: string) =>
  path.join(storageRoot(), ".incoming", storedName);

interface Received {
  name: string;
  mime: string;
  storedName: string;
  size: number;
  encryption: Encryption | null;
}

export async function receiveUpload(req: NextRequest, actor: Actor) {
  const settings = await getSettings(),
    maxFile = await uploadMaxBytes(),
    maxFiles = settings.maxFilesPerUpload || Infinity;
  const length = Number(req.headers.get("content-length"));
  if (!length) return fail(411, "Content-Length is required");
  if (Number.isFinite(maxFile * maxFiles) && length > maxFile * maxFiles + 1024 * 1024)
    return fail(413, "Upload is too large");
  if (!req.body || !/^multipart\/form-data/i.test(req.headers.get("content-type") || ""))
    return fail(400, "Send the files as multipart/form-data");

  // The request size is an upper bound of what will be stored.
  await reserveBytes(length, actor.id);
  const received: Received[] = [],
    fields: Record<string, string> = {
      folder: req.nextUrl.searchParams.get("folder") || "",
      expiresIn: req.nextUrl.searchParams.get("expiresIn") || "",
    };
  let stored = 0;
  const cleanup = () =>
    Promise.all(received.map((file) => fs.unlink(incoming(file.storedName)).catch(() => {})));
  try {
    await fs.mkdir(path.join(storageRoot(), ".incoming"), { recursive: true });
    await new Promise<void>((resolve, reject) => {
      const parser = Busboy({
        headers: Object.fromEntries(req.headers),
        limits: {
          files: Number.isFinite(maxFiles) ? maxFiles : undefined,
          fields: 20,
          fieldSize: 1024,
        },
      });
      const writes: Promise<void>[] = [];
      let failure: unknown = null;
      const abort = (error: unknown) => {
        failure ??= error;
      };
      parser.on("field", (name, value) => {
        if (name === "folder" || name === "expiresIn") fields[name] = value;
      });
      parser.on("filesLimit", () => abort(new LimitError()));
      parser.on("file", (name, stream, info) => {
        if (name !== "files" || failure) {
          stream.resume();
          return;
        }
        let fileName: string;
        try {
          fileName = safeName(info.filename);
        } catch (error) {
          abort(error);
          stream.resume();
          return;
        }
        const file: Received = {
          name: fileName,
          mime: resolveMimeType(info.mimeType, fileName),
          storedName: generateStoredName(fileName),
          size: 0,
          encryption: null,
        };
        received.push(file);
        let transform: EncryptStream | CountStream;
        if (encryptionEnabled()) {
          const key = newEncryption(actor.id);
          file.encryption = key.meta;
          transform = new EncryptStream(key.dek, key.meta, maxFile);
        } else transform = new CountStream(maxFile);
        writes.push(
          pipeline(stream, transform, createWriteStream(incoming(file.storedName), { flags: "wx" }))
            .then(() => {
              file.size = transform.bytes;
            })
            .catch((error) => {
              abort(error);
              stream.resume();
            }),
        );
      });
      parser.on("error", reject);
      parser.on("close", () =>
        Promise.all(writes).then(() => (failure ? reject(failure) : resolve()), reject),
      );
      Readable.fromWeb(req.body as never).on("error", reject).pipe(parser);
    });
    if (!received.length) fail(400, "Select at least one file");

    const requested = fields.folder || "all";
    const expiresAt = fields.expiresIn
      ? new Date(Date.now() + positiveInteger(fields.expiresIn, Number.MAX_SAFE_INTEGER / 1000) * 1000)
      : null;
    return await withLocks([`folder:${requested}`], async () => {
      let override: string | null = null;
      if (!builtins.has(requested) && requested !== "all") {
        const folder = await FolderModel.findOne({ slug: requested }).lean<any>();
        if (!folder) return fail(404, "Folder not found");
        if (!canReadFolder(actor, folder)) return fail(403, "Folder access denied");
        override = requested;
      }
      for (const file of received)
        if (!tokenAllowsFolder(actor, override || mimeToFolder(file.mime)))
          fail(403, "Upload destination is outside this token’s resources");
      const created: any[] = [];
      try {
        for (const file of received) {
          const folder = override || mimeToFolder(file.mime),
            location = filePath(folder, file.storedName);
          await fs.mkdir(path.dirname(location), { recursive: true });
          await fs.rename(incoming(file.storedName), location);
          created.push(
            await FileModel.create({
              name: file.name,
              storedName: file.storedName,
              folder,
              mimeType: file.mime,
              size: file.size,
              url: fileUrl(folder, file.storedName),
              uploadedBy: actor.id,
              uploadedByUsername: actor.name,
              expiresAt,
              encryption: file.encryption,
            }),
          );
          stored += file.size;
        }
      } catch (error) {
        for (const doc of created) {
          await FileModel.deleteOne({ _id: doc._id });
          await fs.unlink(filePath(doc.folder, doc.storedName)).catch(() => {});
        }
        stored = 0;
        throw error;
      }
      for (const doc of created)
        await recordEvent(req, "upload", { actor, file: doc, bytes: doc.size });
      return json({ success: true, data: created }, 201);
    });
  } catch (error) {
    await cleanup();
    if (error instanceof LimitError) return fail(413, "Upload is too large");
    throw error;
  } finally {
    await releaseBytes(length - stored, actor.id);
  }
}
