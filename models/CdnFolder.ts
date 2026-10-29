import mongoose, { Schema, model, models, type Types } from "mongoose";

export interface CdnFolderDoc {
  _id: Types.ObjectId;
  /** URL-safe slug, e.g. "my-assets". Must be unique and not clash with built-ins. */
  slug: string;
  /** Human-readable display name */
  name: string;
  /** Optional description shown in the admin UI */
  description: string;
  /** User IDs the creator shared this folder (and the files inside) with. */
  allowedUsers: string[];
  /** private: creator, allowedUsers and admins; members: every member. */
  visibility: "private" | "members";
  /** Who created the folder */
  createdBy: string;
  /** Slug of the containing folder, null at the top level. */
  parent: string | null;
  /** Slugs of every containing folder, outermost first. */
  ancestors: string[];
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
    visibility: { type: String, enum: ["private", "members"], default: "private" },
    createdBy: { type: String, default: "" },
    parent: { type: String, default: null, index: true },
    ancestors: { type: [String], default: [], index: true },
  },
  { timestamps: true },
);

const CdnFolderModel =
  (models["CdnFolder"] as mongoose.Model<CdnFolderDoc>) ??
  model<CdnFolderDoc>("CdnFolder", cdnFolderSchema);

export default CdnFolderModel;
