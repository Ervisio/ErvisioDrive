import { folderZip } from "@/lib/folder-zip";
import { editorMaxBytes, getSettings } from "@/lib/settings";
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
  tokenAllowsFolder,
  canReadFolder,
  canManage,
  canManageFolder,
  safeName,
  escapeRegex,
  positiveInteger,
  normalizeEmail,
} from "@/lib/policy";
import { formatBytes } from "@/lib/format";
import {
  filePath,
  fileUrl,
  mimeToFolder,
  generateStoredName,
} from "@/lib/storage";
import { errorResponse, fail, json, readJson, rateLimit } from "@/lib/http";
import { unzipSync } from "fflate";
import { ODT_MIME, isEditableTextFile, isOdtFile } from "@/lib/text-files";
import { readStored, rewrap, writeStored } from "@/lib/crypto-store";
import { recordEvent } from "@/lib/events";
import { receiveUpload } from "@/lib/upload";
import {
  MAX_FOLDER_DEPTH,
  attachChains,
  loadFolder,
  publicFolder,
  withDescendants,
} from "@/lib/folders";

const builtins = new Set<string>(BUILTIN_FOLDER_SLUGS);
export const liveFilter = () => ({
  $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
});
const id = (value: string) =>
  mongoose.isValidObjectId(value) ? value : fail(400, "Invalid identifier");
async function folderFor(slug: string) {
  if (builtins.has(slug)) return null;
  const folder = await loadFolder(slug);
  if (!folder) fail(404, "Folder not found");
  return folder;
}
export async function accessibleFile(actor: Actor, fileId: string) {
  const file = await FileModel.findById(id(fileId)).lean<any>();
  if (!file) return fail(404, "File not found");
  const folder = await folderFor(file.folder);
  if (!canReadFile(actor, file, folder))
    return fail(403, "File access denied or file expired");
  return file;
}
function requireManager(actor: Actor, owner: string) {
  if (!canManage(actor, owner))
    fail(403, "Only the owner or an administrator can manage access");
}
async function removeFile(req: NextRequest, actor: Actor, file: any) {
  await fs.unlink(filePath(file.folder, file.storedName)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  const removed = await FileModel.deleteOne({ _id: file._id });
  await ShareModel.deleteMany({ fileId: String(file._id) });
  if (removed.deletedCount) {
    await releaseBytes(file.size, file.uploadedBy || undefined);
    await recordEvent(req, "delete", { actor, file, bytes: file.size });
  }
}
/** Moves a stored file to another folder, on disk and in the database. */
async function relocate(file: any, destination: string) {
  const from = filePath(file.folder, file.storedName),
    to = filePath(destination, file.storedName);
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.rename(from, to).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  try {
    await FileModel.updateOne(
      { _id: file._id },
      { $set: { folder: destination, url: fileUrl(destination, file.storedName) } },
    );
  } catch (error) {
    await fs.rename(to, from).catch(() => {});
    throw error;
  }
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
    return fail(400, "Automatic categories do not have separate access rules");
  if (kind === "folder" && !canReadFolder(actor, doc))
    fail(403, "Folder access denied");
  if (kind === "folder" ? !canManageFolder(actor, doc) : !canManage(actor, doc.uploadedBy))
    fail(403, "Only the owner or an administrator can manage access");
  const Model: mongoose.Model<any> = kind === "file" ? FileModel : FolderModel;
  const filter = kind === "file" ? { _id: id(key) } : { slug: key };
  if (req.method === "GET") {
    const members = await Member.find({ _id: { $in: doc.allowedUsers } }).lean<
      any[]
    >();
    return json({
      success: true,
      visibility: doc.visibility || "private",
      isPublic: doc.visibility === "members",
      allowedUsers: members.map((u) => ({
        id: u._id.toString(),
        username: u.email,
        email: u.email,
      })),
    });
  }
  const body = await readJson(req);
  if (req.method === "PATCH") {
    if (body.visibility !== "private" && body.visibility !== "members")
      return fail(400, "Visibility must be private or members");
    await Model.updateOne(filter, { $set: { visibility: body.visibility } });
    return json({ success: true });
  }
  if (req.method === "POST") {
    const member = body.userId
      ? await Member.findById(id(body.userId))
      : await Member.findOne({
          email: normalizeEmail(body.email || body.username),
        });
    if (!member) return fail(404, "Email is not whitelisted");
    await Model.updateOne(filter, {
      $addToSet: { allowedUsers: member._id.toString() },
    });
  } else if (req.method === "DELETE") {
    await Model.updateOne(filter, { $pull: { allowedUsers: id(body.userId) } });
  } else return fail(405, "Method not allowed");
  return json({ success: true });
}

export async function driveRequest(
  req: NextRequest,
  segments: string[],
  actor: Actor,
  /** Set for the steps of a bulk request, which was rate limited once already. */
  nested = false,
) {
  const keys =
    segments[0] === "files" &&
    segments[1] &&
    segments[1] !== "bulk" &&
    req.method !== "GET"
      ? [`file:${segments[1]}`]
      : [];
  return withLocks(keys, () =>
    dispatchDriveRequest(req, segments, actor, nested),
  );
}
const BULK_LIMIT = 500;
/** Applies one delete or move to many files and reports the outcome of each. */
async function bulk(req: NextRequest, actor: Actor) {
  const body = await readJson(req),
    ids = body.ids;
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > BULK_LIMIT ||
    ids.some((value) => typeof value !== "string")
  )
    return fail(400, `Provide between 1 and ${BULK_LIMIT} file ids`);
  if (body.action !== "delete" && body.action !== "move")
    return fail(400, "Action must be delete or move");
  if (body.action === "move" && (typeof body.folder !== "string" || !body.folder))
    return fail(400, "A destination folder is required");
  const results: { id: string; status: number; error?: string }[] = [];
  for (const fileId of [...new Set<string>(ids)]) {
    const step = new NextRequest(
      new URL(`/api/admin/cdn/files/${encodeURIComponent(fileId)}`, req.url),
      body.action === "move"
        ? {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ folder: body.folder }),
          }
        : { method: "DELETE" },
    );
    let response: Response;
    try {
      response = await driveRequest(step, ["files", fileId], actor, true);
    } catch (error) {
      response = errorResponse(error);
    }
    const outcome = await response.json().catch(() => ({}));
    results.push(
      response.ok
        ? { id: fileId, status: response.status }
        : { id: fileId, status: response.status, error: outcome.error },
    );
  }
  const failed = results.filter((r) => r.status >= 400).length;
  return json({
    success: failed === 0,
    data: results,
    succeeded: results.length - failed,
    failed,
  });
}
/** Moves a folder, with all its subfolders, under another folder or to the top level. */
async function moveFolder(
  actor: Actor,
  folder: any,
  target: unknown,
  update: Record<string, string>,
) {
  const slug: string = folder.slug,
    destination =
      target === null || target === "" || target === "root" ? null : String(target);
  if (destination === slug) return fail(400, "A folder cannot be moved into itself");
  if (!destination && actor.api?.resourceMode === "selected")
    return fail(403, "Restricted tokens cannot create new top-level folders");
  return withLocks(destination ? [`folder:${destination}`] : [], async () => {
    let ancestors: string[] = [];
    if (destination) {
      const parent = builtins.has(destination) ? null : await loadFolder(destination);
      if (!parent) return fail(404, "Parent folder not found");
      if (!canReadFolder(actor, parent)) return fail(403, "Folder access denied");
      if (parent.ancestors?.includes(slug))
        return fail(400, "A folder cannot be moved into one of its subfolders");
      ancestors = [...(parent.ancestors || []), parent.slug];
    }
    const nested = await FolderModel.find({ ancestors: slug }).lean<any[]>(),
      below = (f: any) => f.ancestors.slice(f.ancestors.indexOf(slug));
    if (
      ancestors.length + Math.max(0, ...nested.map((f) => below(f).length)) >
      MAX_FOLDER_DEPTH
    )
      return fail(400, `Folders can be nested at most ${MAX_FOLDER_DEPTH} levels deep`);
    if (nested.length)
      await FolderModel.bulkWrite(
        nested.map((f) => ({
          updateOne: {
            filter: { _id: f._id },
            update: { $set: { ancestors: [...ancestors, ...below(f)] } },
          },
        })),
      );
    const moved = await FolderModel.findOneAndUpdate(
      { slug },
      { $set: { ...update, parent: destination, ancestors } },
      { returnDocument: "after", runValidators: true },
    ).lean<any>();
    return json({ success: true, data: publicFolder(moved) });
  });
}
async function dispatchDriveRequest(
  req: NextRequest,
  segments: string[],
  actor: Actor,
  nested: boolean,
) {
  await connectDB();
  const method = req.method,
    [section, key, action] = segments;
  if (method !== "GET" && !nested) {
    const { writeRequestsPerMinute } = await getSettings();
    if (writeRequestsPerMinute) await rateLimit(`write:${actor.id}`, writeRequestsPerMinute);
  }
  if (section === "files" && key === "bulk" && method === "POST")
    return bulk(req, actor);
  if (section === "files" && !key && method === "GET") {
    const folders = attachChains(await FolderModel.find().lean<any[]>());
    const visibleFilter: any = { $and: [liveFilter()] };
    // Admins may browse a member's space (?owner=<id>) or everything (?owner=all).
    const owner = req.nextUrl.searchParams.get("owner"),
      scope = req.nextUrl.searchParams.get("scope");
    if (owner && actor.role !== "admin")
      fail(403, "Only administrators can browse other members' files");
    if (owner && owner !== "all") visibleFilter.$and.push({ uploadedBy: owner });
    if (!owner) {
      // Mirrors canReadFile: inside a custom folder, folder access comes first.
      const viewer = { ...actor, api: undefined, role: "member" as const },
        readable = folders.filter((f) => canReadFolder(viewer, f)).map((f) => f.slug),
        unreadable = folders.filter((f) => !canReadFolder(viewer, f)).map((f) => f.slug);
      const sharedWithMe = {
        uploadedBy: { $ne: actor.id },
        folder: { $nin: unreadable },
        $or: [
          { visibility: "members" },
          { allowedUsers: actor.id },
          {
            folder: { $in: readable },
            $or: [{ allowedUsers: { $size: 0 } }, { allowedUsers: { $exists: false } }],
          },
        ],
      };
      visibleFilter.$and.push(
        scope === "shared"
          ? sharedWithMe
          : scope === "mine"
            ? { uploadedBy: actor.id }
            : { $or: [{ uploadedBy: actor.id }, sharedWithMe] },
      );
    }
    for (const rule of actor.api
      ? [actor.api, ...(actor.api.constraints || [])]
      : [])
      if (rule.resourceMode === "selected")
        visibleFilter.$and.push({
          $or: [
            {
              _id: {
                $in: rule.fileIds.map((id) => new mongoose.Types.ObjectId(id)),
              },
            },
            { folder: { $in: withDescendants(rule.folderSlugs, folders) } },
          ],
        });
    const counts = await FileModel.aggregate([
      { $match: visibleFilter },
      { $group: { _id: "$folder", count: { $sum: 1 } } },
    ]);
    const folderCounts: Record<string, number> = { all: 0 };
    for (const count of counts) {
      folderCounts[count._id] = count.count;
      if (builtins.has(count._id)) folderCounts.all += count.count;
    }
    const folder = req.nextUrl.searchParams.get("folder") || "all",
      search = (req.nextUrl.searchParams.get("search") || "").trim();
    if (search.length > 200) fail(400, "Search is limited to 200 characters");
    const query: any = { $and: [visibleFilter] };
    // ?recursive=true also returns the files of every subfolder.
    if (folder !== "all")
      query.$and.push({
        folder:
          req.nextUrl.searchParams.get("recursive") === "true"
            ? { $in: withDescendants([folder], folders) }
            : folder,
      });
    else if (!actor.api) query.$and.push({ folder: { $in: [...builtins] } });
    if (search)
      query.$and.push({ name: { $regex: escapeRegex(search), $options: "i" } });
    if (actor.api) {
      const limit = Number(req.nextUrl.searchParams.get("limit") || 50),
        cursor = req.nextUrl.searchParams.get("cursor");
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        (cursor && !mongoose.isValidObjectId(cursor))
      )
        fail(400, "Invalid pagination");
      if (cursor)
        query.$and.push({ _id: { $lt: new mongoose.Types.ObjectId(cursor) } });
      const page = await FileModel.find(query)
        .sort({ _id: -1 })
        .limit(limit + 1)
        .lean<any[]>();
      return json({
        success: true,
        data: page.slice(0, limit),
        folderCounts,
        pagination: {
          limit,
          nextCursor: page.length > limit ? String(page[limit - 1]._id) : null,
        },
      });
    }
    const files = await FileModel.find(query)
      .sort({ createdAt: -1 })
      .lean<any[]>();
    return json({ success: true, data: files, folderCounts });
  }
  if (section === "folders" && !key) {
    if (method === "GET") {
      const folders = attachChains(
          await FolderModel.find().sort({ name: 1 }).lean<any[]>(),
        ),
        owner = req.nextUrl.searchParams.get("owner"),
        // ?parent=root lists top-level folders, ?parent=<slug> its direct subfolders.
        parent = req.nextUrl.searchParams.get("parent");
      if (owner && actor.role !== "admin")
        fail(403, "Only administrators can browse other members' folders");
      // Admins see their own space by default, like everyone else.
      const viewer = owner ? actor : { ...actor, role: "member" as const };
      return json({
        success: true,
        data: folders
          .filter(
            (f) =>
              canReadFolder(viewer, f) &&
              (!owner || owner === "all" || f.createdBy === owner) &&
              (!parent ||
                (f.parent ?? null) === (parent === "root" ? null : parent)),
          )
          .map(publicFolder),
      });
    }
    if (method === "POST") {
      const body = await readJson(req),
        name = safeName(body.name),
        parentSlug =
          body.parent === undefined || body.parent === null || body.parent === ""
            ? null
            : String(body.parent);
      if (!parentSlug && actor.api?.resourceMode === "selected")
        fail(403, "Restricted tokens cannot create new top-level folders");
      if (name.length > 80 || String(body.description || "").length > 300)
        return fail(400, "Name or description is too long");
      const base =
        name
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 60) || "cartella";
      const slug = `${base}-${crypto.randomBytes(4).toString("hex")}`;
      const create = async (ancestors: string[]) =>
        json(
          {
            success: true,
            data: publicFolder(
              (
                await FolderModel.create({
                  name,
                  slug,
                  description: body.description || "",
                  createdBy: actor.id,
                  parent: parentSlug,
                  ancestors,
                })
              ).toObject(),
            ),
          },
          201,
        );
      if (!parentSlug) return create([]);
      // The parent stays locked so it cannot be deleted or moved meanwhile.
      return withLocks([`folder:${parentSlug}`], async () => {
        const parent = builtins.has(parentSlug) ? null : await loadFolder(parentSlug);
        if (!parent) return fail(404, "Parent folder not found");
        if (!canReadFolder(actor, parent)) return fail(403, "Folder access denied");
        const ancestors = [...(parent.ancestors || []), parent.slug];
        if (ancestors.length > MAX_FOLDER_DEPTH)
          return fail(400, `Folders can be nested at most ${MAX_FOLDER_DEPTH} levels deep`);
        return create(ancestors);
      });
    }
  }
  if (section === "folders" && key && action === "download" && method === "GET")
    return folderZip(req, actor, key);
  if (section === "folders" && key) {
    if (action === "access") return access(req, actor, "folder", key);
    return withLocks([`folder:${key}`], async () => {
      const folder = await folderFor(key);
      if (
        !folder ||
        !canReadFolder(actor, folder) ||
        !canManageFolder(actor, folder)
      )
        return fail(403, "Operation not authorized");
      if (method === "DELETE") {
        // Subfolders go with the folder. ?files=keep moves every file to its
        // default category, ?files=delete removes them all.
        const mode = req.nextUrl.searchParams.get("files"),
          subfolders = await FolderModel.find({ ancestors: key }).lean<any[]>(),
          slugs = [key, ...subfolders.map((f) => f.slug)],
          files = await FileModel.find({ folder: { $in: slugs } }).lean<any[]>();
        if (files.length && mode !== "keep" && mode !== "delete")
          return fail(
            409,
            "Move or delete all files before deleting the folder",
          );
        if (
          mode === "delete" &&
          files.some((file) => !canManage(actor, file.uploadedBy))
        )
          return fail(403, "The folder contains files of other members");
        await withLocks(
          files.map((file) => `file:${file._id}`),
          async () => {
            for (const file of files) {
              if (mode === "delete") await removeFile(req, actor, file);
              else await relocate(file, mimeToFolder(file.mimeType));
            }
          },
        );
        await FolderModel.deleteMany({ slug: { $in: slugs } });
        return json({
          success: true,
          files: files.length,
          folders: slugs.length,
        });
      }
      if (method === "PATCH") {
        const body = await readJson(req),
          update: Record<string, string> = {};
        if (body.name !== undefined) update.name = safeName(body.name);
        if (body.description !== undefined)
          update.description = String(body.description).slice(0, 300);
        if (body.parent !== undefined) return moveFolder(actor, folder, body.parent, update);
        return json({
          success: true,
          data: publicFolder(
            await FolderModel.findOneAndUpdate(
              { slug: key },
              { $set: update },
              { returnDocument: "after", runValidators: true },
            ).lean<any>(),
          ),
        });
      }
      return fail(405, "Method not allowed");
    });
  }
  if (section === "upload" && method === "POST") return receiveUpload(req, actor);
  if (section === "share" && key && method === "DELETE") {
    const share = await ShareModel.findOne({ token: key });
    if (!share) return fail(404, "Link not found");
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
        const settings = await getSettings();
        if (!settings.sharingEnabled) fail(403, "Public sharing is disabled");
        const body = await readJson(req);
        const shareExpiry = expiry(body.expiresAt);
        if (
          settings.maxShareLifetimeHours &&
          (!shareExpiry ||
            shareExpiry.getTime() >
              Date.now() + settings.maxShareLifetimeHours * 3600000)
        )
          fail(400, "A share expiry within the configured maximum is required");
        if (
          body.password !== undefined &&
          body.password !== null &&
          (typeof body.password !== "string" ||
            Buffer.byteLength(body.password) > 72)
        )
          return fail(400, "Password must not exceed 72 bytes");
        const share = await ShareModel.create({
          fileId: key,
          token: crypto.randomBytes(32).toString("hex"),
          password: body.password ? await bcrypt.hash(body.password, 12) : null,
          expiresAt: shareExpiry,
          maxDownloads:
            body.maxDownloads !== undefined && body.maxDownloads !== null
              ? positiveInteger(body.maxDownloads, Number.MAX_SAFE_INTEGER)
              : null,
          createdBy: actor.id,
        });
        const data = share.toObject();
        delete (data as any).password;
        return json({ success: true, data }, 201);
      }
    }
    if (action === "copy" && method === "POST") {
      const home = await folderFor(file.folder);
      if (!tokenAllowsFolder(actor, file.folder, home?.ancestors))
        fail(403, "Copy destination is outside this token’s resources");
      const storedName = generateStoredName(file.name),
        destination = filePath(file.folder, storedName);
      await reserveBytes(file.size, actor.id);
      try {
        await fs.copyFile(filePath(file.folder, file.storedName), destination);
        const copy = await FileModel.create({
          // The copy belongs to whoever made it, so its key is re-wrapped for them.
          encryption: file.encryption ? rewrap(file.encryption, actor.id) : null,
          name: `Copy of ${file.name}`.slice(0, 255),
          storedName,
          folder: file.folder,
          mimeType: file.mimeType,
          size: file.size,
          url: fileUrl(file.folder, storedName),
          uploadedBy: actor.id,
          uploadedByUsername: actor.name,
          expiresAt: file.expiresAt,
        });
        return json({ success: true, data: copy }, 201);
      } catch (error) {
        await fs.unlink(destination).catch(() => {});
        await releaseBytes(file.size, actor.id);
        throw error;
      }
    }
    if (action === "content") {
      if (!isEditableTextFile(file.name, file.mimeType))
        return fail(415, "This file cannot be edited as text");
      // OpenDocument files travel as base64 and are converted in the browser.
      const odt = isOdtFile(file.name, file.mimeType),
        limit = await editorMaxBytes(),
        tooLarge = `The editor is limited to ${formatBytes(limit)}`;
      if (file.size > limit) return fail(413, tooLarge);
      const location = filePath(file.folder, file.storedName);
      if (method === "GET") {
        const data = await readStored(location, file);
        await recordEvent(req, "view", { actor, file, bytes: data.length });
        return json({
          success: true,
          encoding: odt ? "base64" : "utf8",
          content: data.toString(odt ? "base64" : "utf8"),
        });
      }
      if (method === "PUT") {
        // base64 and JSON escaping can grow the payload well beyond the file.
        const body = await readJson(req, Number.isFinite(limit) ? limit * 7 + 1024 : Infinity);
        if (typeof body.content !== "string")
          return fail(400, "Invalid content");
        let data: Buffer;
        if (odt) {
          if (body.encoding !== "base64") return fail(400, "Invalid content");
          data = Buffer.from(body.content, "base64");
          if (data.length > limit) return fail(413, tooLarge);
          try {
            const entries = unzipSync(data, {
              filter: (entry) => entry.name === "mimetype" || entry.name === "content.xml",
            });
            if (
              Buffer.from(entries.mimetype ?? []).toString() !== ODT_MIME ||
              !entries["content.xml"]
            )
              return fail(400, "Invalid OpenDocument file");
          } catch {
            return fail(400, "Invalid OpenDocument file");
          }
        } else {
          data = Buffer.from(body.content, "utf8");
          if (data.length > limit) return fail(413, tooLarge);
        }
        const owner = file.uploadedBy || undefined,
          delta = data.length - file.size;
        if (delta > 0) await reserveBytes(delta, owner);
        const temp = `${location}.${crypto.randomUUID()}.tmp`;
        let encryption;
        try {
          encryption = await writeStored(temp, data, file.uploadedBy || actor.id, "wx");
          await fs.rename(temp, location);
        } catch (error) {
          if (delta > 0) await releaseBytes(delta, owner);
          throw error;
        } finally {
          await fs.unlink(temp).catch(() => {});
        }
        await FileModel.updateOne(
          { _id: key },
          { $set: { size: data.length, encryption } },
        );
        if (delta < 0) await releaseBytes(-delta, owner);
        await recordEvent(req, "edit", { actor, file, bytes: data.length });
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
          if (
            !canReadFolder(actor, folder || { slug: destination })
          )
            return fail(403, "Folder access denied");
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
      await removeFile(req, actor, file);
      return json({ success: true });
    }
  }
  return fail(404, "Endpoint not found");
}
