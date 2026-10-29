import { NextRequest } from "next/server";
import { currentActor } from "@/lib/auth";
import { accessibleFile } from "@/lib/drive";
import FileModel from "@/models/CdnFile";
import { prepareFile } from "@/lib/serve-file";
import { fail, errorResponse } from "@/lib/http";
import { recordEvent } from "@/lib/events";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ folder: string; storedName: string }> },
) {
  try {
    const actor = await currentActor();
    if (!actor) return fail(401, "Sign-in required");
    const { folder, storedName } = await context.params;
    const match = await FileModel.findOne({ folder, storedName }).lean<any>();
    if (!match) return fail(404, "File not found");
    const file = await accessibleFile(actor, match._id.toString()),
      download = req.nextUrl.searchParams.get("download") === "1",
      prepared = await prepareFile(req, file, download);
    // Range requests continue a transfer already counted from its first byte.
    if (prepared.start === 0)
      await recordEvent(req, download ? "download" : "view", {
        actor,
        file,
        bytes: prepared.bytes,
      });
    return prepared.response();
  } catch (error) {
    return errorResponse(error);
  }
}
