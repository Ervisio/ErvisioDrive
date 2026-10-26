import { withLocks } from "@/lib/locks";
import { reserveBytes, releaseBytes } from "@/lib/quota";
import { NextRequest } from "next/server";
import mongoose from "mongoose";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import FileModel from "@/models/CdnFile";
import FolderModel, { BUILTIN_FOLDER_SLUGS } from "@/models/CdnFolder";
import ShareModel from "@/models/CdnShareToken";
import Member from "@/models/Member";
import connectDB from "@/lib/db/mongoose";
import {
  type Actor,
  canReadFile,
  canReadFolder,
  canManage,
  safeName,
  escapeRegex,
  positiveInteger,
  normalizeEmail,
} from "@/lib/policy";
import {
  filePath,
  fileUrl,
  mimeToFolder,
  resolveMimeType,
  generateStoredName,
} from "@/lib/storage";
import { fail, json, readJson, rateLimit } from "@/lib/http";

const builtins = new Set<string>(BUILTIN_FOLDER_SLUGS);
export const liveFilter = () => ({
  $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
});
const id = (value: string) =>
  mongoose.isValidObjectId(value)
    ? value
    : fail(400, "Identificativo non valido");
async function folderFor(slug: string) {
  if (builtins.has(slug)) return null;
  const folder = await FolderModel.findOne({ slug }).lean<any>();
  if (!folder) fail(404, "Cartella non trovata");
  return folder;
}
export async function accessibleFile(actor: Actor, fileId: string) {
  const file = await FileModel.findById(id(fileId)).lean<any>();
  if (!file) return fail(404, "File non trovato");
  const folder = await folderFor(file.folder);
  if (!canReadFile(actor, file, folder))
    return fail(403, "Accesso al file negato o file scaduto");
  return file;
}
function requireManager(actor: Actor, owner: string) {
  if (!canManage(actor, owner))
    fail(403, "Solo il proprietario o un admin può gestire gli accessi");
}
function expiry(value: unknown) {
  if (value == null || value === "") return null;
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now())
    fail(400, "La scadenza deve essere futura");
  return date;
}
async function access(
  req: NextRequest,
  actor: Actor,
  kind: "file" | "folder",
  key: string,
) {
  const doc =
    kind === "file" ? await accessibleFile(actor, key) : await folderFor(key);
  if (!doc)
    return fail(400, "Le categorie automatiche non hanno permessi propri");
  requireManager(actor, kind === "file" ? doc.uploadedBy : doc.createdBy);
  const Model: mongoose.Model<any> = kind === "file" ? FileModel : FolderModel;
  const filter = kind === "file" ? { _id: id(key) } : { slug: key };
  if (req.method === "GET") {
    const members = await Member.find({ _id: { $in: doc.allowedUsers } }).lean<
      any[]
    >();
    return json({
      success: true,
      isPublic: !doc.allowedUsers.length,
      allowedUsers: members.map((u) => ({
        id: u._id.toString(),
        username: u.email,
        email: u.email,
      })),
    });
  }
  const body = await readJson(req);
  if (req.method === "POST") {
    const member = body.userId
      ? await Member.findById(id(body.userId))
      : await Member.findOne({
          email: normalizeEmail(body.email || body.username),
        });
    if (!member) return fail(404, "Email non presente nella whitelist");
    await Model.updateOne(filter, {
      $addToSet: { allowedUsers: member._id.toString() },
    });
  } else if (req.method === "DELETE") {
    await Model.updateOne(filter, { $pull: { allowedUsers: id(body.userId) } });
  } else return fail(405, "Metodo non consentito");
  return json({ success: true });
}

export async function driveRequest(
  req: NextRequest,
  segments: string[],
  actor: Actor,
) {
  const keys =
    segments[0] === "files" && segments[1] && req.method !== "GET"
      ? [`file:${segments[1]}`]
      : [];
  return withLocks(keys, () => dispatchDriveRequest(req, segments, actor));
}
async function dispatchDriveRequest(
  req: NextRequest,
  segments: string[],
  actor: Actor,
) {
  await connectDB();
  const method = req.method,
    [section, key, action] = segments;
  if (method !== "GET") await rateLimit(`write:${actor.id}`, 120);
  if (section === "files" && !key && method === "GET") {
    const folders = await FolderModel.find().lean<any[]>();
    const bySlug = new Map(folders.map((f) => [f.slug, f]));
    const all = await FileModel.find(liveFilter())
      .sort({ createdAt: -1 })
      .lean<any[]>();
    const visible = all.filter((f) =>
      canReadFile(actor, f, bySlug.get(f.folder)),
    );
    const folderCounts: Record<string, number> = {
      all: visible.filter((f) => builtins.has(f.folder)).length,
    };
    visible.forEach(
      (f) => (folderCounts[f.folder] = (folderCounts[f.folder] || 0) + 1),
    );
    const folder = req.nextUrl.searchParams.get("folder") || "all";
    const search = (req.nextUrl.searchParams.get("search") || "")
      .trim()
      .toLowerCase();
    const files = visible.filter(
      (f) =>
        (folder === "all" ? builtins.has(f.folder) : f.folder === folder) &&
        f.name.toLowerCase().includes(search),
    );
    return json({ success: true, data: files, folderCounts });
  }
  if (section === "folders" && !key) {
    if (method === "GET") {
      const folders = await FolderModel.find().sort({ name: 1 }).lean<any[]>();
      return json({
        success: true,
        data: folders.filter((f) => canReadFolder(actor, f)),
      });
    }
    if (method === "POST") {
      const body = await readJson(req),
        name = safeName(body.name);
      if (name.length > 80 || String(body.description || "").length > 300)
        return fail(400, "Nome o descrizione troppo lunghi");
      const base =
        name
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 60) || "cartella";
      const slug = `${base}-${crypto.randomBytes(4).toString("hex")}`;
      const folder = await FolderModel.create({
        name,
        slug,
        description: body.description || "",
        createdBy: actor.id,
      });
      return json({ success: true, data: folder }, 201);
    }
  }
  if (section === "folders" && key) {
    if (action === "access") return access(req, actor, "folder", key);
    return withLocks([`folder:${key}`], async () => {
      const folder = await folderFor(key);
      if (!folder || !canManage(actor, folder.createdBy))
        return fail(403, "Operazione non autorizzata");
      if (method === "DELETE") {
        if (await FileModel.exists({ folder: key }))
          return fail(
            409,
            "Sposta o elimina tutti i file prima di eliminare la cartella",
          );
        await FolderModel.deleteOne({ slug: key });
        return json({ success: true });
      }
      if (method === "PATCH") {
        const body = await readJson(req),
          update: Record<string, string> = {};
        if (body.name !== undefined) update.name = safeName(body.name);
        if (body.description !== undefined)
          update.description = String(body.description).slice(0, 300);
        return json({
          success: true,
          data: await FolderModel.findOneAndUpdate(
            { slug: key },
            { $set: update },
            { returnDocument: "after", runValidators: true },
          ),
        });
      }
      return fail(405, "Metodo non consentito");
    });
  }
  if (section === "upload" && method === "POST") {
    const max =
      positiveInteger(process.env.UPLOAD_MAX_MB || 100, 2048) * 1024 * 1024;
    const length = Number(req.headers.get("content-length"));
    if (!length) return fail(411, "Content-Length obbligatorio");
    if (length > max + 1024 * 1024) return fail(413, "Upload troppo grande");
    const form = await req.formData(),
      entries = form
        .getAll("files")
        .filter((v): v is File => typeof v !== "string");
    if (!entries.length || entries.length > 20)
      return fail(400, "Seleziona da 1 a 20 file");
    if (entries.reduce((n, f) => n + f.size, 0) > max)
      return fail(413, "Upload troppo grande");
    const requested = String(form.get("folder") || "all");
    return withLocks([`folder:${requested}`], async () => {
      let override: string | null = null;
      if (!builtins.has(requested) && requested !== "all") {
        const folder = await folderFor(requested);
        if (!canReadFolder(actor, folder))
          return fail(403, "Accesso alla cartella negato");
        override = requested;
      }
      const seconds = form.get("expiresIn");
      const expiresAt = seconds
        ? new Date(Date.now() + positiveInteger(seconds, 31536000) * 1000)
        : null;
      // Validate the entire batch before writing any file.
      entries.forEach((f) => safeName(f.name));
      const created: any[] = [];
      const total = entries.reduce((n, f) => n + f.size, 0);
      await reserveBytes(total);
      try {
        for (const entry of entries) {
          const mime = resolveMimeType(entry.type, entry.name),
            folder = override || mimeToFolder(mime),
            storedName = generateStoredName(entry.name);
          const location = filePath(folder, storedName),
            buffer = Buffer.from(await entry.arrayBuffer());
          await fs.mkdir(path.dirname(location), { recursive: true });
          try {
            await fs.writeFile(location, buffer, { flag: "wx" });
            const doc = await FileModel.create({
              name: entry.name,
              storedName,
              folder,
              mimeType: mime,
              size: buffer.length,
              url: fileUrl(folder, storedName),
              uploadedBy: actor.id,
              uploadedByUsername: actor.name,
              expiresAt,
            });
            created.push(doc);
          } catch (error) {
            await fs.unlink(location).catch(() => {});
            throw error;
          }
        }
      } catch (error) {
        for (const file of created) {
          await FileModel.deleteOne({ _id: file._id });
          await fs
            .unlink(filePath(file.folder, file.storedName))
            .catch(() => {});
        }
        await releaseBytes(total);
        throw error;
      }
      return json({ success: true, data: created }, 201);
    });
  }
  if (section === "share" && key && method === "DELETE") {
    const share = await ShareModel.findOne({ token: key });
    if (!share) return fail(404, "Link non trovato");
    const file = await accessibleFile(actor, share.fileId);
    requireManager(actor, file.uploadedBy);
    await share.deleteOne();
    return json({ success: true });
  }
  if (section === "files" && key) {
    if (action === "access") return access(req, actor, "file", key);
    const file = await accessibleFile(actor, key);
    if (action === "share") {
      requireManager(actor, file.uploadedBy);
      if (method === "GET")
        return json({
          success: true,
          data: await ShareModel.find({ fileId: key })
            .select("-password")
            .lean(),
        });
      if (method === "POST") {
        const body = await readJson(req);
        if (
          body.password &&
          (typeof body.password !== "string" ||
            Buffer.byteLength(body.password) > 72)
        )
          return fail(400, "Password massimo 72 byte");
        const share = await ShareModel.create({
          fileId: key,
          token: crypto.randomBytes(32).toString("hex"),
          password: body.password ? await bcrypt.hash(body.password, 12) : null,
          expiresAt: expiry(body.expiresAt),
          maxDownloads: body.maxDownloads
            ? positiveInteger(body.maxDownloads, 1000000)
            : null,
          createdBy: actor.id,
        });
        const data = share.toObject();
        delete (data as any).password;
        return json({ success: true, data }, 201);
      }
    }
    if (action === "copy" && method === "POST") {
      const storedName = generateStoredName(file.name),
        destination = filePath(file.folder, storedName);
      await reserveBytes(file.size);
      try {
        await fs.copyFile(filePath(file.folder, file.storedName), destination);
        const copy = await FileModel.create({
          name: `Copia di ${file.name}`.slice(0, 255),
          storedName,
          folder: file.folder,
          mimeType: file.mimeType,
          size: file.size,
          url: fileUrl(file.folder, storedName),
          uploadedBy: actor.id,
          uploadedByUsername: actor.name,
          expiresAt: file.expiresAt,
          allowedUsers: file.allowedUsers,
        });
        return json({ success: true, data: copy }, 201);
      } catch (error) {
        await fs.unlink(destination).catch(() => {});
        await releaseBytes(file.size);
        throw error;
      }
    }
    if (action === "content") {
      const editable =
        /\.(txt|md|markdown|json|js|jsx|ts|tsx|css|scss|html|htm|xml|csv|yml|yaml|py|sql|lua|ini|cfg|conf|log|sh|bash|bat|c|cpp|h|cs|toml|env|rb|go|rs|java|swift|kt|php|graphql|vue|svelte|r|dart|gitignore|dockerfile|makefile)$/i.test(
          file.name,
        ) ||
        file.mimeType.startsWith("text/") ||
        [
          "application/json",
          "application/javascript",
          "application/typescript",
          "application/xml",
          "application/x-sh",
        ].includes(file.mimeType);
      if (!editable)
        return fail(415, "Questo file non è modificabile come testo");
      if (file.size > 2 * 1024 * 1024)
        return fail(413, "Editor limitato a 2 MB");
      if (method === "GET")
        return json({
          success: true,
          content: await fs.readFile(
            filePath(file.folder, file.storedName),
            "utf8",
          ),
        });
      if (method === "PUT") {
        const body = await readJson(req, 12 * 1024 * 1024 + 1024);
        if (typeof body.content !== "string")
          return fail(400, "Contenuto non valido");
        if (Buffer.byteLength(body.content) > 2 * 1024 * 1024)
          return fail(413, "Editor limitato a 2 MB");
        const delta = Buffer.byteLength(body.content) - file.size;
        if (delta > 0) await reserveBytes(delta);
        const location = filePath(file.folder, file.storedName),
          temp = `${location}.${crypto.randomUUID()}.tmp`;
        try {
          await fs.writeFile(temp, body.content);
          await fs.rename(temp, location);
        } catch (error) {
          if (delta > 0) await releaseBytes(delta);
          throw error;
        } finally {
          await fs.unlink(temp).catch(() => {});
        }
        await FileModel.updateOne(
          { _id: key },
          { $set: { size: Buffer.byteLength(body.content) } },
        );
        if (delta < 0) await releaseBytes(-delta);
        return json({ success: true });
      }
    }
    if (!action && method === "PATCH") {
      const body = await readJson(req),
        update: Record<string, unknown> = {};
      if (body.name !== undefined) update.name = safeName(body.name);
      if (body.expiresAt !== undefined)
        update.expiresAt = expiry(body.expiresAt);
      if (body.folder !== undefined) {
        const destination =
          body.folder === "all"
            ? mimeToFolder(file.mimeType)
            : String(body.folder);
        return withLocks([`folder:${destination}`], async () => {
          const folder = await folderFor(destination);
          if (!canReadFolder(actor, folder))
            return fail(403, "Accesso alla cartella negato");
          if (destination !== file.folder) {
            const from = filePath(file.folder, file.storedName),
              to = filePath(destination, file.storedName);
            await fs.mkdir(path.dirname(to), { recursive: true });
            await fs.rename(from, to);
            update.folder = destination;
            update.url = fileUrl(destination, file.storedName);
            try {
              return json({
                success: true,
                data: await FileModel.findByIdAndUpdate(
                  key,
                  { $set: update },
                  { returnDocument: "after", runValidators: true },
                ),
              });
            } catch (error) {
              await fs.rename(to, from);
              throw error;
            }
          }
          return json({
            success: true,
            data: await FileModel.findByIdAndUpdate(
              key,
              { $set: update },
              { returnDocument: "after", runValidators: true },
            ),
          });
        });
      }
      return json({
        success: true,
        data: await FileModel.findByIdAndUpdate(
          key,
          { $set: update },
          { returnDocument: "after", runValidators: true },
        ),
      });
    }
    if (!action && method === "DELETE") {
      await fs.unlink(filePath(file.folder, file.storedName)).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      const removed = await FileModel.deleteOne({ _id: key });
      await ShareModel.deleteMany({ fileId: key });
      if (removed.deletedCount) await releaseBytes(file.size);
      return json({ success: true });
    }
  }
  return fail(404, "Endpoint non trovato");
}
