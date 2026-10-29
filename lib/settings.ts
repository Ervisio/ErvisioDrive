import { NextRequest } from "next/server";
import Settings from "@/models/WorkspaceSettings";
import connectDB from "@/lib/db/mongoose";
import { requirePermission } from "@/lib/permissions";
import type { Actor } from "@/lib/policy";
import { fail, json, readJson } from "@/lib/http";

// Limits: null means "use the environment value", 0 means unlimited.
export const settingsDefaults = {
  siteName: "ErvisioDrive",
  defaultLocale: "en" as "en" | "it",
  uploadMaxMb: null as number | null,
  storageQuotaGb: null as number | null,
  userQuotaGb: 0,
  maxFilesPerUpload: 0,
  editorMaxMb: 10,
  sharingEnabled: true,
  maxShareLifetimeHours: 0,
  apiEnabled: true,
  membersCanCreateTokens: true,
  defaultTokenLifetimeDays: 30,
  maxTokenLifetimeDays: 365,
  apiRequestsPerMinute: 120,
  writeRequestsPerMinute: 0,
  statsRetentionDays: 365,
  googleEnabled: true,
  cognitoEnabled: true,
};
/** Settings that fall back to an environment variable when null. */
const ENV_BACKED = new Set(["uploadMaxMb", "storageQuotaGb"]);
/** Settings that accept fractions (sizes in GiB). */
const FRACTIONAL = new Set(["storageQuotaGb", "userQuotaGb", "uploadMaxMb", "editorMaxMb"]);
/** Settings where 0 is not meaningful. */
const POSITIVE = new Set(["defaultTokenLifetimeDays", "maxTokenLifetimeDays"]);

const MB = 1024 * 1024;
/** Upload limit from UPLOAD_MAX_MB; 0 means unlimited. */
export function envUploadMaxMb() {
  const mb = Number(process.env.UPLOAD_MAX_MB ?? 100);
  if (!Number.isFinite(mb) || mb < 0) throw new Error("Invalid UPLOAD_MAX_MB");
  return mb;
}
const toBytes = (mb: number) => (mb === 0 ? Infinity : Math.floor(mb * MB));
export async function uploadMaxBytes() {
  const { uploadMaxMb } = await getSettings();
  return toBytes(uploadMaxMb ?? envUploadMaxMb());
}
export async function editorMaxBytes() {
  return toBytes((await getSettings()).editorMaxMb);
}
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
        uploadMaxMb: envUploadMaxMb(),
        quotaGb: Number(process.env.STORAGE_QUOTA_GB ?? 100),
        encryption: !!process.env.STORAGE_ENCRYPTION_KEY,
        trustProxy: process.env.TRUST_PROXY === "true",
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
  if (Object.keys(body).some((k) => !Object.hasOwn(settingsDefaults, k)))
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
    } else if (ENV_BACKED.has(key) && value === null) update[key] = null;
    else {
      const integer = !FRACTIONAL.has(key),
        min = POSITIVE.has(key) ? 1 : 0;
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < min ||
        value > Number.MAX_SAFE_INTEGER ||
        (integer && !Number.isInteger(value))
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
