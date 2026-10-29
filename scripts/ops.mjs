import mongoose from "mongoose";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
const command = process.argv[2] || "bootstrap";
const root = path.resolve(process.env.STORAGE_DIR || "./data/files");
// Same format as lib/crypto-store.ts: AES-256-GCM in 64 KiB chunks, one random
// data key per file wrapped with a key derived from STORAGE_ENCRYPTION_KEY.
const CHUNK = 64 * 1024;
function masterKey() {
  const raw = (process.env.STORAGE_ENCRYPTION_KEY || "").trim();
  if (!raw) return null;
  const key = /^[a-f0-9]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (key.length !== 32)
    throw new Error("STORAGE_ENCRYPTION_KEY must be 32 bytes (hex or base64)");
  return key;
}
function sealChunk(dek, nonce, index, last, data) {
  const iv = Buffer.alloc(12),
    aad = Buffer.alloc(9);
  nonce.copy(iv, 0, 0, 8);
  iv.writeUInt32BE(index, 8);
  aad.write("edv1", 0);
  aad.writeUInt32BE(index, 4);
  aad[8] = last ? 1 : 0;
  const cipher = crypto.createCipheriv("aes-256-gcm", dek, iv);
  cipher.setAAD(aad);
  return Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);
}
async function encryptFile(master, source, target, owner, size) {
  const userKey = Buffer.from(
    crypto.hkdfSync("sha256", master, "ervisiodrive:files", `member:${owner}`, 32),
  );
  const dek = crypto.randomBytes(32),
    nonce = crypto.randomBytes(8),
    keyIv = crypto.randomBytes(12),
    wrap = crypto.createCipheriv("aes-256-gcm", userKey, keyIv);
  wrap.setAAD(Buffer.from(`dek:${owner}`));
  const wrappedKey = Buffer.concat([wrap.update(dek), wrap.final()]);
  const input = await fs.open(source, "r"),
    output = await fs.open(target, "wx");
  try {
    const count = Math.max(1, Math.ceil(size / CHUNK)),
      buffer = Buffer.alloc(CHUNK);
    for (let index = 0; index < count; index++) {
      const { bytesRead } = await input.read(buffer, 0, CHUNK, index * CHUNK);
      await output.write(
        sealChunk(dek, nonce, index, index === count - 1, buffer.subarray(0, bytesRead)),
      );
    }
    await output.sync();
  } finally {
    await input.close();
    await output.close();
  }
  return {
    alg: "aes-256-gcm-chunked",
    v: 1,
    keyOwner: owner,
    wrappedKey: wrappedKey.toString("base64"),
    keyIv: keyIv.toString("base64"),
    keyTag: wrap.getAuthTag().toString("base64"),
    nonce: nonce.toString("base64"),
    chunkSize: CHUNK,
  };
}
const location = (file) => {
  if (
    !/^[a-z0-9][a-z0-9-]{0,99}$/.test(file.folder) ||
    !/^[a-f0-9]{24}(\.[a-z0-9]{1,12})?$/.test(file.storedName)
  )
    throw new Error("Invalid storage path");
  return path.join(root, file.folder, file.storedName);
};
async function bootstrap(db) {
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || "").trim().toLowerCase();
  if (
    !email ||
    !process.env.NEXTAUTH_SECRET ||
    process.env.NEXTAUTH_SECRET.length < 32
  )
    throw new Error(
      "Configure the owner email and NEXTAUTH_SECRET through setup",
    );
  const members = db.collection("drivemembers");
  await members.createIndex({ email: 1 }, { unique: true });
  await db
    .collection("cdnfiles")
    .createIndex({ storedName: 1 }, { unique: true });
  await db.collection("cdnfolders").createIndex({ slug: 1 }, { unique: true });
  await db
    .collection("cdnsharetokens")
    .createIndex({ token: 1 }, { unique: true });
  await db.collection("cdnfiles").createIndex({ uploadedBy: 1 });
  await db.collection("cdnfiles").createIndex({ folder: 1 });
  const events = db.collection("driveevents");
  await events.createIndex({ at: -1 });
  await events.createIndex({ type: 1, at: -1 });
  await events.createIndex({ tokenId: 1, at: -1 });
  await events.createIndex({ ownerId: 1, at: -1 });
  await events.createIndex({ actorId: 1, at: -1 });
  await db
    .collection("driveratelimits")
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db
    .collection("drivelocks")
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db
    .collection("driveusage")
    .updateOne(
      { _id: "workspace" },
      { $setOnInsert: { usedBytes: 0 } },
      { upsert: true },
    );
  await migrateVisibility(db);
  await rebuildMemberUsage(db);
  if (masterKey()) await encryptExisting(db);
  else
    console.warn(
      "STORAGE_ENCRYPTION_KEY is not set: files are stored unencrypted. Run setup to generate it.",
    );
  if ((await members.countDocuments()) === 0) {
    const token = crypto.randomBytes(32).toString("hex"),
      now = new Date();
    await members.insertOne({
      email,
      role: "admin",
      isOwner: true,
      name: "",
      googleSub: null,
      passwordHash: null,
      sessionVersion: 0,
      inviteHash: crypto.createHash("sha256").update(token).digest("hex"),
      inviteExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
      lastLogin: null,
    });
    console.log(`First sign-in: ${process.env.NEXTAUTH_URL}/activate#${token}`);
    console.log(
      "Open this link within 48 hours to set your password. The database stores only its hash.",
    );
  } else
    console.log(
      "Database already initialized. Accounts and credentials preserved.",
    );
}
// Before per-member spaces, an empty allowedUsers list meant "every member".
// Existing content keeps that meaning; new uploads are private by default.
async function migrateVisibility(db) {
  for (const name of ["cdnfiles", "cdnfolders"]) {
    const collection = db.collection(name);
    await collection.updateMany(
      { visibility: { $exists: false }, allowedUsers: { $in: [null, []] } },
      { $set: { visibility: "members" } },
    );
    await collection.updateMany(
      { visibility: { $exists: false } },
      { $set: { visibility: "private" } },
    );
  }
}
async function rebuildMemberUsage(db) {
  const usage = db.collection("driveusage");
  if (await usage.findOne({ _id: "members-initialized" })) return;
  for await (const row of db.collection("cdnfiles").aggregate([
    { $group: { _id: "$uploadedBy", bytes: { $sum: "$size" } } },
  ]))
    if (row._id)
      await usage.updateOne(
        { _id: `member:${row._id}` },
        { $set: { usedBytes: row.bytes } },
        { upsert: true },
      );
  await usage.insertOne({ _id: "members-initialized", at: new Date() });
}
async function encryptExisting(db) {
  const master = masterKey();
  if (!master) throw new Error("Set STORAGE_ENCRYPTION_KEY first");
  const files = db.collection("cdnfiles");
  let count = 0;
  for await (const file of files.find({ encryption: { $in: [null] } })) {
    const source = location(file),
      temp = `${source}.${crypto.randomUUID()}.enc`;
    const stat = await fs.stat(source).catch(() => null);
    if (!stat) {
      console.warn(`Missing file: ${file._id}`);
      continue;
    }
    try {
      const encryption = await encryptFile(master, source, temp, file.uploadedBy || "", stat.size);
      await fs.rename(temp, source);
      await files.updateOne(
        { _id: file._id },
        { $set: { encryption, size: stat.size } },
      );
      count++;
    } finally {
      await fs.unlink(temp).catch(() => {});
    }
  }
  if (count) console.log(`Encrypted ${count} existing files.`);
}
async function cleanup(db) {
  const files = db.collection("cdnfiles"),
    shares = db.collection("cdnsharetokens"),
    locks = db.collection("drivelocks");
  let count = 0;
  for await (const file of files.find({
    expiresAt: { $ne: null, $lte: new Date() },
  })) {
    const key = `file:${file._id}`,
      owner = crypto.randomUUID();
    try {
      await locks.findOneAndUpdate(
        { _id: key, expiresAt: { $lt: new Date() } },
        { $set: { owner, expiresAt: new Date(Date.now() + 600000) } },
        { upsert: true },
      );
    } catch (error) {
      if (error.code === 11000) continue;
      throw error;
    }
    try {
      const current = await files.findOne({
        _id: file._id,
        expiresAt: { $ne: null, $lte: new Date() },
      });
      if (!current) continue;
      await fs.unlink(location(current)).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      const removed = await files.deleteOne({ _id: current._id });
      await shares.deleteMany({ fileId: String(current._id) });
      if (removed.deletedCount)
        for (const key of ["workspace", `member:${current.uploadedBy}`])
          await db.collection("driveusage").updateOne({ _id: key }, [
            {
              $set: {
                usedBytes: {
                  $max: [0, { $subtract: ["$usedBytes", current.size] }],
                },
              },
            },
          ]);
      count++;
    } finally {
      await locks.deleteOne({ _id: key, owner });
    }
  }
  await shares.deleteMany({ expiresAt: { $ne: null, $lte: new Date() } });
  const settings = await db.collection("workspacesettings").findOne({ _id: "workspace" }),
    retention = settings?.statsRetentionDays ?? 365;
  if (retention > 0)
    await db
      .collection("driveevents")
      .deleteMany({ at: { $lt: new Date(Date.now() - retention * 86400000) } });
  console.log(`Cleanup complete: ${count} expired files removed.`);
}
async function reconcile(db) {
  if (process.env.MAINTENANCE_CONFIRMED !== "true")
    throw new Error(
      "Stop app and cleanup; set MAINTENANCE_CONFIRMED=true to reconcile the quota",
    );
  let usedBytes = 0;
  const perMember = new Map();
  for await (const file of db.collection("cdnfiles").find()) {
    const stat = await fs.stat(location(file)).catch(() => null);
    if (!stat) {
      console.warn(`Missing file: ${file._id}`);
      continue;
    }
    // Encrypted files are larger on disk; their plaintext size is in the DB.
    const size = file.encryption ? file.size : stat.size;
    usedBytes += size;
    perMember.set(file.uploadedBy, (perMember.get(file.uploadedBy) || 0) + size);
    if (file.size !== size)
      await db
        .collection("cdnfiles")
        .updateOne({ _id: file._id }, { $set: { size } });
  }
  const usage = db.collection("driveusage");
  await usage.updateOne({ _id: "workspace" }, { $set: { usedBytes } }, { upsert: true });
  await usage.deleteMany({ _id: /^member:/ });
  for (const [member, bytes] of perMember)
    if (member)
      await usage.insertOne({ _id: `member:${member}`, usedBytes: bytes });
  console.log(
    `Quota reconciled: ${usedBytes} bytes. Orphan files are not deleted.`,
  );
}
async function resetOwner(db) {
  const member = await db.collection("drivemembers").findOne({ isOwner: true });
  if (!member) throw new Error("Owner not found");
  const token = crypto.randomBytes(32).toString("hex");
  await db.collection("drivemembers").updateOne(
    { _id: member._id },
    {
      $set: {
        inviteHash: crypto.createHash("sha256").update(token).digest("hex"),
        inviteExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
    },
  );
  console.log(`Owner recovery: ${process.env.NEXTAUTH_URL}/activate#${token}`);
}
try {
  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
  });
  const db = mongoose.connection.db;
  if (command === "bootstrap") await bootstrap(db);
  else if (command === "reset-owner") await resetOwner(db);
  else if (command === "reconcile") await reconcile(db);
  else if (command === "cleanup") await cleanup(db);
  else if (command === "encrypt") await encryptExisting(db);
  else if (command === "cleanup-loop") {
    while (true) {
      try {
        await cleanup(db);
      } catch (error) {
        console.error("Cleanup failed:", error.message);
      }
      await new Promise((resolve) => setTimeout(resolve, 3600000));
    }
  } else throw new Error("Unknown command");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
