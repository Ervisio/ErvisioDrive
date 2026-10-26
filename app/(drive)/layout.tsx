import { redirect } from "next/navigation";
import { currentActor } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
export const dynamic = "force-dynamic";
export default async function DriveLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  return <AppShell actor={actor}>{children}</AppShell>;
}
