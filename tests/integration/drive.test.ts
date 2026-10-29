import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { NextRequest } from "next/server";
import connectDB from "../../lib/db/mongoose";
import { membersRequest } from "../../lib/members";
import { activateAccount, authenticatePassword } from "../../lib/local-auth";
import { authorizeGoogle, authOptions } from "../../lib/auth";
import { driveRequest, accessibleFile } from "../../lib/drive";
import { publicDownload } from "../../lib/download";
import { storageUsage, reserveBytes, releaseBytes } from "../../lib/quota";
import { prepareFile } from "../../lib/serve-file";
import { filePath } from "../../lib/storage";
import Member from "../../models/Member";
import FileModel from "../../models/CdnFile";
import FolderModel from "../../models/CdnFolder";
import ShareModel from "../../models/CdnShareToken";
import type { Actor } from "../../lib/policy";
import { errorResponse } from "../../lib/http";
let mongo: MongoMemoryServer, directory: string, admin: Actor, member: Actor;
const request = (method: string, pathname: string, body?: unknown) =>
  new NextRequest(`http://localhost:3000${pathname}`, {
    method,
    headers: {
      origin: "http://localhost:3000",
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
before(async () => {
  mongo = await MongoMemoryServer.create({
    instance: { args: ["--nounixsocket"] },
    binary: { version: "8.0.13" },
  });
  process.env.MONGODB_URI = mongo.getUri("ervisiodrive");
  process.env.NEXTAUTH_URL = "http://localhost:3000";
  process.env.NEXTAUTH_SECRET =
    "integration-only-secret-with-at-least-thirty-two-characters";
  process.env.STORAGE_QUOTA_GB = "0.001";
  process.env.STORAGE_ENCRYPTION_KEY = "cd".repeat(32);
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "ervisiodrive-"));
  process.env.STORAGE_DIR = directory;
  await connectDB();
  await Promise.all([
    Member.init(),
    FileModel.init(),
    FolderModel.init(),
    ShareModel.init(),
  ]);
  const owner = await Member.create({
    email: "owner@example.com",
    role: "admin",
    isOwner: true,
    googleSub: "owner-sub",
  });
  admin = {
    id: owner._id.toString(),
    email: owner.email,
    name: "Owner",
    role: "admin",
  };
});
after(async () => {
  await mongoose.disconnect();
  global.driveConnection = undefined;
  await mongo?.stop();
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});
test("membership, invitation, local login, Google verification and immediate revocation", async () => {
  const created = await membersRequest(
    request("POST", "/api/admin/members", { email: " Person@Example.COM " }),
    admin,
  );
  assert.equal(created.status, 201);
  const data = await created.json(),
    token = new URL(data.invitation).hash.slice(1);
  const saved = await Member.findOne({ email: "person@example.com" }).select(
    "+inviteHash",
  );
  assert.notEqual(saved.inviteHash, token);
  const activation = () =>
    activateAccount(
      request("POST", "/api/activate", {
        token,
        password: "My strong password 123!",
      }),
    );
  assert.equal((await activation()).status, 200);
  await assert.rejects(activation);
  assert.equal(
    await authenticatePassword("person@example.com", "incorrect password"),
    null,
  );
  const user = await authenticatePassword(
    "person@example.com",
    "My strong password 123!",
  );
  assert.ok(user);
  member = { id: user.id, email: user.email, name: user.name, role: "member" };
  assert.equal(
    await authorizeGoogle({
      email: user.email,
      email_verified: false,
      sub: "sub-person",
    }),
    null,
  );
  assert.equal(
    await authorizeGoogle({
      email: "outsider@example.com",
      email_verified: true,
      sub: "outsider",
    }),
    null,
  );
  assert.ok(
    await authorizeGoogle({
      email: user.email,
      email_verified: true,
      sub: "sub-person",
    }),
  );
  assert.equal(
    await authorizeGoogle({
      email: user.email,
      email_verified: true,
      sub: "different-sub",
    }),
    null,
  );
  await assert.rejects(() =>
    membersRequest(request("GET", "/api/admin/members"), member),
  );
  await assert.rejects(() =>
    membersRequest(
      request("DELETE", "/api/admin/members", { id: admin.id }),
      admin,
    ),
  );
  const initialVersion = user.sessionVersion;
  const reset = await (
    await membersRequest(
      request("PATCH", "/api/admin/members", { id: user.id, action: "invite" }),
      admin,
    )
  ).json();
  await activateAccount(
    request("POST", "/api/activate", {
      token: new URL(reset.invitation).hash.slice(1),
      password: "My replacement password!",
    }),
  );
  assert.ok((await Member.findById(user.id)).sessionVersion > initialVersion);
  assert.equal(
    await authenticatePassword(user.email, "My strong password 123!"),
    null,
  );
  assert.ok(await authenticatePassword(user.email, "My replacement password!"));
});
test("upload, ACL enforcement, folder moves, editor, quota, shares and media ranges", async () => {
  const form = new FormData();
  form.append(
    "files",
    new File(["hello world"], "hello.txt", { type: "text/plain" }),
  );
  const encoded = new Request("http://localhost:3000", {
    method: "POST",
    body: form,
  });
  const bytes = Buffer.from(await encoded.arrayBuffer());
  const uploadReq = new NextRequest(
    "http://localhost:3000/api/admin/cdn/upload",
    {
      method: "POST",
      headers: {
        "content-type": encoded.headers.get("content-type")!,
        "content-length": String(bytes.length),
      },
      body: bytes,
    },
  );
  const uploaded = await (
      await driveRequest(uploadReq, ["upload"], admin)
    ).json(),
    file = uploaded.data[0],
    fileId = String(file._id);
  assert.equal((await storageUsage()).usedBytes, 11);
  assert.equal((await storageUsage(admin.id)).member?.usedBytes, 11);
  const listFor = async (actor: typeof member, query = "") =>
    (
      await (
        await driveRequest(request("GET", `/api/admin/cdn/files${query}`), ["files"], actor)
      ).json()
    ).data.length;
  // Uploads are private to their owner until shared.
  assert.equal(await listFor(member), 0);
  await assert.rejects(() => accessibleFile(member, fileId));
  assert.equal(await listFor(member, `?owner=${admin.id}`).catch(() => "denied"), "denied");
  assert.equal(await listFor(admin, `?owner=all`), 1);
  // Stored bytes are encrypted at rest and served decrypted.
  const stored = await FileModel.findById(fileId).lean<any>();
  assert.equal(stored.encryption.alg, "aes-256-gcm-chunked");
  assert.ok(!(await fs.readFile(filePath(stored.folder, stored.storedName))).includes("hello world"));
  await driveRequest(
    request("PATCH", "/api/admin/cdn/access", { visibility: "members" }),
    ["files", fileId, "access"],
    admin,
  );
  assert.equal(await listFor(member), 1);
  assert.equal(await listFor(member, "?scope=shared"), 1);
  assert.equal(await listFor(member, "?scope=mine"), 0);
  const folder = await (
    await driveRequest(
      request("POST", "/api/admin/cdn/folders", { name: "Private files" }),
      ["folders"],
      admin,
    )
  ).json();
  await driveRequest(
    request("POST", "/api/admin/cdn/access", { email: admin.email }),
    ["folders", folder.data.slug, "access"],
    admin,
  );
  await driveRequest(
    request("PATCH", "/api/admin/cdn/file", { folder: folder.data.slug }),
    ["files", fileId],
    admin,
  );
  await assert.rejects(() => accessibleFile(member, fileId));
  const hidden = await (
    await driveRequest(
      request("GET", `/api/admin/cdn/files?folder=${folder.data.slug}`),
      ["files"],
      member,
    )
  ).json();
  assert.equal(hidden.data.length, 0);
  assert.equal(hidden.folderCounts[folder.data.slug], undefined);
  await driveRequest(
    request("POST", "/api/admin/cdn/access", { email: member.email }),
    ["folders", folder.data.slug, "access"],
    admin,
  );
  await accessibleFile(member, fileId);
  await assert.rejects(() =>
    driveRequest(
      request("POST", "/api/admin/cdn/access", { email: member.email }),
      ["files", fileId, "access"],
      member,
    ),
  );
  await driveRequest(
    request("PUT", "/api/admin/cdn/content", {
      content: "updated file contents",
    }),
    ["files", fileId, "content"],
    member,
  );
  assert.equal((await storageUsage()).usedBytes, 21);
  const shared = await (
    await driveRequest(
      request("POST", "/api/admin/cdn/share", { maxDownloads: 1 }),
      ["files", fileId, "share"],
      admin,
    )
  ).json();
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      publicDownload(request("GET", "/download"), shared.data.token),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  for (const result of results)
    if (result.status === "fulfilled")
      assert.equal(await result.value.text(), "updated file contents");
  const protectedShare = await (
    await driveRequest(
      request("POST", "/api/admin/cdn/share", { password: "secret-pass" }),
      ["files", fileId, "share"],
      admin,
    )
  ).json();
  assert.equal(
    (
      await publicDownload(
        request("GET", "/download"),
        protectedShare.data.token,
      )
    ).status,
    401,
  );
  const password = "password=secret-pass";
  const passwordReq = new NextRequest("http://localhost:3000/download", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "content-length": String(password.length),
    },
    body: password,
  });
  assert.equal(
    await (await publicDownload(passwordReq, protectedShare.data.token)).text(),
    "updated file contents",
  );
  const fileDoc = await accessibleFile(admin, fileId);
  const rangeReq = new NextRequest("http://localhost:3000/content", {
    headers: { range: "bytes=0-6" },
  });
  const range = (await prepareFile(rangeReq, fileDoc)).response();
  assert.equal(range.status, 206);
  assert.equal(await range.text(), "updated");
  assert.equal(range.headers.get("content-type"), "application/octet-stream");
  await assert.rejects(() => reserveBytes(2 * 1024 * 1024));
  const copies = await driveRequest(
    request("POST", "/copy"),
    ["files", fileId, "copy"],
    admin,
  );
  assert.equal(copies.status, 201);
  assert.equal((await storageUsage()).usedBytes, 42);
  await driveRequest(request("DELETE", "/file"), ["files", fileId], admin);
  assert.equal((await storageUsage()).usedBytes, 21);
  await assert.rejects(() =>
    publicDownload(request("GET", "/download"), protectedShare.data.token),
  );
});
test("atomic quota reservations never oversubscribe; raising quota permits new writes", async () => {
  process.env.STORAGE_QUOTA_GB = String(100 / 1024 ** 3);
  const results = await Promise.allSettled([
    reserveBytes(60),
    reserveBytes(60),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await storageUsage()).usedBytes, 81);
  process.env.STORAGE_QUOTA_GB = String(1000 / 1024 ** 3);
  await reserveBytes(100);
  assert.equal((await storageUsage()).usedBytes, 181);
  await releaseBytes(100);
  await membersRequest(request("DELETE", "/members", { id: member.id }), admin);
  assert.equal(
    await authenticatePassword(member.email, "My replacement password!"),
    null,
  );
});
test("streaming uploads honour in-app limits, per-member quotas, events and statistics", async () => {
  const { settingsRequest } = await import("../../lib/settings");
  const { statsRequest } = await import("../../lib/stats");
  const { eventsCollection } = await import("../../lib/events");
  const upload = async (actor: Actor, name: string, data: Buffer) => {
    const form = new FormData();
    form.append("files", new File([new Uint8Array(data)], name, { type: "application/octet-stream" }));
    const encoded = new Request("http://localhost:3000", { method: "POST", body: form }),
      bytes = Buffer.from(await encoded.arrayBuffer());
    return driveRequest(
      new NextRequest("http://localhost:3000/api/admin/cdn/upload", {
        method: "POST",
        headers: {
          "content-type": encoded.headers.get("content-type")!,
          "content-length": String(bytes.length),
        },
        body: bytes,
      }),
      ["upload"],
      actor,
    );
  };
  const settle = (promise: Promise<Response>) =>
    promise.then((r) => r.status, (e) => e.status ?? 500);
  // The in-app setting overrides the environment in both directions.
  await settingsRequest(request("PATCH", "/api/settings", { uploadMaxMb: 0.0001, storageQuotaGb: 0 }), admin);
  assert.equal(await settle(upload(admin, "big.bin", Buffer.alloc(200 * 1024, 1))), 413);
  await settingsRequest(request("PATCH", "/api/settings", { uploadMaxMb: 0 }), admin);
  const large = Buffer.alloc(3 * 1024 * 1024 + 7, 7);
  const response = await upload(admin, "large.bin", large);
  assert.equal(response.status, 201);
  const big = (await response.json()).data[0];
  assert.equal(big.size, large.length);
  const served = (await prepareFile(
    new NextRequest("http://localhost:3000/c", { headers: { range: "bytes=1048570-1048580" } }),
    await accessibleFile(admin, String(big._id)),
  )).response();
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), large.subarray(1048570, 1048581));
  // Per-member quota: a member override blocks only that member.
  const person = await Member.create({ email: "quota@example.com", role: "member", quotaGb: 1 / 1024 ** 2 });
  const limited: Actor = { id: String(person._id), email: person.email, name: "Q", role: "member" };
  assert.equal(await settle(upload(limited, "a.bin", Buffer.alloc(2048))), 413);
  assert.equal(await settle(upload(limited, "b.bin", Buffer.alloc(100))), 201);
  assert.equal((await storageUsage(limited.id)).member?.usedBytes, 100);
  // Events feed the statistics; members only see their own.
  const events = await eventsCollection();
  assert.ok((await events.countDocuments({ type: "upload", actorId: admin.id })) >= 1);
  const stats = async (actor: Actor, query = "") =>
    (await statsRequest(new NextRequest(`http://localhost:3000/api/stats${query}`), [], actor)).json();
  const workspace = await stats(admin);
  assert.equal(workspace.data.scope, "workspace");
  assert.ok(workspace.data.storage.byMember.some((row: any) => row.memberId === limited.id && row.bytes === 100));
  assert.ok(workspace.data.storage.byCategory.length > 0);
  assert.ok(workspace.data.totals.uploads >= 2);
  const own = await stats(limited);
  assert.equal(own.data.scope, "member");
  assert.equal(own.data.storage.usedBytes, 100);
  await assert.rejects(() => statsRequest(new NextRequest(`http://localhost:3000/api/stats?member=${admin.id}`), [], limited));
  await settingsRequest(request("PATCH", "/api/settings", { uploadMaxMb: null, storageQuotaGb: null }), admin);
});
test("files encrypted by the maintenance script are readable by the app", async () => {
  const { execFileSync } = await import("node:child_process");
  const plain = Buffer.alloc(150 * 1024, 3);
  const storedName = "ab".repeat(12) + ".bin";
  await fs.mkdir(path.join(directory, "other"), { recursive: true });
  await fs.writeFile(path.join(directory, "other", storedName), plain);
  const legacy = await FileModel.create({
    name: "legacy.bin", storedName, folder: "other", mimeType: "application/octet-stream",
    size: plain.length, url: `/api/content/other/${storedName}`, uploadedBy: admin.id,
  });
  await FileModel.updateOne({ _id: legacy._id }, { $unset: { encryption: 1 } });
  execFileSync(process.execPath, ["scripts/ops.mjs", "encrypt"], { env: process.env });
  const doc = await FileModel.findById(legacy._id).lean<any>();
  assert.equal(doc.encryption.alg, "aes-256-gcm-chunked");
  assert.notDeepEqual(await fs.readFile(path.join(directory, "other", storedName)), plain);
  const served = (await prepareFile(new NextRequest("http://localhost:3000/c"), doc)).response();
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), plain);
});

test("plugin API is hidden without the socket secret and manages the drive with it", async () => {
  const { pluginRequest, runtimeFile } = await import("../../lib/plugin");
  const call = (method: string, pathname: string, body?: unknown, secret?: string) => {
    const req = request(method, pathname, body);
    if (secret) req.headers.set("x-ervisio-plugin", secret);
    return pluginRequest(req, pathname.replace("/api/plugin/", "").split("/")).catch((e) => e);
  };
  delete process.env.PLUGIN_SOCKET_SECRET;
  assert.equal((await call("GET", "/api/plugin/status")).status, 404);
  const secret = "s".repeat(64);
  process.env.PLUGIN_SOCKET_SECRET = secret;
  assert.equal((await call("GET", "/api/plugin/status", undefined, "x".repeat(64))).status, 404);
  const status = await (await call("GET", "/api/plugin/status", undefined, secret)).json();
  assert.equal(status.data.encryption, true);
  assert.equal(typeof status.data.members, "number");
  const settings = await call("PATCH", "/api/plugin/settings", { maxFilesPerUpload: 7 }, secret);
  assert.equal(settings.status, 200);
  assert.equal((await call("PUT", "/api/plugin/public-url", { url: "http://drive.example.com" }, secret)).status, 400);
  const previous = process.env.NEXTAUTH_URL;
  try {
    const saved = await (await call("PUT", "/api/plugin/public-url", { url: "https://drive.example.com/" }, secret)).json();
    assert.deepEqual(saved.data, { publicUrl: "https://drive.example.com", trustProxy: true });
    assert.equal(process.env.NEXTAUTH_URL, "https://drive.example.com");
    assert.equal(JSON.parse(await fs.readFile(runtimeFile(), "utf8")).publicUrl, "https://drive.example.com");
  } finally {
    process.env.NEXTAUTH_URL = previous;
    process.env.TRUST_PROXY = "false";
    delete process.env.PLUGIN_SOCKET_SECRET;
  }
});
test("nested folders inherit access, move without cycles, delete recursively and run bulk actions", async () => {
  process.env.STORAGE_QUOTA_GB = "1";
  const person = await Member.create({ email: "nested@example.com", role: "member" });
  const member: Actor = { id: person._id.toString(), email: person.email, name: "Nested", role: "member" };
  const call = async (actor: Actor, method: string, parts: string[], body?: unknown, query = "") => {
    const res = await driveRequest(request(method, `/api/admin/cdn/${parts.join("/")}${query}`, body), parts, actor).catch(errorResponse);
    return { status: res.status, body: await res.json() };
  };
  const put = async (actor: Actor, folder: string, name: string) => {
    const form = new FormData();
    form.append("folder", folder);
    form.append("files", new File([name], name, { type: "text/plain" }));
    const encoded = new Request("http://localhost:3000", { method: "POST", body: form }),
      bytes = Buffer.from(await encoded.arrayBuffer());
    const res = await driveRequest(
      new NextRequest("http://localhost:3000/api/admin/cdn/upload", {
        method: "POST",
        headers: { "content-type": encoded.headers.get("content-type")!, "content-length": String(bytes.length) },
        body: bytes,
      }),
      ["upload"],
      actor,
    );
    return String((await res.json()).data[0]._id);
  };
  const top = (await call(admin, "POST", ["folders"], { name: "Projects" })).body.data;
  const mid = (await call(admin, "POST", ["folders"], { name: "Clients", parent: top.slug })).body.data;
  const leaf = (await call(admin, "POST", ["folders"], { name: "Rossi", parent: mid.slug })).body.data;
  assert.equal(mid.parent, top.slug);
  assert.deepEqual(leaf.ancestors, [top.slug, mid.slug]);
  assert.equal((await call(admin, "POST", ["folders"], { name: "Ghost", parent: "missing" })).status, 404);
  const children = (await call(admin, "GET", ["folders"], undefined, `?parent=${top.slug}`)).body.data;
  assert.deepEqual(children.map((f: any) => f.slug), [mid.slug]);
  // Access granted on the top folder reaches every subfolder.
  const sees = async () =>
    (await call(member, "GET", ["folders"], undefined, `?parent=${mid.slug}`)).body.data.map((f: any) => f.slug);
  assert.deepEqual(await sees(), []);
  assert.equal((await call(admin, "POST", ["folders", top.slug, "access"], { email: member.email })).status, 200);
  assert.deepEqual(await sees(), [leaf.slug]);
  const deep = await put(admin, leaf.slug, "deep.txt");
  await put(admin, mid.slug, "middle.txt");
  const own = await put(member, leaf.slug, "mine.txt");
  const recursive = (await call(admin, "GET", ["files"], undefined, `?folder=${top.slug}&recursive=true`)).body.data;
  assert.equal(recursive.length, 3);
  assert.equal((await call(admin, "GET", ["files"], undefined, `?folder=${top.slug}`)).body.data.length, 0);
  // A folder never moves into itself or one of its subfolders.
  assert.equal((await call(admin, "PATCH", ["folders", top.slug], { parent: leaf.slug })).status, 400);
  assert.equal((await call(admin, "PATCH", ["folders", top.slug], { parent: top.slug })).status, 400);
  const moved = (await call(admin, "PATCH", ["folders", mid.slug], { parent: null })).body.data;
  assert.deepEqual(moved.ancestors, []);
  assert.deepEqual((await FolderModel.findOne({ slug: leaf.slug }).lean<any>()).ancestors, [mid.slug]);
  await call(admin, "PATCH", ["folders", mid.slug], { parent: top.slug });
  // Bulk actions report every file; one failure does not stop the others.
  const missing = new mongoose.Types.ObjectId().toString();
  const bulk = await call(member, "POST", ["files", "bulk"], { action: "delete", ids: [own, missing] });
  assert.equal(bulk.body.succeeded, 1);
  assert.equal(bulk.body.failed, 1);
  assert.equal(bulk.body.data.find((r: any) => r.id === missing).status, 404);
  assert.equal((await call(admin, "POST", ["files", "bulk"], { action: "wipe", ids: [deep] })).status, 400);
  const move = await call(admin, "POST", ["files", "bulk"], { action: "move", ids: [deep], folder: top.slug });
  assert.equal(move.body.succeeded, 1);
  assert.equal((await FileModel.findById(deep).lean<any>()).folder, top.slug);
  // Deleting the top folder needs a decision on the files it contains, then removes the whole subtree.
  assert.equal((await call(admin, "DELETE", ["folders", top.slug])).status, 409);
  const gone = await call(admin, "DELETE", ["folders", top.slug], undefined, "?files=delete");
  assert.deepEqual([gone.body.files, gone.body.folders], [2, 3]);
  assert.equal(await FolderModel.countDocuments({ slug: { $in: [top.slug, mid.slug, leaf.slug] } }), 0);
  assert.equal(await FileModel.countDocuments({ _id: deep }), 0);
});
