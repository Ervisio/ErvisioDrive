import { NextRequest, NextResponse } from "next/server";
import { translate, type Locale } from "@/lib/i18n/core";
import { getSettings } from "@/lib/settings";
import bcrypt from "bcryptjs";
import ShareModel from "@/models/CdnShareToken";
import FileModel from "@/models/CdnFile";
import Member from "@/models/Member";
import connectDB from "@/lib/db/mongoose";
import { fail, rateLimit } from "@/lib/http";
import { liveFilter } from "@/lib/drive";
import { prepareFile } from "@/lib/serve-file";

const form = (token: string, locale: Locale, invalid = false) => {
  const t = (key: string) => translate(locale, key);
  return new NextResponse(
    `<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t("Protected download")} · ErvisioDrive</title><style>*{box-sizing:border-box}body{margin:0;background:#0a0a0f;color:white;font:16px system-ui;display:grid;place-items:center;min-height:100dvh;padding:16px}main{width:100%;max-width:380px;padding:28px;background:#111118;border:1px solid #ffffff15;border-radius:16px}p{color:#aaa;line-height:1.5}input,button{width:100%;padding:12px;border-radius:8px;margin-top:12px;min-height:44px;font-size:16px}input{background:#1c1c28;border:1px solid #ffffff20;color:white}button{background:#f97316;border:0;font-weight:bold}nav{display:flex;justify-content:flex-end;gap:16px}a{color:#fb923c;padding:10px 0;font-size:13px}</style><main><nav><a href="?lang=en">English</a><a href="?lang=it">Italiano</a></nav><h1>${t("Protected download")}</h1><p>${t(invalid ? "Incorrect password." : "Enter the password to download this file.")}</p><form method="post" action="/api/download/${token}?lang=${locale}"><label>Password<input type="password" name="password" required autocomplete="off" maxlength="72"></label><button>${t("Download file")}</button></form></main></html>`,
    {
      status: 401,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      },
    },
  );
};

export async function publicDownload(req: NextRequest, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return fail(404, "Link not found");
  await connectDB();
  const settings = await getSettings();
  if (!settings.sharingEnabled) fail(403, "Public sharing is disabled");
  const language =
    req.nextUrl.searchParams.get("lang") ||
    req.cookies.get("drive-locale")?.value;
  const locale: Locale =
    language === "it"
      ? "it"
      : language === "en"
        ? "en"
        : settings.defaultLocale;
  const share = await ShareModel.findOne({ token }).lean<any>();
  if (!share) return fail(404, "Link not found or revoked");
  if (share.expiresAt && new Date(share.expiresAt) <= new Date())
    return fail(410, "Link expired");
  if (share.maxDownloads !== null && share.downloadCount >= share.maxDownloads)
    return fail(410, "Download limit reached");
  if (!(await Member.exists({ _id: share.createdBy })))
    return fail(410, "The link creator is no longer authorized");
  const file = await FileModel.findOne({
    _id: share.fileId,
    ...liveFilter(),
  }).lean<any>();
  if (!file) return fail(410, "File removed or expired");
  if (share.password) {
    if (req.method === "GET") return form(token, locale);
    const length = Number(req.headers.get("content-length"));
    if (!length || length > 1024) return fail(413, "Invalid request");
    const ip =
      process.env.TRUST_PROXY === "true"
        ? (req.headers.get("x-forwarded-for") || "")
            .split(",")[0]
            .trim()
            .slice(0, 64)
        : "shared";
    await rateLimit(`password:${token}:${ip}`, 10, 60);
    const provided = String((await req.formData()).get("password") || "");
    if (
      Buffer.byteLength(provided) > 72 ||
      !(await bcrypt.compare(provided, share.password))
    )
      return form(token, locale, true);
  }
  const prepared = await prepareFile(req, file, true);
  // Reserve atomically; simultaneous requests cannot exceed maxDownloads.
  const reserved = await ShareModel.findOneAndUpdate(
    {
      token,
      ...liveFilter(),
      $expr: {
        $or: [
          { $eq: ["$maxDownloads", null] },
          { $lt: ["$downloadCount", "$maxDownloads"] },
        ],
      },
    },
    { $inc: { downloadCount: 1 } },
  );
  if (!reserved) {
    await prepared.close();
    return fail(410, "Link expired, revoked or download limit reached");
  }
  return prepared.response();
}
