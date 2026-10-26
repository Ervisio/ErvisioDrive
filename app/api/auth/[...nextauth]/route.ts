import NextAuth from "next-auth";
import { NextRequest } from "next/server";
import { getAuthOptions } from "@/lib/auth";
export const dynamic = "force-dynamic";
async function handler(
  req: NextRequest,
  context: { params: Promise<{ nextauth: string[] }> },
) {
  return NextAuth(await getAuthOptions())(req, context);
}
export { handler as GET, handler as POST };
