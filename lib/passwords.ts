import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { fail } from "@/lib/http";
const derive = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password,
      salt,
      64,
      { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
export function validatePassword(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length < 12 ||
    value.length > 128 ||
    Buffer.byteLength(value) > 512
  )
    fail(400, "Usa una password da 12 a 128 caratteri");
}
export async function hashPassword(password: string) {
  validatePassword(password);
  const salt = randomBytes(16),
    hash = await derive(password, salt);
  return `scrypt-v1$${salt.toString("hex")}$${hash.toString("hex")}`;
}
export async function verifyPassword(
  password: string,
  encoded: string | null | undefined,
) {
  if (
    typeof password !== "string" ||
    password.length > 128 ||
    Buffer.byteLength(password) > 512
  )
    return false;
  // Run the same work for unknown accounts to avoid a cheap timing oracle.
  const match = /^scrypt-v1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(
    encoded || "",
  );
  const derived = await derive(
    password,
    Buffer.from(match?.[1] || "00000000000000000000000000000000", "hex"),
  );
  return !!match && timingSafeEqual(derived, Buffer.from(match[2], "hex"));
}
export const tokenDigest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const newInvitation = () => {
  const token = randomBytes(32).toString("hex");
  return {
    token,
    inviteHash: tokenDigest(token),
    inviteExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
  };
};
