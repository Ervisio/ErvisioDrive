import { cookies } from "next/headers";
import { getSettings } from "@/lib/settings";
import type { Locale } from "./core";
export async function getLocale(): Promise<Locale> {
  const cookie = (await cookies()).get("drive-locale")?.value;
  if (cookie === "en" || cookie === "it") return cookie;
  try {
    return (await getSettings()).defaultLocale;
  } catch {
    return "en";
  }
}
