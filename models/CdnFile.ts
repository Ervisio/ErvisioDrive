import mongoose, { Schema, model, models, type Types } from "mongoose";
import type { Encryption } from "@/lib/crypto-store";

export interface CdnFileDoc {
  _id: Types.ObjectId;
  /** User-facing display name (e.g. "banner.png") */
  name: string;
  /** Actual filename stored on disk (unique, collision-safe) */
  storedName: string;
  /** Virtual folder slug: images | videos | audio | documents | other | <custom> */
  folder: string;
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** Authenticated content URL */
  url: string;
  /** User _id who uploaded */
  uploadedBy: string;
  /** ISO string username for display */
  uploadedByUsername: string;
  /** Optional auto-deletion timestamp */
  expiresAt: Date | null;
  /** User IDs the owner shared this file with. */
  allowedUsers: string[];
  /** private: owner, people in allowedUsers and admins; members: every member. */
  visibility: "private" | "members";
  /** Encryption at rest; null for files written before encryption was enabled. */
  encryption: Encryption | null;
  createdAt: Date;
  updatedAt: Date;
}

const cdnFileSchema = new Schema<CdnFileDoc>(
  {
    name: { type: String, required: true, trim: true },
    storedName: { type: String, required: true, unique: true },
    folder: { type: String, required: true, default: "other" },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true, default: 0 },
    url: { type: String, required: true },
    uploadedBy: { type: String, default: "" },
    uploadedByUsername: { type: String, default: "" },
    expiresAt: { type: Date, default: null },
    allowedUsers: { type: [String], default: [] },
    visibility: { type: String, enum: ["private", "members"], default: "private" },
    encryption: { type: Schema.Types.Mixed, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: false },
    toObject: { virtuals: false },
  },
);

const CdnFileModel =
  (models["CdnFile"] as mongoose.Model<CdnFileDoc>) ??
  model<CdnFileDoc>("CdnFile", cdnFileSchema);

export default CdnFileModel;
