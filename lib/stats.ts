// Read-only statistics. Administrators see the whole workspace and can focus
// on one member; everyone else only ever sees their own files and tokens.
import mongoose from "mongoose";
import type { NextRequest } from "next/server";
import FileModel from "@/models/CdnFile";
import Member from "@/models/Member";
import ApiToken from "@/models/ApiToken";
import connectDB from "@/lib/db/mongoose";
import { eventsCollection } from "@/lib/events";
import { fail, json } from "@/lib/http";
import type { Actor } from "@/lib/policy";
import { memberQuota, storageUsage } from "@/lib/quota";
import { liveFilter } from "@/lib/drive";

const RANGES: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90, "365d": 365 };
const DAY = 86400000;
const finite = (value: number) => (Number.isFinite(value) ? value : null);

function scopeFor(req: NextRequest, actor: Actor) {
  const requested = req.nextUrl.searchParams.get("member");
  if (requested && actor.role !== "admin" && requested !== actor.id)
    fail(403, "Only administrators can see other members' statistics");
  if (requested && !mongoose.isValidObjectId(requested)) fail(400, "Invalid identifier");
  // null = the whole workspace (administrators only).
  return actor.role === "admin" ? requested : actor.id;
}
function rangeFor(req: NextRequest) {
  const days = RANGES[req.nextUrl.searchParams.get("range") || "30d"];
  if (!days) fail(400, "Range must be one of 7d, 30d, 90d, 365d");
  const since = new Date(Date.now() - days * DAY);
  since.setUTCHours(0, 0, 0, 0);
  return { days, since };
}
const day = { $dateToString: { format: "%Y-%m-%d", date: "$at" } };
const count = (type: string) => ({ $sum: { $cond: [{ $eq: ["$type", type] }, 1, 0] } });
const bytesOf = (type: string) => ({
  $sum: { $cond: [{ $eq: ["$type", type] }, "$bytes", 0] },
});

async function overview(req: NextRequest, actor: Actor) {
  const member = scopeFor(req, actor),
    { days, since } = rangeFor(req),
    files = FileModel.collection,
    events = await eventsCollection();
  const fileMatch = { ...liveFilter(), ...(member ? { uploadedBy: member } : {}) };
  // Activity on a member's files, or activity performed by them.
  const eventMatch: Record<string, unknown> = { at: { $gte: since } };
  if (member) eventMatch.$or = [{ ownerId: member }, { actorId: member }];

  const [byCategory, largest, byMember, timeline, topFiles, channels, usage] =
    await Promise.all([
      files
        .aggregate([
          { $match: fileMatch },
          { $group: { _id: "$folder", bytes: { $sum: "$size" }, files: { $sum: 1 } } },
        ])
        .toArray(),
      files
        .find(fileMatch, {
          projection: { name: 1, size: 1, mimeType: 1, uploadedBy: 1, uploadedByUsername: 1, createdAt: 1 },
        })
        .sort({ size: -1 })
        .limit(8)
        .toArray(),
      member
        ? Promise.resolve([])
        : files
            .aggregate([
              { $match: fileMatch },
              { $group: { _id: "$uploadedBy", bytes: { $sum: "$size" }, files: { $sum: 1 } } },
              { $sort: { bytes: -1 } },
            ])
            .toArray(),
      events
        .aggregate([
          { $match: eventMatch },
          {
            $group: {
              _id: day,
              uploads: count("upload"),
              uploadBytes: bytesOf("upload"),
              downloads: count("download"),
              downloadBytes: bytesOf("download"),
              views: count("view"),
              shareDownloads: count("share_download"),
              shareBytes: bytesOf("share_download"),
              apiCalls: count("api"),
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray(),
      events
        .aggregate([
          {
            $match: {
              ...eventMatch,
              type: { $in: ["download", "share_download", "view"] },
              fileId: { $ne: null },
            },
          },
          {
            $group: {
              _id: "$fileId",
              downloads: { $sum: { $cond: [{ $eq: ["$type", "view"] }, 0, 1] } },
              views: count("view"),
              bytes: { $sum: "$bytes" },
              last: { $max: "$at" },
            },
          },
          { $sort: { downloads: -1, views: -1 } },
          { $limit: 8 },
        ])
        .toArray(),
      events
        .aggregate([
          { $match: { ...eventMatch, type: { $ne: "api" } } },
          { $group: { _id: "$channel", events: { $sum: 1 }, bytes: { $sum: "$bytes" } } },
        ])
        .toArray(),
      storageUsage(member ?? undefined),
    ]);

  // Fill missing days so charts have a continuous axis.
  const series = new Map(timeline.map((row) => [row._id, row]));
  const activity = Array.from({ length: days + 1 }, (_, i) => {
    const date = new Date(since.getTime() + i * DAY).toISOString().slice(0, 10),
      row: any = series.get(date) || {};
    return {
      date,
      uploads: row.uploads || 0,
      uploadBytes: row.uploadBytes || 0,
      downloads: row.downloads || 0,
      downloadBytes: row.downloadBytes || 0,
      views: row.views || 0,
      shareDownloads: row.shareDownloads || 0,
      shareBytes: row.shareBytes || 0,
      apiCalls: row.apiCalls || 0,
    };
  }).filter((row) => row.date <= new Date().toISOString().slice(0, 10));

  const memberIds = [
    ...new Set([
      ...byMember.map((row) => row._id),
      ...largest.map((file) => file.uploadedBy),
    ]),
  ].filter((id) => mongoose.isValidObjectId(id));
  const [people, fileNames] = await Promise.all([
    Member.find({ _id: { $in: memberIds } }).select("email name quotaGb").lean<any[]>(),
    FileModel.find({
      _id: { $in: topFiles.map((row) => row._id).filter((id) => mongoose.isValidObjectId(id)) },
    })
      .select("name mimeType size uploadedBy")
      .lean<any[]>(),
  ]);
  const personById = new Map(people.map((p) => [String(p._id), p])),
    fileById = new Map(fileNames.map((f) => [String(f._id), f]));
  const sum = (key: keyof (typeof activity)[number]) =>
    activity.reduce((total, row) => total + (row[key] as number), 0);

  return json({
    success: true,
    data: {
      scope: member ? "member" : "workspace",
      member,
      range: { days, since },
      storage: {
        usedBytes: member ? usage.member?.usedBytes ?? 0 : usage.usedBytes,
        quotaBytes: member ? usage.member?.quotaBytes ?? null : usage.quotaBytes,
        files: byCategory.reduce((n, row) => n + row.files, 0),
        byCategory: byCategory
          .map((row) => ({ category: row._id, bytes: row.bytes, files: row.files }))
          .sort((a, b) => b.bytes - a.bytes),
        largest: largest.map((file) => ({
          id: String(file._id),
          name: file.name,
          size: file.size,
          mimeType: file.mimeType,
          owner: personById.get(file.uploadedBy)?.email ?? file.uploadedByUsername,
          createdAt: file.createdAt,
        })),
        byMember: await Promise.all(
          byMember.map(async (row) => ({
            memberId: row._id,
            email: personById.get(row._id)?.email ?? null,
            name: personById.get(row._id)?.name ?? "",
            bytes: row.bytes,
            files: row.files,
            quotaBytes: row._id ? finite(await memberQuota(row._id)) : null,
          })),
        ),
      },
      totals: {
        uploads: sum("uploads"),
        uploadBytes: sum("uploadBytes"),
        downloads: sum("downloads"),
        downloadBytes: sum("downloadBytes"),
        views: sum("views"),
        shareDownloads: sum("shareDownloads"),
        shareBytes: sum("shareBytes"),
        apiCalls: sum("apiCalls"),
      },
      activity,
      channels: channels.map((row) => ({ channel: row._id, events: row.events, bytes: row.bytes })),
      topFiles: topFiles.map((row) => ({
        id: row._id,
        name: fileById.get(row._id)?.name ?? null,
        mimeType: fileById.get(row._id)?.mimeType ?? null,
        downloads: row.downloads,
        views: row.views,
        bytes: row.bytes,
        lastAt: row.last,
      })),
    },
  });
}

async function tokens(req: NextRequest, actor: Actor, tokenId?: string) {
  const member = scopeFor(req, actor),
    { days, since } = rangeFor(req),
    events = await eventsCollection();
  const owned = await ApiToken.find(member ? { ownerId: member } : {})
    .select("name prefix ownerId lastUsedAt revokedAt expiresAt scopes")
    .lean<any[]>();
  const ids = owned.map((token) => String(token._id));
  if (tokenId && !ids.includes(tokenId)) return fail(404, "Token not found");
  const match = {
    type: "api" as const,
    at: { $gte: since },
    tokenId: tokenId ? tokenId : { $in: ids },
  };
  const group = (key: string, extra: Record<string, unknown> = {}) =>
    events
      .aggregate([
        { $match: { ...match, [key]: { $ne: null } } },
        {
          $group: {
            _id: `$${key}`,
            calls: { $sum: 1 },
            errors: { $sum: { $cond: [{ $gte: ["$status", 400] }, 1, 0] } },
            lastAt: { $max: "$at" },
            ...extra,
          },
        },
        { $sort: { calls: -1 } },
        { $limit: 20 },
      ])
      .toArray();
  const [byToken, byEndpoint, byIp, byOrigin, byAgent, byStatus, timeline, recent, perDay] =
    await Promise.all([
      group("tokenId", { avgMs: { $avg: "$durationMs" } }),
      group("endpoint", { avgMs: { $avg: "$durationMs" } }),
      group("ip", { country: { $last: "$country" } }),
      group("origin"),
      group("userAgent"),
      group("status"),
      events
        .aggregate([
          { $match: match },
          {
            $group: {
              _id: day,
              calls: { $sum: 1 },
              errors: { $sum: { $cond: [{ $gte: ["$status", 400] }, 1, 0] } },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray(),
      tokenId
        ? events
            .find(match, {
              projection: { at: 1, endpoint: 1, status: 1, ip: 1, country: 1, origin: 1, userAgent: 1, durationMs: 1 },
            })
            .sort({ at: -1 })
            .limit(50)
            .toArray()
        : Promise.resolve([]),
      // Calls per token per day, for the small trend line on each key.
      events
        .aggregate([
          { $match: match },
          { $group: { _id: { token: "$tokenId", day }, calls: { $sum: 1 } } },
        ])
        .toArray(),
    ]);
  const owners = await Member.find({ _id: { $in: owned.map((t) => t.ownerId) } })
    .select("email")
    .lean<any[]>();
  const ownerEmail = new Map(owners.map((o) => [String(o._id), o.email])),
    tokenById = new Map(owned.map((t) => [String(t._id), t]));
  const series = new Map(timeline.map((row) => [row._id, row]));
  const today = new Date().toISOString().slice(0, 10);
  const dates = Array.from({ length: days + 1 }, (_, i) =>
    new Date(since.getTime() + i * DAY).toISOString().slice(0, 10),
  ).filter((date) => date <= today);
  const daily = new Map(perDay.map((row) => [`${row._id.token} ${row._id.day}`, row.calls]));
  return json({
    success: true,
    data: {
      range: { days, since },
      // IPs are only known behind a proxy that sets X-Forwarded-For.
      ipTracking: process.env.TRUST_PROXY === "true",
      tokens: owned.map((token) => {
        const usage: any = byToken.find((row) => row._id === String(token._id)) || {};
        return {
          id: String(token._id),
          name: token.name,
          prefix: token.prefix,
          owner: ownerEmail.get(token.ownerId) ?? null,
          active: !token.revokedAt && new Date(token.expiresAt) > new Date(),
          lastUsedAt: token.lastUsedAt,
          calls: usage.calls || 0,
          errors: usage.errors || 0,
          avgMs: usage.avgMs ? Math.round(usage.avgMs) : null,
          daily: dates.map((date) => daily.get(`${token._id} ${date}`) || 0),
        };
      }).sort((a, b) => b.calls - a.calls),
      activity: Array.from({ length: days + 1 }, (_, i) => {
        const date = new Date(since.getTime() + i * DAY).toISOString().slice(0, 10),
          row: any = series.get(date) || {};
        return { date, calls: row.calls || 0, errors: row.errors || 0 };
      }).filter((row) => row.date <= today),
      endpoints: byEndpoint.map((row) => ({
        endpoint: row._id,
        calls: row.calls,
        errors: row.errors,
        avgMs: row.avgMs ? Math.round(row.avgMs) : null,
        lastAt: row.lastAt,
      })),
      ips: byIp.map((row) => ({ ip: row._id, country: row.country ?? null, calls: row.calls, errors: row.errors, lastAt: row.lastAt })),
      origins: byOrigin.map((row) => ({ origin: row._id, calls: row.calls, lastAt: row.lastAt })),
      userAgents: byAgent.map((row) => ({ userAgent: row._id, calls: row.calls, lastAt: row.lastAt })),
      statuses: byStatus.map((row) => ({ status: row._id, calls: row.calls })),
      recent: recent.map((row) => ({
        at: row.at,
        endpoint: row.endpoint,
        status: row.status,
        ip: row.ip,
        country: row.country,
        origin: row.origin,
        userAgent: row.userAgent,
        durationMs: row.durationMs,
      })),
      token: tokenId ? tokenById.get(tokenId)?.name ?? null : null,
    },
  });
}

export async function statsRequest(req: NextRequest, segments: string[], actor: Actor) {
  if (req.method !== "GET") return fail(405, "Method not allowed");
  await connectDB();
  const [section, id] = segments;
  if (!section || section === "overview") return overview(req, actor);
  if (section === "tokens") {
    if (id && !mongoose.isValidObjectId(id)) return fail(400, "Invalid identifier");
    return tokens(req, actor, id);
  }
  return fail(404, "Endpoint not found");
}
