import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import connectDB from "@/lib/db/mongoose";
import { storageRoot } from "@/lib/storage";
import { quotaBytes } from "@/lib/quota";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const db = await connectDB();
    await db.connection.db?.admin().ping();
    await fs.access(storageRoot(), fs.constants.R_OK | fs.constants.W_OK);
    quotaBytes();
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
