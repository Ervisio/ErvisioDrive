import { currentActor } from "@/lib/auth";
import { storageUsage } from "@/lib/quota";
import { fail, json, errorResponse } from "@/lib/http";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    if (!(await currentActor())) return fail(401, "Accesso richiesto");
    return json({ success: true, data: await storageUsage() });
  } catch (error) {
    return errorResponse(error);
  }
}
