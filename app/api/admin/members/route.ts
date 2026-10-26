import { NextRequest } from "next/server";
import { currentActor } from "@/lib/auth";
import { membersRequest } from "@/lib/members";
import { checkOrigin, errorResponse, fail, rateLimit } from "@/lib/http";
export const dynamic = "force-dynamic";
async function handler(req: NextRequest) {
  try {
    const actor = await currentActor();
    if (!actor) return fail(401, "Sign in with an authorized account");
    checkOrigin(req);
    if (req.method !== "GET") await rateLimit(`members:${actor.id}`, 30);
    return await membersRequest(req, actor);
  } catch (error) {
    return errorResponse(error);
  }
}
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
