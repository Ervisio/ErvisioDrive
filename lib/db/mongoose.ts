import mongoose from "mongoose";
declare global {
  var driveConnection: Promise<typeof mongoose> | undefined;
}
export default async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not configured");
  if (!global.driveConnection)
    global.driveConnection = mongoose.connect(uri, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 5000,
    });
  try {
    return await global.driveConnection;
  } catch (error) {
    global.driveConnection = undefined;
    throw error;
  }
}
