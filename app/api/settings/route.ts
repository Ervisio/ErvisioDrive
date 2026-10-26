import { NextRequest } from "next/server";
import { currentActor } from "@/lib/auth";
import { settingsRequest } from "@/lib/settings";
import { checkOrigin, errorResponse, fail } from "@/lib/http";
export const dynamic = "force-dynamic";
async function handler(req: NextRequest) {
  try {
    const actor = await currentActor();
    if (!actor) return fail(401, "Sign in required");
    checkOrigin(req);
    return await settingsRequest(req, actor);
  } catch (error) {
    return errorResponse(error);
  }
}
export { handler as GET, handler as PATCH };
