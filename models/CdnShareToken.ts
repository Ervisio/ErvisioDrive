import mongoose, { Schema, model, models, type Types } from "mongoose";

export interface CdnShareTokenDoc {
  _id: Types.ObjectId;
  fileId: string;
  /** Unique token used in the share URL */
  token: string;
  /** bcrypt hash of optional password, or null for public link */
  password: string | null;
  /** Link expiry; null = never expires */
  expiresAt: Date | null;
  /** Max number of downloads; null = unlimited */
  maxDownloads: number | null;
  /** How many times the link has been downloaded */
  downloadCount: number;
  createdBy: string;
  createdAt: Date;
}

const cdnShareTokenSchema = new Schema<CdnShareTokenDoc>(
  {
    fileId: { type: String, required: true, index: true },
    token: { type: String, required: true, unique: true },
    password: { type: String, default: null },
    expiresAt: { type: Date, default: null },
    maxDownloads: { type: Number, default: null },
    downloadCount: { type: Number, default: 0 },
    createdBy: { type: String, default: "" },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: { virtuals: false },
    toObject: { virtuals: false },
  },
);

const CdnShareTokenModel =
  (models["CdnShareToken"] as mongoose.Model<CdnShareTokenDoc>) ??
  model<CdnShareTokenDoc>("CdnShareToken", cdnShareTokenSchema);

export default CdnShareTokenModel;
