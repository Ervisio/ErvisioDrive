import mongoose from "mongoose";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
const command = process.argv[2] || "bootstrap";
const root = path.resolve(process.env.STORAGE_DIR || "./data/files");
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
        await db.collection("driveusage").updateOne({ _id: "workspace" }, [
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
  console.log(`Cleanup complete: ${count} expired files removed.`);
}
async function reconcile(db) {
  if (process.env.MAINTENANCE_CONFIRMED !== "true")
    throw new Error(
      "Stop app and cleanup; set MAINTENANCE_CONFIRMED=true to reconcile the quota",
    );
  let usedBytes = 0;
  for await (const file of db.collection("cdnfiles").find()) {
    const stat = await fs.stat(location(file)).catch(() => null);
    if (!stat) {
      console.warn(`Missing file: ${file._id}`);
      continue;
    }
    usedBytes += stat.size;
    if (file.size !== stat.size)
      await db
        .collection("cdnfiles")
        .updateOne({ _id: file._id }, { $set: { size: stat.size } });
  }
  await db
    .collection("driveusage")
    .updateOne({ _id: "workspace" }, { $set: { usedBytes } }, { upsert: true });
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
