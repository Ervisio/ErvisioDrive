import mongoose, { Schema } from "mongoose";
const schema = new Schema(
  {
    name: { type: String, required: true, maxlength: 80 },
    ownerId: { type: String, required: true, index: true },
    secretHash: { type: String, required: true, unique: true, select: false },
    prefix: { type: String, required: true },
    scopes: { type: [String], required: true },
    resourceMode: { type: String, enum: ["all", "selected"], default: "all" },
    fileIds: { type: [String], default: [] },
    folderSlugs: { type: [String], default: [] },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: null },
    createdBy: { type: String, required: true },
    ancestorIds: { type: [String], default: [] },
  },
  { timestamps: true },
);
export default mongoose.models.ApiToken || mongoose.model("ApiToken", schema);
