import { currentActor } from "@/lib/auth";
import { redirect } from "next/navigation";
import { MemberManager } from "@/components/MemberManager";
export default async function AdminPage() {
  const actor = await currentActor();
  if (actor?.role !== "admin") redirect("/");
  return <MemberManager />;
}
