import mongoose from "mongoose";
import crypto from "node:crypto";
import connectDB from "@/lib/db/mongoose";
import type { Actor } from "@/lib/policy";
export async function recordAudit(
  actor: Actor,
  action: string,
  target: string,
  status: number,
  requestId: string = crypto.randomUUID(),
) {
  await connectDB();
  await mongoose.connection
    .collection("driveaudit")
    .insertOne({
      requestId,
      actorId: actor.id,
      tokenId: actor.api?.id || null,
      action,
      target: target
        .replace(/\/shares\/[^/]+/g, "/shares/[redacted]")
        .slice(0, 250),
      status,
      createdAt: new Date(),
    });
  return requestId;
}
