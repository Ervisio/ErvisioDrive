import mongoose, { Schema, model, models, type Types } from "mongoose";

export interface CdnFolderDoc {
  _id: Types.ObjectId;
  /** URL-safe slug, e.g. "my-assets". Must be unique and not clash with built-ins. */
  slug: string;
  /** Human-readable display name */
  name: string;
  /** Optional description shown in the admin UI */
  description: string;
  /**
   * User IDs that can access this folder (and all files inside it) via the
   * drive. Empty array means accessible to all currently whitelisted members.
   */
  allowedUsers: string[];
  /** Who created the folder */
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Slugs reserved for auto-detected MIME folders — cannot be created as custom folders */
export const BUILTIN_FOLDER_SLUGS = [
  "images",
  "videos",
  "audio",
  "documents",
  "other",
] as const;

const cdnFolderSchema = new Schema<CdnFolderDoc>(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, default: "", trim: true, maxlength: 300 },
    allowedUsers: { type: [String], default: [] },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true },
);

const CdnFolderModel =
  (models["CdnFolder"] as mongoose.Model<CdnFolderDoc>) ??
  model<CdnFolderDoc>("CdnFolder", cdnFolderSchema);

export default CdnFolderModel;
