import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import ShareModel from "@/models/CdnShareToken";
import FileModel from "@/models/CdnFile";
import Member from "@/models/Member";
import connectDB from "@/lib/db/mongoose";
import { fail, rateLimit } from "@/lib/http";
import { liveFilter } from "@/lib/drive";
import { prepareFile } from "@/lib/serve-file";

const form = (token: string, invalid = false) =>
  new NextResponse(
    `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Download protetto · ErvisioDrive</title><style>body{background:#0a0a0f;color:white;font:16px system-ui;display:grid;place-items:center;min-height:90vh}main{max-width:360px;padding:32px;background:#111118;border:1px solid #ffffff15;border-radius:16px}p{color:#aaa}input,button{box-sizing:border-box;width:100%;padding:12px;border-radius:8px;margin-top:12px}input{background:#1c1c28;border:1px solid #ffffff20;color:white}button{background:#f97316;border:0;font-weight:bold}</style><main><h1>Download protetto</h1><p>${invalid ? "Password non corretta." : "Inserisci la password per scaricare il file."}</p><form method="post" action="/api/download/${token}"><label>Password<input type="password" name="password" required autocomplete="off" maxlength="72"></label><button>Scarica file</button></form></main></html>`,
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

export async function publicDownload(req: NextRequest, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return fail(404, "Link non trovato");
  await connectDB();
  const share = await ShareModel.findOne({ token }).lean<any>();
  if (!share) return fail(404, "Link non trovato o revocato");
  if (share.expiresAt && new Date(share.expiresAt) <= new Date())
    return fail(410, "Link scaduto");
  if (share.maxDownloads !== null && share.downloadCount >= share.maxDownloads)
    return fail(410, "Limite di download raggiunto");
  if (!(await Member.exists({ _id: share.createdBy })))
    return fail(410, "Il creatore del link non è più autorizzato");
  const file = await FileModel.findOne({
    _id: share.fileId,
    ...liveFilter(),
  }).lean<any>();
  if (!file) return fail(410, "File rimosso o scaduto");
  if (share.password) {
    if (req.method === "GET") return form(token);
    const length = Number(req.headers.get("content-length"));
    if (!length || length > 1024) return fail(413, "Richiesta non valida");
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
      return form(token, true);
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
    return fail(410, "Link scaduto, revocato o limite raggiunto");
  }
  return prepared.response();
}
