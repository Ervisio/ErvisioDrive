import { NextRequest } from "next/server";
import Settings from "@/models/WorkspaceSettings";
import connectDB from "@/lib/db/mongoose";
import { requirePermission } from "@/lib/permissions";
import type { Actor } from "@/lib/policy";
import { fail, json, readJson } from "@/lib/http";

export const settingsDefaults = {
  siteName: "ErvisioDrive",
  defaultLocale: "en" as "en" | "it",
  uploadMaxMb: null as number | null,
  sharingEnabled: true,
  maxShareLifetimeHours: 0,
  apiEnabled: true,
  membersCanCreateTokens: true,
  defaultTokenLifetimeDays: 30,
  maxTokenLifetimeDays: 365,
  apiRequestsPerMinute: 120,
  googleEnabled: true,
  cognitoEnabled: true,
};
export async function getSettings() {
  await connectDB();
  const doc = await Settings.findById("workspace").lean();
  return Object.fromEntries(
    Object.entries(settingsDefaults).map(([key, value]) => [
      key,
      (doc as any)?.[key] ?? value,
    ]),
  ) as typeof settingsDefaults;
}
export function cognitoConfigured() {
  return !!(
    process.env.COGNITO_CLIENT_ID &&
    validCognitoIssuer(process.env.COGNITO_ISSUER || "")
  );
}
export function validCognitoIssuer(value: string) {
  return /^https:\/\/cognito-idp\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?\/[a-z0-9-]+_[A-Za-z0-9]+$/.test(
    value,
  );
}
export async function settingsRequest(req: NextRequest, actor: Actor) {
  requirePermission(
    actor,
    req.method === "GET" ? "settings:read" : "settings:write",
  );
  if (req.method === "GET")
    return json({
      success: true,
      data: await getSettings(),
      environment: {
        uploadMaxMb: Number(process.env.UPLOAD_MAX_MB || 100),
        quotaGb: Number(process.env.STORAGE_QUOTA_GB || 100),
        googleConfigured: !!(
          process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ),
        cognitoConfigured: cognitoConfigured(),
        cognitoIssuer: process.env.COGNITO_ISSUER || "",
        cognitoClientId: process.env.COGNITO_CLIENT_ID || "",
        callbackBase: process.env.NEXTAUTH_URL || "",
      },
    });
  if (req.method !== "PATCH") return fail(405, "Method not allowed");
  const body = await readJson(req),
    update: Record<string, unknown> = {};
  if (Object.keys(body).some((k) => !(k in settingsDefaults)))
    return fail(400, "Unknown settings field");
  for (const [key, value] of Object.entries(body)) {
    if (key === "siteName") {
      if (
        typeof value !== "string" ||
        !value.trim() ||
        value.trim().length > 60
      )
        fail(400, "Workspace name must be 1–60 characters");
      update[key] = (value as string).trim();
    } else if (key === "defaultLocale") {
      if (value !== "en" && value !== "it") fail(400, "Unsupported language");
      update[key] = value;
    } else if (typeof (settingsDefaults as any)[key] === "boolean") {
      if (typeof value !== "boolean") fail(400, `Invalid boolean: ${key}`);
      update[key] = value;
    } else if (key === "uploadMaxMb" && value === null) update[key] = null;
    else {
      const ranges: Record<string, [number, number]> = {
        uploadMaxMb: [
          1,
          Math.min(2048, Number(process.env.UPLOAD_MAX_MB || 100)),
        ],
        maxShareLifetimeHours: [0, 87600],
        defaultTokenLifetimeDays: [1, 365],
        maxTokenLifetimeDays: [1, 365],
        apiRequestsPerMinute: [1, 10000],
      };
      const [min, max] = ranges[key] || [1, 365];
      if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < min ||
        value > max
      )
        fail(400, `Invalid value: ${key}`);
      update[key] = value;
    }
  }
  const candidate = { ...(await getSettings()), ...update };
  if (candidate.defaultTokenLifetimeDays > candidate.maxTokenLifetimeDays)
    fail(400, "Default token lifetime exceeds the maximum");
  await Settings.findByIdAndUpdate(
    "workspace",
    { $set: update },
    {
      upsert: true,
      returnDocument: "after",
      runValidators: true,
      setDefaultsOnInsert: true,
    },
  );
  return json({ success: true, data: await getSettings() });
}
