import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { NextRequest } from "next/server";
import connectDB from "../../lib/db/mongoose";
import {
  tokensRequest,
  authenticateApiToken,
  tokenHash,
} from "../../lib/api-tokens";
import { v1Request } from "../../lib/api";
import { API_OPERATIONS } from "../../lib/api-operations";
import { permissionNames } from "../../lib/permissions-catalog";
import {
  settingsRequest,
  getSettings,
  validCognitoIssuer,
} from "../../lib/settings";
import { authorizeOidc, buildAuthOptions } from "../../lib/auth";
import { settingsDefaults } from "../../lib/settings";
import Member from "../../models/Member";
import ApiToken from "../../models/ApiToken";
import FileModel from "../../models/CdnFile";
import FolderModel from "../../models/CdnFolder";
import { generateStoredName, filePath, fileUrl } from "../../lib/storage";
import type { Actor } from "../../lib/policy";
let mongo: MongoMemoryServer,
  directory: string,
  admin: Actor,
  member: Actor,
  fileId: string,
  otherId: string;
const req = (method: string, url: string, body?: unknown, token?: string) =>
  new NextRequest("http://localhost:3000" + url, {
    method,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const api = (
  method: string,
  pathname: string,
  secret: string,
  body?: unknown,
) =>
  v1Request(
    req(method, "/api/v1" + pathname, body, secret),
    pathname.split("?")[0].split("/").filter(Boolean),
  );
async function issue(
  scopes: string[],
  resources: Record<string, unknown> = {},
  actor = admin,
) {
  return (
    await tokensRequest(
      req("POST", "/api/tokens", { name: "integration", scopes, ...resources }),
      actor,
    )
  ).json();
}
before(async () => {
  mongo = await MongoMemoryServer.create({
    instance: { args: ["--nounixsocket"] },
    binary: { version: "8.0.13" },
  });
  process.env.MONGODB_URI = mongo.getUri("api-tests");
  process.env.NEXTAUTH_URL = "http://localhost:3000";
  process.env.NEXTAUTH_SECRET = "test-secret-at-least-thirty-two-characters";
  process.env.STORAGE_QUOTA_GB = "1";
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "drive-api-"));
  process.env.STORAGE_DIR = directory;
  await connectDB();
  await Promise.all([
    Member.init(),
    ApiToken.init(),
    FileModel.init(),
    FolderModel.init(),
  ]);
  const owner = await Member.create({
      email: "owner@example.com",
      role: "admin",
      isOwner: true,
    }),
    person = await Member.create({
      email: "member@example.com",
      role: "member",
    });
  admin = {
    id: String(owner._id),
    email: owner.email,
    name: "Owner",
    role: "admin",
  };
  member = {
    id: String(person._id),
    email: person.email,
    name: "Member",
    role: "member",
  };
  for (const folder of ["documents", "images"]) {
    const storedName = generateStoredName("test.txt"),
      location = filePath(folder, storedName);
    await fs.mkdir(path.dirname(location), { recursive: true });
    await fs.writeFile(location, "test-content");
    const file = await FileModel.create({
      name: "test.txt",
      folder,
      storedName,
      mimeType: "text/plain",
      size: 12,
      url: fileUrl(folder, storedName),
      uploadedBy: admin.id,
      // Shared with every member, so member tokens can exercise the API.
      visibility: "members",
    });
    if (folder === "documents") fileId = String(file._id);
    else otherId = String(file._id);
  }
});
after(async () => {
  await mongoose.disconnect();
  global.driveConnection = undefined;
  await mongo?.stop();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});
test("all versioned operations deny missing scopes and never accept a session or Cognito JWT as a bearer token", async () => {
  const token = await issue(["files:read"]);
  assert.match(token.secret, /^edv_[a-f0-9]{64}$/);
  const stored = await ApiToken.findById(token.data._id).select("+secretHash");
  assert.equal(stored.secretHash, tokenHash(token.secret));
  assert.notEqual(stored.secretHash, token.secret);
  for (const operation of API_OPERATIONS) {
    if (!operation.scope || operation.scope === "files:read") continue;
    const pathname = operation.path
      .replace("{id}", fileId)
      .replace("{slug}", "documents")
      .replace("{token}", "a".repeat(64));
    const response = await api(
      operation.method,
      pathname,
      token.secret,
      operation.method === "GET" ? undefined : { name: "must-not-apply" },
    );
    assert.equal(
      response.status,
      403,
      operation.method + " " + pathname + " " + (await response.text()),
    );
  }
  assert.equal((await v1Request(req("GET", "/api/v1/me"), ["me"])).status, 401);
  assert.equal(
    (await api("GET", "/me", "eyJ.not-an-ervisiodrive-token")).status,
    401,
  );
  assert.equal(
    (await api("GET", `/files/${fileId}`, token.secret)).status,
    200,
  );
  const unchanged = await FileModel.findById(fileId);
  assert.ok(unchanged);
  assert.equal(unchanged.name, "test.txt");
  const listed = await (
    await tokensRequest(req("GET", "/api/tokens"), admin)
  ).json();
  assert.equal(JSON.stringify(listed).includes(token.secret), false);
});
test("resource restrictions constrain even administrator tokens, including counts, download and move destinations", async () => {
  const token = await issue(
    [
      "files:list",
      "files:read",
      "files:download",
      "files:rename",
      "files:move",
      "folders:read",
    ],
    { resourceMode: "selected", folderSlugs: ["documents"] },
  );
  const page = await (await api("GET", "/files", token.secret)).json();
  assert.deepEqual(
    page.data.map((f: any) => f._id),
    [fileId],
  );
  assert.equal(page.folderCounts.images, undefined);
  assert.equal(
    (await api("GET", `/files/${otherId}`, token.secret)).status,
    403,
  );
  assert.equal((await api("GET", "/folders/images", token.secret)).status, 403);
  assert.equal(
    (
      await api("PATCH", `/files/${fileId}/folder`, token.secret, {
        folder: "images",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api("PATCH", `/files/${fileId}/name`, token.secret, {
        name: "renamed.txt",
        folder: "images",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api("PATCH", `/files/${fileId}/name`, token.secret, {
        name: "renamed.txt",
      })
    ).status,
    200,
  );
  assert.equal(
    await (await api("GET", `/files/${fileId}/download`, token.secret)).text(),
    "test-content",
  );
  const ranged = await v1Request(
    new NextRequest(`http://localhost:3000/api/v1/files/${fileId}/download`, {
      headers: { Authorization: "Bearer " + token.secret, range: "bytes=0-3" },
    }),
    ["files", fileId, "download"],
  );
  assert.equal(ranged.status, 206);
  assert.equal(await ranged.text(), "test");
  const onlyFile = await issue(["files:read", "files:copy"], {
    resourceMode: "selected",
    fileIds: [fileId],
  });
  assert.equal(
    (await api("POST", `/files/${fileId}/copy`, onlyFile.secret)).status,
    403,
  );
  const cursor = await issue(["files:list"]);
  // Query strings are not route segments; exercise the route with an explicit context.
  const response = await v1Request(
      req("GET", "/api/v1/files?limit=1", undefined, cursor.secret),
      ["files"],
    ),
    list = await response.json();
  assert.equal(list.data.length, 1);
  assert.ok(list.pagination.nextCursor);
  const next = await (
    await v1Request(
      req(
        "GET",
        `/api/v1/files?limit=1&cursor=${list.pagination.nextCursor}`,
        undefined,
        cursor.secret,
      ),
      ["files"],
    )
  ).json();
  assert.equal(next.data.length, 1);
  assert.notEqual(next.data[0]._id, list.data[0]._id);
});
test("delegation cannot escalate scopes, resources, owner roles or token lifetime", async () => {
  await assert.rejects(() => issue(["settings:write"], {}, member));
  const parent = await issue(["tokens:create", "files:read"], {
    resourceMode: "selected",
    fileIds: [fileId],
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  });
  assert.equal(
    (
      await api("POST", "/tokens", parent.secret, {
        name: "bad-scopes",
        scopes: ["files:delete"],
        resourceMode: "selected",
        fileIds: [fileId],
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api("POST", "/tokens", parent.secret, {
        name: "bad-resource",
        scopes: ["files:read"],
        resourceMode: "all",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api("POST", "/tokens", parent.secret, {
        name: "bad-file",
        scopes: ["files:read"],
        resourceMode: "selected",
        fileIds: [otherId],
      })
    ).status,
    403,
  );
  const childResponse = await api("POST", "/tokens", parent.secret, {
    name: "child",
    scopes: ["files:read"],
    resourceMode: "selected",
    fileIds: [fileId],
  });
  assert.equal(childResponse.status, 201, await childResponse.clone().text());
  const child = await childResponse.json();
  assert.ok(new Date(child.data.expiresAt) <= new Date(parent.data.expiresAt));
  await tokensRequest(
    req("DELETE", "/api/tokens", { id: parent.data._id }),
    admin,
  );
  assert.equal((await api("GET", "/me", child.secret)).status, 401);
  const unrelated = await issue(["files:read"]);
  const restrictedEditor = await issue(["tokens:update", "files:read"]);
  assert.equal(
    (
      await api(
        "PATCH",
        `/tokens/${unrelated.data._id}`,
        restrictedEditor.secret,
        { scopes: ["files:read"] },
      )
    ).status,
    403,
  );
  const createOnly = await issue(["members:create"]);
  assert.equal(
    (
      await api("POST", "/members", createOnly.secret, {
        email: "escalated@example.com",
        role: "admin",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api("POST", "/members", createOnly.secret, {
        email: "invited@example.com",
        issueInvitation: true,
      })
    ).status,
    403,
  );
  const created = await (
    await api("POST", "/members", createOnly.secret, {
      email: "whitelisted@example.com",
    })
  ).json();
  assert.equal(created.success, true);
  assert.equal(created.invitation, undefined);
});
test("API configuration, expiry, revocation and owner demotion apply immediately", async () => {
  const token = await issue(["files:read"], {}, member);
  assert.equal(
    (await api("GET", `/files/${fileId}`, token.secret)).status,
    200,
  );
  await settingsRequest(
    req("PATCH", "/api/settings", { membersCanCreateTokens: false }),
    admin,
  );
  assert.equal(
    (await api("GET", `/files/${fileId}`, token.secret)).status,
    403,
  );
  await settingsRequest(
    req("PATCH", "/api/settings", { membersCanCreateTokens: true }),
    admin,
  );
  await tokensRequest(
    req("DELETE", "/api/tokens", { id: token.data._id }),
    member,
  );
  assert.equal((await api("GET", "/me", token.secret)).status, 401);
  const adminToken = await issue(["settings:read"]);
  await Member.updateOne({ _id: admin.id }, { $set: { role: "member" } });
  assert.equal((await api("GET", "/settings", adminToken.secret)).status, 403);
  await Member.updateOne({ _id: admin.id }, { $set: { role: "admin" } });
  await ApiToken.updateOne(
    { _id: adminToken.data._id },
    { $set: { expiresAt: new Date(0) } },
  );
  assert.equal((await api("GET", "/me", adminToken.secret)).status, 401);
  const remaining = await issue(["files:read"]);
  await settingsRequest(
    req("PATCH", "/api/settings", { apiEnabled: false }),
    admin,
  );
  assert.equal((await api("GET", "/me", remaining.secret)).status, 503);
  await settingsRequest(
    req("PATCH", "/api/settings", { apiEnabled: true }),
    admin,
  );
  await assert.rejects(() =>
    settingsRequest(
      req("PATCH", "/api/settings", { defaultLocale: "fr" }),
      admin,
    ),
  );
  await assert.rejects(() =>
    settingsRequest(
      req("PATCH", "/api/settings", {
        cognitoClientSecret: "should-never-be-stored-here",
      }),
      admin,
    ),
  );
  assert.equal((await getSettings()).defaultLocale, "en");
});
test("member API disable propagates through an administrator-owned delegation chain", async () => {
  const other = await Member.create({
    email: "other-admin@example.com",
    role: "admin",
  });
  const parent = await issue([
    "tokens:create",
    "tokens:manage:any",
    "files:read",
  ]);
  const created = await api("POST", "/tokens", parent.secret, {
    name: "other-owner",
    ownerId: String(other._id),
    scopes: ["files:read"],
  });
  assert.equal(created.status, 201);
  const child = await created.json();
  await Member.updateOne({ _id: admin.id }, { $set: { role: "member" } });
  await settingsRequest(
    req("PATCH", "/api/settings", { membersCanCreateTokens: false }),
    admin,
  );
  assert.equal(
    (await api("GET", `/files/${fileId}`, child.secret)).status,
    403,
  );
  await Member.updateOne({ _id: admin.id }, { $set: { role: "admin" } });
  await settingsRequest(
    req("PATCH", "/api/settings", { membersCanCreateTokens: true }),
    admin,
  );
  await assert.rejects(
    () =>
      settingsRequest(
        req("PATCH", "/api/settings", JSON.parse('{"__proto__":2}')),
        admin,
      ),
    { status: 400 },
  );
});
test("Cognito requires a verified whitelisted email and pins issuer + subject without trusting groups", async () => {
  process.env.COGNITO_ISSUER =
    "https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_TestPool";
  process.env.COGNITO_CLIENT_ID = "test-client";
  assert.equal(validCognitoIssuer("http://localhost/internal"), false);
  assert.equal(
    await authorizeOidc("cognito", {
      email: member.email,
      email_verified: false,
      sub: "subject",
    }),
    null,
  );
  assert.equal(
    await authorizeOidc("cognito", {
      email: "outsider@example.com",
      email_verified: true,
      sub: "outsider",
    }),
    null,
  );
  const authenticated = await authorizeOidc("cognito", {
    email: member.email,
    email_verified: true,
    sub: "subject",
  });
  assert.ok(authenticated);
  assert.equal(authenticated.role, "member");
  assert.equal(
    await authorizeOidc("cognito", {
      email: member.email,
      email_verified: true,
      sub: "other-subject",
    }),
    null,
  );
  process.env.COGNITO_ISSUER =
    "https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_OtherPool";
  assert.equal(
    await authorizeOidc("cognito", {
      email: member.email,
      email_verified: true,
      sub: "subject",
    }),
    null,
  );
  const options = buildAuthOptions(settingsDefaults),
    provider = options.providers.find((p) => p.id === "cognito") as any;
  assert.ok(provider);
  assert.deepEqual(provider.options.checks, ["pkce", "state", "nonce"]);
  assert.equal(provider.options.client.token_endpoint_auth_method, "none");
  delete process.env.COGNITO_ISSUER;
  delete process.env.COGNITO_CLIENT_ID;
});
test("v1 covers nested folders, descendant token scope and bulk file actions", async () => {
  const scopes = ["folders:create", "folders:list", "folders:update", "folders:delete", "files:list", "files:move", "files:delete"];
  const full = (await issue(scopes)).secret;
  const body = async (res: Response) => ({ status: res.status, data: (await res.json()).data });
  const top = (await body(await api("POST", "/folders", full, { name: "Api top" }))).data;
  const sub = (await body(await api("POST", "/folders", full, { name: "Api sub", parent: top.slug }))).data;
  assert.deepEqual(sub.ancestors, [top.slug]);
  const listed = await body(await api("GET", `/folders?parent=${top.slug}`, full));
  assert.deepEqual(listed.data.map((f: any) => f.slug), [sub.slug]);
  const moved = await (await api("POST", "/files/bulk-move", full, { ids: [fileId, otherId], folder: sub.slug })).json();
  assert.equal(moved.succeeded, 2);
  assert.equal((await api("POST", "/files/bulk-move", full, { ids: [fileId] })).status, 400);
  assert.equal((await api("POST", "/files/bulk-delete", full, { ids: [fileId], folder: top.slug })).status, 400);
  // A token limited to the top folder reaches its subfolders, never the top level.
  const scoped = (await issue(scopes, { resourceMode: "selected", folderSlugs: [top.slug] })).secret;
  assert.equal((await api("POST", "/folders", scoped, { name: "Escape" })).status, 403);
  assert.equal((await api("POST", "/folders", scoped, { name: "Deeper", parent: sub.slug })).status, 201);
  const inside = await body(await api("GET", `/files?folder=${top.slug}&recursive=true`, scoped));
  assert.equal(inside.data.length, 2);
  assert.equal((await api("PATCH", `/folders/${sub.slug}`, scoped, { parent: null })).status, 403);
  const deleted = await (await api("POST", "/files/bulk-delete", scoped, { ids: [fileId, otherId] })).json();
  assert.equal(deleted.succeeded, 2);
  assert.equal((await api("DELETE", `/folders/${top.slug}`, full)).status, 200);
  assert.equal(await FolderModel.countDocuments({ ancestors: top.slug }), 0);
});
