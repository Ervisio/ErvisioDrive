import mongoose from "mongoose";
import { NextRequest } from "next/server";
import { authenticateApiToken, tokensRequest } from "@/lib/api-tokens";
import { matchOperation } from "@/lib/api-operations";
import {
  requirePermission,
  allowedPermissions,
  PERMISSIONS,
} from "@/lib/permissions";
import { driveRequest, accessibleFile } from "@/lib/drive";
import { settingsRequest } from "@/lib/settings";
import { membersRequest } from "@/lib/members";
import { storageUsage } from "@/lib/quota";
import { prepareFile } from "@/lib/serve-file";
import { fail, json, errorResponse, readJson } from "@/lib/http";
import { canReadFolder, type Actor } from "@/lib/policy";
import FolderModel, { BUILTIN_FOLDER_SLUGS } from "@/models/CdnFolder";
import { recordAudit } from "@/lib/audit";
import { recordEvent } from "@/lib/events";

function rewritten(req: NextRequest, method: string, body: unknown) {
  return new NextRequest(req.url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
export async function v1Request(req: NextRequest, parts: string[]) {
  let actor: Actor | undefined;
  const requestId = crypto.randomUUID(),
    started = Date.now();
  let endpoint = "unknown";
  try {
    // No cookie fallback: machine endpoints only accept explicit bearer credentials.
    actor = await authenticateApiToken(req);
    const match = matchOperation(req.method, parts);
    if (!match) return fail(404, "Unknown API operation");
    const { operation, params } = match;
    endpoint = `${req.method} ${operation.path}`;
    if (operation.scope) requirePermission(actor, operation.scope);
    let response: Response;
    const id = params.id,
      slug = params.slug;
    switch (operation.handler) {
      case "me":
        response = json({
          success: true,
          data: {
            id: actor.id,
            email: actor.email,
            role: actor.role,
            token: actor.api,
          },
        });
        break;
      case "permissions":
        response = json({
          success: true,
          data: allowedPermissions(actor)
            .filter((p) => actor!.api!.scopes.includes(p))
            .map((scope) => ({ scope, description: PERMISSIONS[scope] })),
        });
        break;
      case "file":
        response = json({
          success: true,
          data: await accessibleFile(actor, id),
        });
        break;
      case "download": {
        const file = await accessibleFile(actor, id),
          prepared = await prepareFile(req, file, true);
        if (prepared.start === 0)
          await recordEvent(req, "download", { actor, file, bytes: prepared.bytes });
        response = prepared.response();
        break;
      }
      case "folder": {
        const folder = await FolderModel.findOne({ slug }).lean<any>();
        const builtin = (BUILTIN_FOLDER_SLUGS as readonly string[]).includes(
          slug,
        );
        if (!folder && !builtin) fail(404, "Folder not found");
        if (!canReadFolder(actor, folder || { slug }))
          fail(403, "Folder access denied");
        response = json({
          success: true,
          data: folder || { slug, name: slug, builtin: true },
        });
        break;
      }
      case "rename":
      case "move":
      case "expiry": {
        const field =
          operation.handler === "rename"
            ? "name"
            : operation.handler === "move"
              ? "folder"
              : "expiresAt";
        const body = await readJson(req);
        if (!(field in body) || Object.keys(body).length !== 1)
          fail(400, `Exactly one field is required: ${field}`);
        response = await driveRequest(
          rewritten(req, "PATCH", body),
          ["files", id],
          actor,
        );
        break;
      }
      case "shares":
        response = await driveRequest(req, ["files", id, "share"], actor);
        break;
      case "share":
        response = await driveRequest(req, ["share", params.token], actor);
        break;
      case "upload":
        response = await driveRequest(req, ["upload"], actor);
        break;
      case "files":
      case "folders":
        response = await driveRequest(req, parts, actor);
        break;
      case "storage":
        response = json({ success: true, data: await storageUsage(actor.id) });
        break;
      case "members": {
        if (req.method === "POST") {
          const body = await readJson(req);
          if (body.role === "admin") requirePermission(actor, "members:role");
          if (body.issueInvitation === true)
            requirePermission(actor, "members:invite");
          response = await membersRequest(
            rewritten(req, "POST", {
              ...body,
              issueInvitation: body.issueInvitation === true,
            }),
            actor,
          );
        } else response = await membersRequest(req, actor);
        break;
      }
      case "memberRole": {
        const body = await readJson(req);
        if (Object.keys(body).some((k) => k !== "role"))
          fail(400, "Only role is accepted");
        response = await membersRequest(
          rewritten(req, "PATCH", { id, role: body.role }),
          actor,
        );
        break;
      }
      case "memberInvite":
        response = await membersRequest(
          rewritten(req, "PATCH", { id, action: "invite" }),
          actor,
        );
        break;
      case "memberDelete":
        response = await membersRequest(
          rewritten(req, "DELETE", { id }),
          actor,
        );
        break;
      case "settings":
        response = await settingsRequest(req, actor);
        break;
      case "tokens":
        response = await tokensRequest(req, actor);
        break;
      case "tokenUpdate": {
        const body = await readJson(req);
        if ("id" in body || "ownerId" in body || "expiresAt" in body)
          fail(400, "Token identity and expiry cannot be changed");
        response = await tokensRequest(
          rewritten(req, "PATCH", { ...body, id }),
          actor,
        );
        break;
      }
      case "tokenDelete":
        response = await tokensRequest(rewritten(req, "DELETE", { id }), actor);
        break;
      case "audit": {
        const limit = Number(req.nextUrl.searchParams.get("limit") || 50),
          cursor = req.nextUrl.searchParams.get("cursor");
        if (
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > 100 ||
          (cursor && !mongoose.isValidObjectId(cursor))
        )
          fail(400, "Invalid pagination");
        const events = await mongoose.connection
          .collection("driveaudit")
          .find(
            cursor ? { _id: { $lt: new mongoose.Types.ObjectId(cursor) } } : {},
          )
          .sort({ _id: -1 })
          .limit(limit + 1)
          .toArray();
        response = json({
          success: true,
          data: events.slice(0, limit),
          pagination: {
            limit,
            nextCursor:
              events.length > limit ? String(events[limit - 1]._id) : null,
          },
        });
        break;
      }
      default:
        return fail(404, "Unknown API operation");
    }
    if (
      req.method === "GET" &&
      ["/folders", "/members", "/tokens"].includes(operation.path)
    ) {
      const body = await response.clone().json();
      if (!body.pagination) {
        const limit = Number(req.nextUrl.searchParams.get("limit") || 50),
          cursor = req.nextUrl.searchParams.get("cursor");
        if (
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > 100 ||
          (cursor && !mongoose.isValidObjectId(cursor))
        )
          fail(400, "Invalid pagination");
        const ordered = body.data
          .sort((a: any, b: any) => String(b._id).localeCompare(String(a._id)))
          .filter((item: any) => !cursor || String(item._id) < cursor);
        response = json({
          ...body,
          data: ordered.slice(0, limit),
          pagination: {
            limit,
            nextCursor:
              ordered.length > limit ? String(ordered[limit - 1]._id) : null,
          },
        });
      }
    }
    await recordAudit(
      actor,
      `${req.method} ${operation.path}`,
      new URL(req.url).pathname,
      response.status,
      requestId,
    );
    await recordEvent(req, "api", {
      actor,
      endpoint,
      status: response.status,
      durationMs: Date.now() - started,
    });
    response.headers.set("X-Request-Id", requestId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("X-Request-Id", requestId);
    if (response.status === 401)
      response.headers.set("WWW-Authenticate", 'Bearer realm="ErvisioDrive"');
    if (response.status === 429) response.headers.set("Retry-After", "60");
    if (actor)
      await recordEvent(req, "api", {
        actor,
        endpoint,
        status: response.status,
        durationMs: Date.now() - started,
      });
    if (actor)
      await recordAudit(
        actor,
        `${req.method} denied`,
        new URL(req.url).pathname,
        response.status,
        requestId,
      ).catch(() => {});
    return response;
  }
}
