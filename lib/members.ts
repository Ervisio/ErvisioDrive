import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { newInvitation } from "@/lib/passwords";
import Member from "@/models/Member";
import ApiToken from "@/models/ApiToken";
import ShareModel from "@/models/CdnShareToken";
import { type Actor, normalizeEmail, validEmail } from "@/lib/policy";
import { fail, json, readJson } from "@/lib/http";
import connectDB from "@/lib/db/mongoose";

export async function membersRequest(req: NextRequest, actor: Actor) {
  if (actor.role !== "admin")
    return fail(403, "Only administrators can manage the whitelist");
  await connectDB();
  if (req.method === "GET")
    return json({
      success: true,
      data: await Member.find()
        .select("email name role isOwner quotaGb lastLogin createdAt")
        .sort({ createdAt: 1 })
        .lean(),
    });
  const body = await readJson(req);
  if (req.method === "POST") {
    const email = normalizeEmail(body.email);
    if (!validEmail(email)) return fail(400, "Invalid email address");
    if (body.role && !["admin", "member"].includes(body.role))
      return fail(400, "Invalid role");
    const invitation = body.issueInvitation === false ? null : newInvitation();
    const member = await Member.create({
      email,
      role: body.role || "member",
      ...(invitation
        ? {
            inviteHash: invitation.inviteHash,
            inviteExpiresAt: invitation.inviteExpiresAt,
          }
        : {}),
    });
    return json(
      {
        success: true,
        data: { _id: member._id, email: member.email, role: member.role },
        ...(invitation
          ? {
              invitation: `${process.env.NEXTAUTH_URL}/activate#${invitation.token}`,
            }
          : {}),
      },
      201,
    );
  }
  if (!mongoose.isValidObjectId(body.id))
    return fail(400, "Invalid identifier");
  const member = await Member.findById(body.id);
  if (!member) return fail(404, "User not found");
  // An immutable owner keeps an administrative recovery account even during concurrent changes.
  if (req.method === "POST") return fail(405, "Method not allowed");
  if (body.action === "invite" && req.method === "PATCH") {
    const invitation = newInvitation();
    await Member.updateOne(
      { _id: body.id },
      {
        $set: {
          inviteHash: invitation.inviteHash,
          inviteExpiresAt: invitation.inviteExpiresAt,
        },
      },
    );
    return json({
      success: true,
      invitation: `${process.env.NEXTAUTH_URL}/activate#${invitation.token}`,
    });
  }
  // A personal quota applies to everyone, the owner included: null follows the
  // workspace default, 0 is unlimited.
  if (req.method === "PATCH" && "quotaGb" in body && body.role === undefined) {
    const quota = body.quotaGb;
    if (quota !== null && !(typeof quota === "number" && Number.isFinite(quota) && quota >= 0))
      return fail(400, "Invalid quota");
    await Member.updateOne({ _id: body.id }, { $set: { quotaGb: quota } });
    return json({ success: true });
  }
  if (member.isOwner)
    return fail(
      409,
      "The owner account cannot be removed or demoted from the panel",
    );
  if (req.method === "PATCH") {
    if (!["admin", "member"].includes(body.role))
      return fail(400, "Invalid role");
    await Member.updateOne(
      { _id: body.id, isOwner: { $ne: true } },
      { $set: { role: body.role } },
    );
  } else if (req.method === "DELETE") {
    await Member.deleteOne({ _id: body.id, isOwner: { $ne: true } });
    await ShareModel.deleteMany({ createdBy: body.id });
    await ApiToken.updateMany(
      { ownerId: body.id, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
  } else return fail(405, "Method not allowed");
  return json({ success: true });
}
