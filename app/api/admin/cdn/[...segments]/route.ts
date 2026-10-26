import { NextRequest } from "next/server";
import { currentActor } from "@/lib/auth";
import { driveRequest } from "@/lib/drive";
import { checkOrigin, errorResponse, fail } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handler(
  req: NextRequest,
  context: { params: Promise<{ segments: string[] }> },
) {
  try {
    const actor = await currentActor();
    if (!actor) return fail(401, "Accedi con un account autorizzato");
    checkOrigin(req);
    return await driveRequest(req, (await context.params).segments, actor);
  } catch (error) {
    return errorResponse(error);
  }
}
export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
};
