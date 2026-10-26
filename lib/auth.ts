import { getServerSession, type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { authenticatePassword } from "@/lib/local-auth";
import GoogleProvider from "next-auth/providers/google";
import connectDB from "@/lib/db/mongoose";
import Member from "@/models/Member";
import { normalizeEmail, validEmail, type Actor } from "@/lib/policy";

export async function authorizeGoogle(profile: {
  email?: unknown;
  email_verified?: unknown;
  sub?: unknown;
  name?: unknown;
}) {
  const email = normalizeEmail(profile.email);
  if (
    profile.email_verified !== true ||
    !validEmail(email) ||
    typeof profile.sub !== "string" ||
    !profile.sub
  )
    return null;
  await connectDB();
  let member = await Member.findOne({ email });
  if (!member && email === normalizeEmail(process.env.BOOTSTRAP_ADMIN_EMAIL)) {
    // A fixed document key serializes first-admin creation across processes.
    const boot = await Member.db
      .collection("drivebootstrap")
      .findOneAndUpdate(
        { _id: "initial-admin" as never },
        { $setOnInsert: { email } },
        { upsert: true, returnDocument: "before" },
      );
    if (!boot && (await Member.countDocuments()) === 0) {
      member = await Member.create({
        email,
        role: "admin",
        isOwner: true,
        googleSub: profile.sub,
        name: String(profile.name || email),
      });
    }
  }
  if (!member || (member.googleSub && member.googleSub !== profile.sub))
    return null;
  member.googleSub = profile.sub;
  member.name = String(profile.name || email);
  member.lastLogin = new Date();
  await member.save();
  return member;
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 },
  pages: { signIn: "/login", error: "/login" },
  providers: [
    CredentialsProvider({
      name: "Email e password",
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
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID || "",
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
            authorization: {
              params: {
                scope: "openid email profile",
                prompt: "select_account",
              },
            },
            checks: ["pkce", "state"],
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ account, profile, user }) {
      if (account?.provider === "credentials") return !!user?.id;
      if (account?.provider !== "google" || !profile) return false;
      return !!(await authorizeGoogle(profile as never));
    },
    async jwt({ token, account, profile, user }) {
      if (account?.provider === "google" && profile) {
        const p = profile as { sub: string; email: string };
        const member = await Member.findOne({
          email: normalizeEmail(p.email),
          googleSub: p.sub,
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
export async function currentActor(): Promise<Actor | null> {
  const session = await getServerSession(authOptions);
  const email = normalizeEmail(session?.user?.email);
  if (!email) return null;
  await connectDB();
  // Recheck on every request: removing an email revokes existing sessions immediately.
  const member = session?.memberId
    ? await Member.findOne({
        _id: session.memberId,
        email,
        sessionVersion: session.memberVersion,
      })
    : null;
  if (!member) return null;
  return {
    id: member._id.toString(),
    email,
    name: member.name || email,
    role: member.role,
  };
}
