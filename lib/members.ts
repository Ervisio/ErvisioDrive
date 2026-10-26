import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { newInvitation } from "@/lib/passwords";
import Member from "@/models/Member";
import ShareModel from "@/models/CdnShareToken";
import { type Actor, normalizeEmail, validEmail } from "@/lib/policy";
import { fail, json, readJson } from "@/lib/http";
import connectDB from "@/lib/db/mongoose";

export async function membersRequest(req: NextRequest, actor: Actor) {
  if (actor.role !== "admin")
    return fail(403, "Solo gli amministratori possono gestire la whitelist");
  await connectDB();
  if (req.method === "GET")
    return json({
      success: true,
      data: await Member.find()
        .select("email name role isOwner lastLogin createdAt")
        .sort({ createdAt: 1 })
        .lean(),
    });
  const body = await readJson(req);
  if (req.method === "POST") {
    const email = normalizeEmail(body.email);
    if (!validEmail(email)) return fail(400, "Indirizzo email non valido");
    if (body.role && !["admin", "member"].includes(body.role))
      return fail(400, "Ruolo non valido");
    const invitation = newInvitation();
    const member = await Member.create({
      email,
      role: body.role || "member",
      inviteHash: invitation.inviteHash,
      inviteExpiresAt: invitation.inviteExpiresAt,
    });
    return json(
      {
        success: true,
        data: { _id: member._id, email: member.email, role: member.role },
        invitation: `${process.env.NEXTAUTH_URL}/activate#${invitation.token}`,
      },
      201,
    );
  }
  if (!mongoose.isValidObjectId(body.id))
    return fail(400, "Identificativo non valido");
  const member = await Member.findById(body.id);
  if (!member) return fail(404, "Utente non trovato");
  // An immutable owner keeps an administrative recovery account even during concurrent changes.
  if (req.method === "POST") return fail(405, "Metodo non consentito");
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
  if (member.isOwner)
    return fail(
      409,
      "L’account proprietario non può essere rimosso o declassato dal pannello",
    );
  if (req.method === "PATCH") {
    if (!["admin", "member"].includes(body.role))
      return fail(400, "Ruolo non valido");
    await Member.updateOne(
      { _id: body.id, isOwner: { $ne: true } },
      { $set: { role: body.role } },
    );
  } else if (req.method === "DELETE") {
    await Member.deleteOne({ _id: body.id, isOwner: { $ne: true } });
    await ShareModel.deleteMany({ createdBy: body.id });
  } else return fail(405, "Metodo non consentito");
  return json({ success: true });
}
