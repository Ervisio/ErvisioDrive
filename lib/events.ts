// Activity events behind the statistics: uploads, downloads, previews, public
// link downloads, edits, deletions and every API call. Writes never fail the
// request that triggered them.
import mongoose from "mongoose";
import type { NextRequest } from "next/server";
import connectDB from "@/lib/db/mongoose";
import type { Actor } from "@/lib/policy";
import { mimeToFolder } from "@/lib/storage";

export type EventType =
  | "upload"
  | "download"
  | "view"
  | "share_download"
  | "edit"
  | "delete"
  | "api";

export interface DriveEvent {
  at: Date;
  type: EventType;
  channel: "web" | "api" | "public";
  actorId: string | null;
  tokenId: string | null;
  ownerId: string | null;
  fileId: string | null;
  category: string | null;
  bytes: number;
  ip: string | null;
  country: string | null;
  userAgent: string | null;
  origin: string | null;
  method: string | null;
  endpoint: string | null;
  status: number | null;
  durationMs: number | null;
}

export async function eventsCollection() {
  await connectDB();
  return mongoose.connection.collection<DriveEvent>("driveevents");
}

/** Client address and context. The IP is only trusted behind a proxy. */
export function clientInfo(req: NextRequest) {
  const trusted = process.env.TRUST_PROXY === "true",
    header = (name: string, max: number) =>
      (req.headers.get(name) || "").trim().slice(0, max) || null;
  const origin = header("origin", 200) || header("referer", 500);
  let host: string | null = null;
  try {
    host = origin ? new URL(origin).host : null;
  } catch {}
  return {
    ip: trusted
      ? (req.headers.get("x-forwarded-for") || "").split(",")[0].trim().slice(0, 64) ||
        header("x-real-ip", 64)
      : null,
    country: trusted ? header("cf-ipcountry", 2) : null,
    userAgent: header("user-agent", 300),
    origin: host,
  };
}

export async function recordEvent(
  req: NextRequest | null,
  type: EventType,
  details: {
    actor?: Actor | null;
    file?: { _id?: unknown; uploadedBy?: string; mimeType?: string } | null;
    bytes?: number;
    channel?: DriveEvent["channel"];
    endpoint?: string;
    status?: number;
    durationMs?: number;
  } = {},
) {
  try {
    const { actor, file } = details;
    await (await eventsCollection()).insertOne({
      at: new Date(),
      type,
      channel: details.channel ?? (actor?.api ? "api" : actor ? "web" : "public"),
      actorId: actor?.id ?? null,
      tokenId: actor?.api?.id ?? null,
      ownerId: file?.uploadedBy ?? null,
      fileId: file?._id ? String(file._id) : null,
      category: file?.mimeType ? mimeToFolder(file.mimeType) : null,
      bytes: details.bytes ?? 0,
      ...(req
        ? clientInfo(req)
        : { ip: null, country: null, userAgent: null, origin: null }),
      method: req?.method ?? null,
      endpoint: details.endpoint ?? null,
      status: details.status ?? null,
      durationMs: details.durationMs ?? null,
    });
  } catch (error) {
    console.error(
      "Event not recorded:",
      error instanceof Error ? error.message : "unknown",
    );
  }
}
