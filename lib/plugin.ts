// Administration API for the Ervisio plugin. It is reachable only through the
// unix socket opened by scripts/start.mjs, which adds a per-process secret to
// every forwarded request; over the network these routes answer 404.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import connectDB from "@/lib/db/mongoose";
import { fail, json, readJson } from "@/lib/http";
import { membersRequest } from "@/lib/members";
import type { Actor } from "@/lib/policy";
import { storageUsage } from "@/lib/quota";
import { settingsRequest } from "@/lib/settings";
import { statsRequest } from "@/lib/stats";
import { storageRoot } from "@/lib/storage";
import { encryptionEnabled } from "@/lib/crypto-store";
import FileModel from "@/models/CdnFile";
import Member from "@/models/Member";

export const PLUGIN_HEADER = "x-ervisio-plugin";
const actor: Actor = { id: "ervisio-plugin", email: "", name: "Ervisio", role: "admin" };

/** Overrides written by the plugin; scripts/start.mjs applies them at boot. */
export const runtimeFile = () => path.join(storageRoot(), ".ervisio", "runtime.json");

function authorized(req: NextRequest) {
  const secret = process.env.PLUGIN_SOCKET_SECRET || "",
    given = req.headers.get(PLUGIN_HEADER) || "";
  return (
    secret.length >= 32 &&
    given.length === secret.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret))
  );
}

export function validPublicUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      (url.protocol === "http:" && !local) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/"
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function status() {
  await connectDB();
  const [usage, members, files] = await Promise.all([
    storageUsage(),
    Member.countDocuments(),
    FileModel.countDocuments(),
  ]);
  return json({
    success: true,
    data: {
      version: process.env.npm_package_version || process.env.APP_VERSION || null,
      publicUrl: process.env.NEXTAUTH_URL || null,
      trustProxy: process.env.TRUST_PROXY === "true",
      encryption: encryptionEnabled(),
      // Where a reverse proxy reaches the app: the published host port for a
      // proxy on the host, the container and its network for one in Docker.
      upstream: {
        host: process.env.BIND_ADDRESS || "127.0.0.1",
        port: Number(process.env.APP_PORT || 3000),
        container: process.env.HOSTNAME_ALIAS || "ervisiodrive-app",
        containerPort: Number(process.env.PORT || 3000),
        network: process.env.EDGE_NETWORK || "ervisiodrive_edge",
      },
      storage: usage,
      members,
      files,
    },
  });
}

async function publicUrl(req: NextRequest) {
  const body = await readJson(req);
  const url = validPublicUrl(body.url);
  if (!url) return fail(400, "Use an https:// address without a path");
  const trustProxy = body.trustProxy === undefined ? url.startsWith("https:") : body.trustProxy === true;
  const file = runtimeFile();
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(`${file}.tmp`, JSON.stringify({ publicUrl: url, trustProxy }, null, 2), { mode: 0o600 });
  await fs.rename(`${file}.tmp`, file);
  // Sign-in, origin checks and invitation links read these on every request.
  process.env.NEXTAUTH_URL = url;
  process.env.TRUST_PROXY = String(trustProxy);
  return json({ success: true, data: { publicUrl: url, trustProxy } });
}

export async function pluginRequest(req: NextRequest, segments: string[]) {
  if (!authorized(req)) return fail(404, "Not found");
  const [section, ...rest] = segments;
  if (section === "status" && req.method === "GET") return status();
  if (section === "settings") return settingsRequest(req, actor);
  if (section === "members") return membersRequest(req, actor);
  if (section === "stats") return statsRequest(req, rest, actor);
  if (section === "public-url" && req.method === "PUT") return publicUrl(req);
  return fail(404, "Not found");
}
