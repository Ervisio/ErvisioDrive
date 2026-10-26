import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/db/mongoose";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};
export const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export function checkOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const expected = new URL(process.env.NEXTAUTH_URL || req.url).origin;
  if (req.headers.get("origin") !== expected)
    fail(403, "Origine della richiesta non valida");
}
export async function readJson(req: NextRequest, max = 32 * 1024) {
  const reader = req.body?.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  if (!reader) return fail(400, "Corpo della richiesta mancante");
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      return fail(413, "Richiesta troppo grande");
    }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    const value = JSON.parse(text);
    if (!value || Array.isArray(value) || typeof value !== "object")
      throw new Error();
    return value;
  } catch {
    return fail(400, "JSON non valido");
  }
}
export async function rateLimit(key: string, limit: number, seconds = 60) {
  await connectDB();
  const bucket = Math.floor(Date.now() / (seconds * 1000));
  const coll = mongoose.connection.collection("driveratelimits");
  const counter = await coll.findOneAndUpdate(
    { _id: `${key}:${bucket}` as never },
    {
      $inc: { count: 1 },
      $setOnInsert: { expiresAt: new Date((bucket + 2) * seconds * 1000) },
    },
    { upsert: true, returnDocument: "after" },
  );
  if ((counter?.count ?? 0) > limit)
    fail(429, "Troppe richieste. Riprova tra poco.");
}
export function errorResponse(error: unknown) {
  if (error instanceof HttpError)
    return json({ success: false, error: error.message }, error.status);
  if (
    error instanceof mongoose.Error.ValidationError ||
    error instanceof mongoose.Error.CastError ||
    error instanceof SyntaxError
  )
    return json({ success: false, error: "Dati non validi" }, 400);
  if ((error as { code?: number })?.code === 11000)
    return json({ success: false, error: "Elemento già presente" }, 409);
  console.error(
    "Drive request failed:",
    error instanceof Error ? error.message : "unknown",
  );
  return json({ success: false, error: "Errore del servizio" }, 500);
}
