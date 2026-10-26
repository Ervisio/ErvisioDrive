import mongoose from "mongoose";
import crypto from "node:crypto";
import connectDB from "@/lib/db/mongoose";
import { fail } from "@/lib/http";
export async function withLocks<T>(
  keys: string[],
  operation: () => Promise<T>,
): Promise<T> {
  await connectDB();
  const collection = mongoose.connection.collection("drivelocks"),
    owner = crypto.randomUUID(),
    acquired: string[] = [];
  try {
    for (const key of [...new Set(keys)].sort()) {
      try {
        const result = await collection.findOneAndUpdate(
          { _id: key as never, expiresAt: { $lt: new Date() } },
          { $set: { owner, expiresAt: new Date(Date.now() + 10 * 60 * 1000) } },
          { upsert: true, returnDocument: "after" },
        );
        if (!result)
          return fail(409, "File is busy. Please try again shortly.");
        acquired.push(key);
      } catch (error) {
        if ((error as { code?: number }).code === 11000)
          return fail(409, "File is busy. Please try again shortly.");
        throw error;
      }
    }
    return await operation();
  } finally {
    for (const key of acquired)
      await collection.deleteOne({ _id: key as never, owner });
  }
}
