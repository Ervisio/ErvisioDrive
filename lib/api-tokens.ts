import crypto from "node:crypto";
import mongoose from "mongoose";
import { NextRequest } from "next/server";
import ApiToken from "@/models/ApiToken";
import Member from "@/models/Member";
import {
  type Actor,
  canReadFile,
  canReadFolder,
  tokenAllowsFile,
  tokenAllowsFolder,
} from "@/lib/policy";
import {
  allowedPermissions,
  parsePermissions,
  requirePermission,
} from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import connectDB from "@/lib/db/mongoose";
import { fail, json, readJson, rateLimit } from "@/lib/http";
import { accessibleFile } from "@/lib/drive";
import FolderModel, { BUILTIN_FOLDER_SLUGS } from "@/models/CdnFolder";
import { recordAudit } from "@/lib/audit";
const adminPrincipal = (member: any): Actor => ({
  id: String(member._id),
  email: member.email,
  name: member.name || member.email,
  role: member.role,
});
export const tokenHash = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");
export async function authenticateApiToken(req: NextRequest): Promise<Actor> {
  const authorization = req.headers.get("authorization") || "";
  if (
    !/^Bearer /i.test(authorization) ||
    !/^edv_[a-f0-9]{64}$/.test(authorization.slice(7))
  )
    return fail(401, "A valid Bearer API token is required");
  await connectDB();
  const token = await ApiToken.findOne({
    secretHash: tokenHash(authorization.slice(7)),
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  }).lean<any>();
  if (!token) return fail(401, "API token is invalid, expired or revoked");
  const ancestorIds: string[] = token.ancestorIds || [];
  if (ancestorIds.length > 5) fail(401, "Invalid token delegation chain");
  const ancestors = ancestorIds.length
    ? await ApiToken.find({
        _id: { $in: ancestorIds },
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      }).lean<any[]>()
    : [];
  if (ancestors.length !== ancestorIds.length)
    fail(401, "A parent token is expired or revoked");
  const ancestorOwners = ancestors.length
    ? await Member.find({
        _id: { $in: ancestors.map((parent) => parent.ownerId) },
      }).lean<any[]>()
    : [];
  if (
    ancestors.some(
      (parent) =>
        !ancestorOwners.some((member) => String(member._id) === parent.ownerId),
    )
  )
    fail(401, "A parent token owner is no longer authorized");
  const owner = await Member.findById(token.ownerId).lean<any>();
  if (!owner) return fail(401, "The token owner is no longer authorized");
  const settings = await getSettings();
  if (!settings.apiEnabled) return fail(503, "The API is disabled");
  if (owner.role !== "admin" && !settings.membersCanCreateTokens)
    return fail(403, "Member API access is disabled");
  await rateLimit(`api:${token._id}`, settings.apiRequestsPerMinute);
  await ApiToken.updateOne(
    { _id: token._id },
    { $set: { lastUsedAt: new Date() } },
  );
  return {
    id: owner._id.toString(),
    email: owner.email,
    name: owner.name || owner.email,
    role: owner.role,
    api: {
      id: token._id.toString(),
      scopes: token.scopes.filter((scope: any) =>
        ancestors.every(
          (parent) =>
            parent.scopes.includes(scope) &&
            allowedPermissions({
              ...adminPrincipal(
                ancestorOwners.find(
                  (member) => String(member._id) === parent.ownerId,
                ),
              ),
            }).includes(scope),
        ),
      ),
      ancestorIds,
      constraints: ancestors.map((parent) => ({
        resourceMode: parent.resourceMode,
        fileIds: parent.fileIds,
        folderSlugs: parent.folderSlugs,
      })),
      resourceMode: token.resourceMode,
      fileIds: token.fileIds,
      folderSlugs: token.folderSlugs,
      expiresAt: new Date(token.expiresAt).toISOString(),
    },
  };
}
async function validateResources(body: any, actor: Actor) {
  const resourceMode = body.resourceMode ?? "all",
    fileIds = body.fileIds ?? [],
    folderSlugs = body.folderSlugs ?? [];
  if (
    !["all", "selected"].includes(resourceMode) ||
    !Array.isArray(fileIds) ||
    !Array.isArray(folderSlugs) ||
    fileIds.length > 100 ||
    folderSlugs.length > 100 ||
    fileIds.some(
      (x) => typeof x !== "string" || !mongoose.isValidObjectId(x),
    ) ||
    folderSlugs.some(
      (x) => typeof x !== "string" || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(x),
    )
  )
    fail(400, "Invalid resource restrictions");
  if (resourceMode === "selected" && !fileIds.length && !folderSlugs.length)
    fail(400, "Select at least one file or folder");
  if (
    actor.api &&
    [actor.api, ...(actor.api.constraints || [])].some(
      (rule) => rule.resourceMode === "selected",
    ) &&
    resourceMode !== "selected"
  )
    fail(403, "A restricted token cannot delegate unrestricted access");
  for (const fileId of fileIds) await accessibleFile(actor, fileId);
  for (const slug of folderSlugs) {
    const folder = await FolderModel.findOne({ slug }).lean<any>();
    if (!(BUILTIN_FOLDER_SLUGS as readonly string[]).includes(slug) && !folder)
      fail(404, "Folder not found");
    if (!canReadFolder(actor, folder || { slug }))
      fail(403, "Folder access denied");
  }
  return {
    resourceMode,
    fileIds: [...new Set(fileIds.map((value: string) => value.toLowerCase()))],
    folderSlugs: [...new Set(folderSlugs)],
  };
}
export async function tokensRequest(req: NextRequest, actor: Actor) {
  const method = req.method;
  requirePermission(
    actor,
    method === "GET"
      ? "tokens:list"
      : method === "POST"
        ? "tokens:create"
        : method === "PATCH"
          ? "tokens:update"
          : "tokens:revoke",
  );
  const settings = await getSettings();
  if (actor.role !== "admin" && !settings.membersCanCreateTokens)
    fail(403, "Member API access is disabled");
  await connectDB();
  if (method === "GET") {
    const includeAll = req.nextUrl.searchParams.get("all") === "true";
    if (includeAll) requirePermission(actor, "tokens:manage:any");
    const filter: any = includeAll ? {} : { ownerId: actor.id };
    let pagination: unknown = undefined,
      limit = 500;
    if (actor.api) {
      limit = Number(req.nextUrl.searchParams.get("limit") || 50);
      const cursor = req.nextUrl.searchParams.get("cursor");
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        (cursor && !mongoose.isValidObjectId(cursor))
      )
        fail(400, "Invalid pagination");
      if (cursor) filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
    }
    const results = await ApiToken.find(filter)
      .select("-secretHash")
      .sort({ _id: -1 })
      .limit(limit + 1)
      .lean<any[]>();
    if (actor.api)
      pagination = {
        limit,
        nextCursor:
          results.length > limit ? String(results[limit - 1]._id) : null,
      };
    return json({
      success: true,
      data: results.slice(0, limit),
      ...(pagination ? { pagination } : {}),
      permissions: allowedPermissions(actor).filter(
        (p) => !actor.api || actor.api.scopes.includes(p),
      ),
      policy: {
        defaultLifetimeDays: settings.defaultTokenLifetimeDays,
        maxLifetimeDays: settings.maxTokenLifetimeDays,
      },
    });
  }
  const body = await readJson(req);
  if (method === "POST") {
    if (
      typeof body.name !== "string" ||
      !body.name.trim() ||
      body.name.length > 80
    )
      fail(400, "Token name must be 1–80 characters");
    const scopes = parsePermissions(body.scopes);
    for (const scope of scopes) requirePermission(actor, scope);
    const ownerId = body.ownerId || actor.id;
    if (ownerId !== actor.id) requirePermission(actor, "tokens:manage:any");
    if (!mongoose.isValidObjectId(ownerId)) fail(400, "Invalid owner ID");
    const owner = await Member.findById(ownerId).lean<any>();
    if (!owner) fail(404, "Owner not found");
    const ownerPermissions = allowedPermissions({
      ...actor,
      id: ownerId,
      role: owner.role,
    });
    if (scopes.some((p) => !ownerPermissions.includes(p)))
      fail(403, "Permissions exceed the owner’s current role");
    const expiresAt = body.expiresAt
      ? new Date(body.expiresAt)
      : new Date(
          Math.min(
            Date.now() + settings.defaultTokenLifetimeDays * 86400000,
            actor.api ? new Date(actor.api.expiresAt).getTime() : Infinity,
          ),
        );
    if (
      !Number.isFinite(expiresAt.getTime()) ||
      expiresAt.getTime() <= Date.now() ||
      expiresAt.getTime() >
        Date.now() + settings.maxTokenLifetimeDays * 86400000 ||
      (actor.api &&
        expiresAt.getTime() > new Date(actor.api.expiresAt).getTime())
    )
      fail(400, "Invalid token expiry or delegation lifetime");
    if ((actor.api?.ancestorIds?.length || 0) >= 5)
      fail(403, "Maximum token delegation depth reached");
    const resources = await validateResources(body, actor),
      secret = `edv_${crypto.randomBytes(32).toString("hex")}`;
    const token = await ApiToken.create({
      name: body.name.trim(),
      ownerId,
      secretHash: tokenHash(secret),
      prefix: `${secret.slice(0, 12)}…${secret.slice(-4)}`,
      scopes,
      ...resources,
      expiresAt,
      createdBy: actor.id,
      ancestorIds: actor.api
        ? [...(actor.api.ancestorIds || []), actor.api.id]
        : [],
    });
    const data = token.toObject();
    delete data.secretHash;
    await recordAudit(actor, "tokens.create", token._id.toString(), 201);
    return json({ success: true, data, secret }, 201);
  }
  if (!mongoose.isValidObjectId(body.id)) fail(400, "Invalid token ID");
  const token = await ApiToken.findById(body.id);
  if (!token) fail(404, "API token not found");
  if (token.ownerId !== actor.id) requirePermission(actor, "tokens:manage:any");
  if (method === "DELETE") {
    await ApiToken.updateMany(
      { $or: [{ _id: token._id }, { ancestorIds: String(token._id) }] },
      { $set: { revokedAt: new Date() } },
    );
    await recordAudit(actor, "tokens.revoke", String(token._id), 200);
    return json({ success: true });
  }
  if (method !== "PATCH") return fail(405, "Method not allowed");
  if (
    actor.api &&
    String(token._id) !== actor.api.id &&
    !(token.ancestorIds || []).includes(actor.api.id)
  )
    fail(
      403,
      "API callers can only edit their own token or delegated descendants",
    );
  if (token.revokedAt || new Date(token.expiresAt) <= new Date())
    fail(409, "Create a new token instead of editing an inactive one");
  const scopes = parsePermissions(body.scopes ?? token.scopes);
  for (const scope of scopes) requirePermission(actor, scope);
  const resources = await validateResources(
    {
      resourceMode: token.resourceMode,
      fileIds: token.fileIds,
      folderSlugs: token.folderSlugs,
      ...body,
    },
    actor,
  );
  const owner = await Member.findById(token.ownerId);
  if (!owner) fail(404, "Owner not found");
  if (
    scopes.some(
      (p) => !allowedPermissions({ ...actor, role: owner.role }).includes(p),
    )
  )
    fail(403, "Permissions exceed the owner’s role");
  // Restricted API callers must not edit tokens whose resource envelope is broader.
  if (actor.api?.resourceMode === "selected") {
    if (
      token.resourceMode !== "selected" ||
      token.folderSlugs.some(
        (slug: string) => !tokenAllowsFolder(actor, slug),
      ) ||
      token.fileIds.some(
        (fileId: string) => !actor.api!.fileIds.includes(fileId),
      )
    )
      fail(403, "Cannot edit a token outside the caller’s resource envelope");
  }
  await ApiToken.updateOne(
    { _id: token._id },
    {
      $set: {
        scopes,
        ...resources,
        ...(typeof body.name === "string" && body.name.trim()
          ? { name: body.name.trim().slice(0, 80) }
          : {}),
      },
    },
  );
  await recordAudit(actor, "tokens.update", String(token._id), 200);
  return json({ success: true });
}
