import { NextRequest } from "next/server";
import { v1Request } from "@/lib/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handler(
  req: NextRequest,
  context: { params: Promise<{ segments: string[] }> },
) {
  return v1Request(req, (await context.params).segments);
}
export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
};
