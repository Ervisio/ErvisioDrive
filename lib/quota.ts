import mongoose from "mongoose";
import connectDB from "@/lib/db/mongoose";
import { fail } from "@/lib/http";
export function quotaBytes() {
  const gb = Number(process.env.STORAGE_QUOTA_GB || 100);
  if (!Number.isFinite(gb) || gb <= 0 || gb > 1000000)
    throw new Error("Invalid STORAGE_QUOTA_GB");
  return Math.floor(gb * 1024 ** 3);
}
async function usageCollection() {
  await connectDB();
  return mongoose.connection.collection("driveusage");
}
export async function reserveBytes(bytes: number) {
  if (!Number.isSafeInteger(bytes) || bytes < 0)
    throw new Error("Invalid size");
  const collection = await usageCollection();
  await collection.updateOne(
    { _id: "workspace" as never },
    { $setOnInsert: { usedBytes: 0 } },
    { upsert: true },
  );
  const updated = await collection.findOneAndUpdate(
    { _id: "workspace" as never, usedBytes: { $lte: quotaBytes() - bytes } },
    { $inc: { usedBytes: bytes } },
    { returnDocument: "after" },
  );
  if (!updated)
    return fail(
      413,
      "Storage quota reached. Ask an administrator to expand it.",
    );
}
export async function releaseBytes(bytes: number) {
  const collection = await usageCollection();
  await collection.updateOne({ _id: "workspace" as never }, [
    {
      $set: { usedBytes: { $max: [0, { $subtract: ["$usedBytes", bytes] }] } },
    },
  ]);
}
export async function storageUsage() {
  const collection = await usageCollection(),
    usage = await collection.findOne({ _id: "workspace" as never });
  return { usedBytes: usage?.usedBytes || 0, quotaBytes: quotaBytes() };
}
