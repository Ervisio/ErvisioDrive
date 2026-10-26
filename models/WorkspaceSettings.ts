import mongoose, { Schema } from "mongoose";
const schema = new Schema(
  {
    _id: { type: String, default: "workspace" },
    siteName: { type: String, default: "ErvisioDrive", maxlength: 60 },
    defaultLocale: { type: String, enum: ["en", "it"], default: "en" },
    uploadMaxMb: { type: Number, default: null },
    sharingEnabled: { type: Boolean, default: true },
    maxShareLifetimeHours: { type: Number, default: 0 },
    apiEnabled: { type: Boolean, default: true },
    membersCanCreateTokens: { type: Boolean, default: true },
    defaultTokenLifetimeDays: { type: Number, default: 30 },
    maxTokenLifetimeDays: { type: Number, default: 365 },
    apiRequestsPerMinute: { type: Number, default: 120 },
    googleEnabled: { type: Boolean, default: true },
    cognitoEnabled: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export default mongoose.models.WorkspaceSettings ||
  mongoose.model("WorkspaceSettings", schema);
