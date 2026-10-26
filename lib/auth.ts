import { getServerSession, type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import CognitoProvider from "next-auth/providers/cognito";
import { authenticatePassword } from "@/lib/local-auth";
import connectDB from "@/lib/db/mongoose";
import Member from "@/models/Member";
import { normalizeEmail, validEmail, type Actor } from "@/lib/policy";
import {
  getSettings,
  settingsDefaults,
  cognitoConfigured,
  validCognitoIssuer,
} from "@/lib/settings";

type OidcProfile = {
  email?: unknown;
  email_verified?: unknown;
  sub?: unknown;
  name?: unknown;
};
export async function authorizeOidc(
  provider: "google" | "cognito",
  profile: OidcProfile,
) {
  const email = normalizeEmail(profile.email);
  if (
    profile.email_verified !== true ||
    !validEmail(email) ||
    typeof profile.sub !== "string" ||
    !profile.sub
  )
    return null;
  if (
    provider === "cognito" &&
    !validCognitoIssuer(process.env.COGNITO_ISSUER || "")
  )
    return null;
  await connectDB();
  const field = provider === "google" ? "googleSub" : "cognitoIdentity";
  const identity =
    provider === "google"
      ? profile.sub
      : `${process.env.COGNITO_ISSUER}#${profile.sub}`;
  // Only whitelisted accounts may sign in. Bootstrap is handled by the setup service.
  const member = await Member.findOneAndUpdate(
    { email, $or: [{ [field]: null }, { [field]: identity }] },
    {
      $set: {
        [field]: identity,
        name: String(profile.name || email),
        lastLogin: new Date(),
      },
    },
    { returnDocument: "after" },
  );
  return member;
}
export const authorizeGoogle = (profile: OidcProfile) =>
  authorizeOidc("google", profile);
export function buildAuthOptions(
  settings: typeof settingsDefaults,
): NextAuthOptions {
  return {
    secret: process.env.NEXTAUTH_SECRET,
    session: { strategy: "jwt", maxAge: 86400 },
    pages: { signIn: "/login", error: "/login" },
    providers: [
      CredentialsProvider({
        name: "Email and password",
        credentials: {
          email: { label: "Email", type: "email" },
          password: { label: "Password", type: "password" },
        },
        async authorize(credentials, req) {
          const ip =
            process.env.TRUST_PROXY === "true"
              ? String(req.headers?.["x-forwarded-for"] || "shared")
                  .split(",")[0]
                  .trim()
                  .slice(0, 64)
              : "shared";
          return authenticatePassword(
            credentials?.email,
            credentials?.password,
            ip,
          );
        },
      }),
      ...(settings.googleEnabled &&
      process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET
        ? [
            GoogleProvider({
              clientId: process.env.GOOGLE_CLIENT_ID,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET,
              authorization: {
                params: {
                  scope: "openid email profile",
                  prompt: "select_account",
                },
              },
              checks: ["pkce", "state", "nonce"],
            }),
          ]
        : []),
      ...(settings.cognitoEnabled &&
      cognitoConfigured() &&
      validCognitoIssuer(process.env.COGNITO_ISSUER || "")
        ? [
            CognitoProvider({
              issuer: process.env.COGNITO_ISSUER,
              clientId: process.env.COGNITO_CLIENT_ID!,
              clientSecret: process.env.COGNITO_CLIENT_SECRET || "",
              client: process.env.COGNITO_CLIENT_SECRET
                ? { token_endpoint_auth_method: "client_secret_basic" }
                : { token_endpoint_auth_method: "none" },
              authorization: {
                params: {
                  scope: "openid email profile",
                  response_type: "code",
                },
              },
              checks: ["pkce", "state", "nonce"],
            }),
          ]
        : []),
    ],
    callbacks: {
      async signIn({ account, profile, user }) {
        if (account?.provider === "credentials") return !!user?.id;
        if (
          !profile ||
          !["google", "cognito"].includes(account?.provider || "")
        )
          return false;
        return !!(await authorizeOidc(
          account!.provider as "google" | "cognito",
          profile as OidcProfile,
        ));
      },
      async jwt({ token, account, profile, user }) {
        if (
          account &&
          profile &&
          ["google", "cognito"].includes(account.provider)
        ) {
          const p = profile as { sub: string; email: string };
          const query =
            account.provider === "google"
              ? { googleSub: p.sub }
              : { cognitoIdentity: `${process.env.COGNITO_ISSUER}#${p.sub}` };
          const member = await Member.findOne({
            email: normalizeEmail(p.email),
            ...query,
          });
          token.memberId = member?._id.toString();
          token.memberVersion = member?.sessionVersion ?? 0;
        } else if (account?.provider === "credentials" && user) {
          token.memberId = user.id;
          token.memberVersion =
            (user as { sessionVersion?: number }).sessionVersion ?? 0;
        }
        return token;
      },
      async session({ session, token }) {
        session.memberId = String(token.memberId || "");
        session.memberVersion = Number(token.memberVersion ?? 0);
        return session;
      },
    },
  };
}
export const authOptions = buildAuthOptions(settingsDefaults);
export async function getAuthOptions() {
  return buildAuthOptions(await getSettings());
}
export async function currentActor(): Promise<Actor | null> {
  const session = await getServerSession(await getAuthOptions()),
    email = normalizeEmail(session?.user?.email);
  if (!email || !session?.memberId) return null;
  await connectDB();
  const member = await Member.findOne({
    _id: session.memberId,
    email,
    sessionVersion: session.memberVersion,
  });
  if (!member) return null;
  return {
    id: member._id.toString(),
    email,
    name: member.name || email,
    role: member.role,
  };
}
