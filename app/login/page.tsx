import { getSettings, cognitoConfigured } from "@/lib/settings";
import { Login } from "@/components/Login";
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const settings = await getSettings();
  return (
    <Login
      googleEnabled={
        !!(
          settings.googleEnabled &&
          process.env.GOOGLE_CLIENT_ID &&
          process.env.GOOGLE_CLIENT_SECRET
        )
      }
      cognitoEnabled={settings.cognitoEnabled && cognitoConfigured()}
      error={!!(await searchParams).error}
    />
  );
}
