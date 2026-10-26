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
import Member from "../../models/Member";
import FileModel from "../../models/CdnFile";
import FolderModel from "../../models/CdnFolder";
import ShareModel from "../../models/CdnShareToken";
import type { Actor } from "../../lib/policy";
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
  assert.equal(
    (
      await (
        await driveRequest(
          request("GET", "/api/admin/cdn/files"),
          ["files"],
          member,
        )
      ).json()
    ).data.length,
    1,
  );
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
