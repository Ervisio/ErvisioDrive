import mongoose, { Schema } from "mongoose";
const schema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    role: {
      type: String,
      enum: ["admin", "member"],
      default: "member",
      required: true,
    },
    isOwner: { type: Boolean, default: false },
    name: { type: String, default: "" },
    googleSub: { type: String, default: null },
    cognitoIdentity: { type: String, default: null },
    passwordHash: { type: String, default: null, select: false },
    inviteHash: { type: String, default: null, select: false },
    inviteExpiresAt: { type: Date, default: null },
    sessionVersion: { type: Number, default: 0 },
    lastLogin: { type: Date, default: null },
    // Storage quota override in GiB; null uses the workspace default, 0 is unlimited.
    quotaGb: { type: Number, default: null },
  },
  { timestamps: true },
);
export default mongoose.models.DriveMember ||
  mongoose.model("DriveMember", schema);
