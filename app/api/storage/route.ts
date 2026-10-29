import { currentActor } from "@/lib/auth";
import { storageUsage } from "@/lib/quota";
import { fail, json, errorResponse } from "@/lib/http";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const actor = await currentActor();
    if (!actor) return fail(401, "Sign-in required");
    return json({ success: true, data: await storageUsage(actor.id) });
  } catch (error) {
    return errorResponse(error);
  }
}
