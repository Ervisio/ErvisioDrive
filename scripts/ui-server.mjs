import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
const mongo = await MongoMemoryServer.create({
  instance: { args: ["--nounixsocket"] },
  binary: { version: "8.0.13" },
});
const storage = await fs.mkdtemp(path.join(os.tmpdir(), "drive-ui-"));
const origin = "http://127.0.0.1:3111";
const env = {
  ...process.env,
  MONGODB_URI: mongo.getUri("ui"),
  STORAGE_DIR: storage,
  STORAGE_QUOTA_GB: "1",
  NEXTAUTH_URL: origin,
  NEXTAUTH_SECRET: crypto.randomBytes(48).toString("hex"),
  BOOTSTRAP_ADMIN_EMAIL: "ui-owner@example.com",
  PORT: "3111",
  HOSTNAME: "127.0.0.1",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  COGNITO_ISSUER: "",
  COGNITO_CLIENT_ID: "",
};
const output = execFileSync(
  process.execPath,
  ["scripts/ops.mjs", "bootstrap"],
  { env, encoding: "utf8" },
);
const invitation = output.match(/activate#([a-f0-9]{64})/)[1];
await mongoose.connect(env.MONGODB_URI);
const db = mongoose.connection.db,
  owner = await db.collection("drivemembers").findOne({ isOwner: true }),
  now = new Date();
await db
  .collection("cdnfolders")
  .insertOne({
    slug: "project-assets",
    name: "Project assets",
    description: "Shared project files",
    createdBy: String(owner._id),
    allowedUsers: [],
    createdAt: now,
    updatedAt: now,
  });
let used = 0;
for (const [name, mimeType, content, folder] of [
  [
    "Readme.txt",
    "text/plain",
    Buffer.from("Example project notes."),
    "documents",
  ],
  [
    "Cover.png",
    "image/png",
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=",
      "base64",
    ),
    "images",
  ],
]) {
  const storedName =
    crypto.randomBytes(12).toString("hex") + path.extname(name);
  await fs.mkdir(path.join(storage, folder), { recursive: true });
  await fs.writeFile(path.join(storage, folder, storedName), content);
  await db
    .collection("cdnfiles")
    .insertOne({
      name,
      mimeType,
      storedName,
      folder,
      size: content.length,
      url: `/api/content/${folder}/${storedName}`,
      uploadedBy: String(owner._id),
      uploadedByUsername: "Demo owner",
      allowedUsers: [],
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    });
  used += content.length;
}
await db
  .collection("driveusage")
  .updateOne({ _id: "workspace" }, { $set: { usedBytes: used } });
const salt = crypto.randomBytes(16),
  passwordHash = crypto.scryptSync("Disposable UI password 123!", salt, 64, {
    N: 131072,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024,
  });
await db
  .collection("drivemembers")
  .updateOne(
    { _id: owner._id },
    {
      $set: {
        passwordHash: `scrypt-v1$${salt.toString("hex")}$${passwordHash.toString("hex")}`,
      },
      $unset: { inviteHash: 1, inviteExpiresAt: 1 },
    },
  );
await fs.cp(".next/static", ".next/standalone/.next/static", {
  recursive: true,
});
const child = spawn(process.execPath, [".next/standalone/server.js"], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
child.stderr.pipe(process.stderr);
let ready = false;
for (let i = 0; i < 150; i++) {
  try {
    if ((await fetch(origin + "/api/health")).ok) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 100));
}
if (!ready) throw new Error("UI test server failed to start");
console.log("UI test server ready");
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  child.kill("SIGTERM");
  await mongoose.disconnect();
  await mongo.stop();
  await fs.rm(storage, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
