import fs from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { filePath } from "@/lib/storage";
import { fail } from "@/lib/http";

export async function prepareFile(
  req: NextRequest,
  file: { folder: string; storedName: string; name: string; mimeType: string },
  attachment = false,
) {
  const handle = await fs
    .open(filePath(file.folder, file.storedName), "r")
    .catch(() => fail(404, "File not found on disk"));
  const stat = await handle.stat(),
    range = req.headers.get("range");
  let start = 0,
    end = stat.size - 1,
    status = 200;
  if (range && stat.size > 0) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      await handle.close();
      return fail(416, "Invalid byte range");
    }
    if (!match[1]) start = Math.max(0, stat.size - Number(match[2]));
    else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    }
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= stat.size
    ) {
      await handle.close();
      return fail(416, "Invalid byte range");
    }
    status = 206;
  }
  const safeInline =
    /^(image\/(png|jpeg|gif|webp|avif|bmp|x-icon)|video\/(mp4|webm|ogg)|audio\/[a-z0-9.+-]+|application\/pdf)$/i.test(
      file.mimeType,
    );
  const type = safeInline ? file.mimeType : "application/octet-stream";
  const disposition = attachment || !safeInline ? "attachment" : "inline";
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Content-Length": String(Math.max(0, end - start + 1)),
    "Content-Disposition": `${disposition}; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "sandbox; default-src 'none'; frame-ancestors 'none'",
  };
  if (status === 206)
    headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
  return {
    close: () => handle.close(),
    response: () => {
      if (stat.size === 0) {
        void handle.close();
        return new NextResponse(null, { status, headers });
      }
      const stream = handle.createReadStream({ start, end, autoClose: true });
      req.signal.addEventListener("abort", () => stream.destroy(), {
        once: true,
      });
      return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
        status,
        headers,
      });
    },
  };
}
