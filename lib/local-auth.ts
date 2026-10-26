import { type NextRequest } from "next/server";
import Member from "@/models/Member";
import connectDB from "@/lib/db/mongoose";
import { normalizeEmail } from "@/lib/policy";
import {
  hashPassword,
  verifyPassword,
  tokenDigest,
  validatePassword,
} from "@/lib/passwords";
import { fail, json, readJson, rateLimit } from "@/lib/http";

export async function authenticatePassword(
  emailValue: unknown,
  passwordValue: unknown,
  ip = "shared",
) {
  const email = normalizeEmail(emailValue),
    password = typeof passwordValue === "string" ? passwordValue : "";
  await connectDB();
  await rateLimit("login:global", 60, 60);
  await rateLimit(`login:ip:${tokenDigest(ip)}`, 15, 60);
  await rateLimit(`login:email:${tokenDigest(email)}`, 8, 300);
  const member = await Member.findOne({ email }).select("+passwordHash");
  const valid = await verifyPassword(password, member?.passwordHash);
  if (!member || !valid) return null;
  member.lastLogin = new Date();
  await member.save();
  return {
    id: member._id.toString(),
    email: member.email,
    name: member.name || member.email,
    sessionVersion: member.sessionVersion,
  };
}
export async function activateAccount(req: NextRequest) {
  await connectDB();
  await rateLimit("activate:global", 20, 60);
  const body = await readJson(req);
  if (typeof body.token !== "string" || !/^[a-f0-9]{64}$/.test(body.token))
    return fail(400, "Invitation is invalid or expired");
  validatePassword(body.password);
  const hash = tokenDigest(body.token);
  if (
    !(await Member.exists({
      inviteHash: hash,
      inviteExpiresAt: { $gt: new Date() },
    }))
  )
    return fail(400, "Invitation is invalid or expired");
  const passwordHash = await hashPassword(body.password);
  // Single atomic consume prevents replay and invalidates all existing sessions.
  const member = await Member.findOneAndUpdate(
    { inviteHash: hash, inviteExpiresAt: { $gt: new Date() } },
    {
      $set: { passwordHash },
      $unset: { inviteHash: 1, inviteExpiresAt: 1 },
      $inc: { sessionVersion: 1 },
    },
    { returnDocument: "after" },
  );
  if (!member) return fail(400, "Invitation has already been used or expired");
  return json({ success: true });
}
