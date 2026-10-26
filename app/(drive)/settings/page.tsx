import { currentActor } from "@/lib/auth";
import { SettingsPanel } from "@/components/SettingsPanel";
export default async function SettingsPage() {
  return <SettingsPanel admin={(await currentActor())?.role === "admin"} />;
}
