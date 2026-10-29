import { currentActor } from "@/lib/auth";
import { Stats } from "@/components/Stats";
export default async function StatsPage() {
  return <Stats admin={(await currentActor())?.role === "admin"} />;
}
