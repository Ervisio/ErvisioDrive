import path from "path";
import crypto from "crypto";

/** Determine storage folder from MIME type */
export function mimeToFolder(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "images";
  if (mimeType.startsWith("video/")) return "videos";
  if (mimeType.startsWith("audio/")) return "audio";
  const docTypes = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "text/",
  ];
  if (docTypes.some((t) => mimeType.startsWith(t))) return "documents";
  return "other";
}

/** Extension → MIME type lookup used when the browser omits Content-Type */
const EXT_MIME: Record<string, string> = {
  // images
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  // video
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".mov": "video/quicktime",
  ".wmv": "video/x-ms-wmv",
  ".flv": "video/x-flv",
  ".m4v": "video/mp4",
  ".3gp": "video/3gpp",
  // audio
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  ".m4a": "audio/mp4",
  ".opus": "audio/opus",
  // documents
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".xml": "application/xml",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".ts": "text/typescript",
  ".md": "text/markdown",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".tar": "application/x-tar",
  ".rar": "application/vnd.rar",
  ".7z": "application/x-7z-compressed",
};

/**
 * Returns the MIME type to use for a file upload.
 * Uses the provided browserMime if non-empty, otherwise falls back to
 * extension-based lookup, and finally 'application/octet-stream'.
 */
export function resolveMimeType(browserMime: string, filename: string): string {
  if (browserMime && browserMime !== "application/octet-stream")
    return browserMime;
  const ext = path.extname(filename).toLowerCase();
  return EXT_MIME[ext] ?? (browserMime || "application/octet-stream");
}

/** Generate a unique filename preserving the original extension */
export function generateStoredName(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  const uid = crypto.randomBytes(12).toString("hex");
  return `${uid}${/^[.][a-z0-9]{1,12}$/.test(ext) ? ext : ""}`;
}

export function storageRoot() {
  return path.resolve(process.env.STORAGE_DIR || "./data/files");
}
export function filePath(folder: string, storedName: string) {
  if (
    !/^[a-z0-9][a-z0-9-]{0,99}$/.test(folder) ||
    !/^[a-f0-9]{24}(\.[a-z0-9]{1,12})?$/.test(storedName)
  )
    throw new Error("Invalid storage path");
  return path.join(storageRoot(), folder, storedName);
}
export function fileUrl(folder: string, storedName: string) {
  return `/api/content/${folder}/${storedName}`;
}
