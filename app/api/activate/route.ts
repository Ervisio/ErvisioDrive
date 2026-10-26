import { NextRequest } from "next/server";
import { activateAccount } from "@/lib/local-auth";
import { checkOrigin, errorResponse } from "@/lib/http";
export async function POST(req: NextRequest) {
  try {
    checkOrigin(req);
    return await activateAccount(req);
  } catch (error) {
    return errorResponse(error);
  }
}
