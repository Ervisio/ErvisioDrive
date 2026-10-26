import { Login } from "@/components/Login";
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <Login
      googleEnabled={
        !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
      }
      error={!!(await searchParams).error}
    />
  );
}
