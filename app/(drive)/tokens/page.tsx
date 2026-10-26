import { currentActor } from "@/lib/auth";
import { TokenManager } from "@/components/TokenManager";
export default async function TokensPage() {
  return <TokenManager admin={(await currentActor())?.role === "admin"} />;
}
