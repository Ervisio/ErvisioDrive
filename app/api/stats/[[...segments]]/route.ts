import { NextRequest } from "next/server";
import { currentActor } from "@/lib/auth";
import { statsRequest } from "@/lib/stats";
import { errorResponse, fail } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ segments?: string[] }> },
) {
  try {
    const actor = await currentActor();
    if (!actor) return fail(401, "Sign-in required");
    return await statsRequest(req, (await context.params).segments || [], actor);
  } catch (error) {
    return errorResponse(error);
  }
}
