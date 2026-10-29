import mongoose from "mongoose";
import connectDB from "@/lib/db/mongoose";
import { fail } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import Member from "@/models/Member";

const GB = 1024 ** 3;
const bytesFromGb = (gb: number) => (gb === 0 ? Infinity : Math.floor(gb * GB));

/** Quota from STORAGE_QUOTA_GB; 0 means unlimited. */
export function quotaBytes() {
  const gb = Number(process.env.STORAGE_QUOTA_GB ?? 100);
  if (!Number.isFinite(gb) || gb < 0) throw new Error("Invalid STORAGE_QUOTA_GB");
  return bytesFromGb(gb);
}
/** Workspace quota: the in-app setting overrides the environment. */
export async function workspaceQuota() {
  const { storageQuotaGb } = await getSettings();
  return storageQuotaGb === null ? quotaBytes() : bytesFromGb(storageQuotaGb);
}
/** A member's quota: their own override, else the workspace default per user. */
export async function memberQuota(memberId: string) {
  const [settings, member] = await Promise.all([
    getSettings(),
    mongoose.isValidObjectId(memberId)
      ? Member.findById(memberId).select("quotaGb").lean<any>()
      : null,
  ]);
  return bytesFromGb(member?.quotaGb ?? settings.userQuotaGb);
}
async function usageCollection() {
  await connectDB();
  return mongoose.connection.collection("driveusage");
}
const memberKey = (id: string) => `member:${id}`;

async function reserveOn(key: string, limit: number, bytes: number) {
  const collection = await usageCollection();
  await collection.updateOne(
    { _id: key as never },
    { $setOnInsert: { usedBytes: 0 } },
    { upsert: true },
  );
  return collection.findOneAndUpdate(
    {
      _id: key as never,
      ...(Number.isFinite(limit) ? { usedBytes: { $lte: limit - bytes } } : {}),
    },
    { $inc: { usedBytes: bytes } },
    { returnDocument: "after" },
  );
}
async function releaseOn(key: string, bytes: number) {
  const collection = await usageCollection();
  await collection.updateOne({ _id: key as never }, [
    { $set: { usedBytes: { $max: [0, { $subtract: ["$usedBytes", bytes] }] } } },
  ]);
}

/** Reserves space on the workspace and, when given, on the owner's quota. */
export async function reserveBytes(bytes: number, owner?: string) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error("Invalid size");
  if (!(await reserveOn("workspace", await workspaceQuota(), bytes)))
    return fail(413, "Storage quota reached. Ask an administrator to expand it.");
  if (owner && !(await reserveOn(memberKey(owner), await memberQuota(owner), bytes))) {
    await releaseOn("workspace", bytes);
    return fail(413, "Your storage quota is full. Free some space or ask an administrator.");
  }
}
export async function releaseBytes(bytes: number, owner?: string) {
  if (!bytes) return;
  await releaseOn("workspace", bytes);
  if (owner) await releaseOn(memberKey(owner), bytes);
}

/** Quotas are reported as null when unlimited (JSON has no Infinity). */
const finite = (value: number) => (Number.isFinite(value) ? value : null);

export async function storageUsage(memberId?: string) {
  const collection = await usageCollection(),
    [workspace, member] = await Promise.all([
      collection.findOne({ _id: "workspace" as never }),
      memberId ? collection.findOne({ _id: memberKey(memberId) as never }) : null,
    ]);
  return {
    usedBytes: workspace?.usedBytes || 0,
    quotaBytes: finite(await workspaceQuota()),
    ...(memberId
      ? {
          member: {
            usedBytes: member?.usedBytes || 0,
            quotaBytes: finite(await memberQuota(memberId)),
          },
        }
      : {}),
  };
}
