import { NextRequest } from "next/server";
import { publicDownload } from "@/lib/download";
import { checkOrigin, errorResponse } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handler(
  req: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  try {
    checkOrigin(req);
    return await publicDownload(req, (await context.params).token);
  } catch (error) {
    return errorResponse(error);
  }
}
export { handler as GET, handler as POST };
