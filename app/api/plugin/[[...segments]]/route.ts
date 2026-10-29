import { NextRequest } from "next/server";
import { pluginRequest } from "@/lib/plugin";
import { errorResponse } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handler(
  req: NextRequest,
  context: { params: Promise<{ segments?: string[] }> },
) {
  try {
    return await pluginRequest(req, (await context.params).segments || []);
  } catch (error) {
    return errorResponse(error);
  }
}
export { handler as GET, handler as PATCH, handler as PUT, handler as POST, handler as DELETE };
