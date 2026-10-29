// Encryption at rest for stored files.
//
// Each file has its own random data key (DEK). The DEK is wrapped with the
// owner's key, derived with HKDF from STORAGE_ENCRYPTION_KEY, so files of
// different users never share key material. Content is split into 64 KiB
// chunks sealed with AES-256-GCM; the chunk index and a "last chunk" flag are
// bound through the IV and AAD, so chunks cannot be reordered or truncated and
// byte ranges can be served by decrypting only the chunks they touch.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { Transform, type TransformCallback } from "node:stream";

export const CHUNK = 64 * 1024;
const TAG = 16;
const ALGORITHM = "aes-256-gcm-chunked";

export interface Encryption {
  alg: typeof ALGORITHM;
  v: 1;
  /** Member whose derived key wraps the DEK. */
  keyOwner: string;
  wrappedKey: string;
  keyIv: string;
  keyTag: string;
  /** 8-byte IV prefix; the chunk counter fills the last 4 bytes. */
  nonce: string;
  chunkSize: number;
}

let cachedMaster: Buffer | null | undefined;
function masterKey(): Buffer | null {
  if (cachedMaster !== undefined) return cachedMaster;
  const raw = (process.env.STORAGE_ENCRYPTION_KEY || "").trim();
  if (!raw) return (cachedMaster = null);
  const key = /^[a-f0-9]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (key.length !== 32)
    throw new Error("STORAGE_ENCRYPTION_KEY must be 32 bytes (hex or base64)");
  return (cachedMaster = key);
}

export const encryptionEnabled = () => masterKey() !== null;

function userKey(memberId: string) {
  const master = masterKey();
  if (!master) throw new Error("Storage encryption key is not configured");
  return Buffer.from(
    crypto.hkdfSync("sha256", master, "ervisiodrive:files", `member:${memberId}`, 32),
  );
}

function wrap(dek: Buffer, owner: string) {
  const keyIv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", userKey(owner), keyIv);
  cipher.setAAD(Buffer.from(`dek:${owner}`));
  const wrapped = Buffer.concat([cipher.update(dek), cipher.final()]);
  return {
    keyOwner: owner,
    wrappedKey: wrapped.toString("base64"),
    keyIv: keyIv.toString("base64"),
    keyTag: cipher.getAuthTag().toString("base64"),
  };
}

function unwrap(meta: Encryption) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    userKey(meta.keyOwner),
    Buffer.from(meta.keyIv, "base64"),
  );
  decipher.setAAD(Buffer.from(`dek:${meta.keyOwner}`));
  decipher.setAuthTag(Buffer.from(meta.keyTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(meta.wrappedKey, "base64")),
    decipher.final(),
  ]);
}

/** Fresh key material for a new write. Every write gets a new DEK and nonce. */
export function newEncryption(owner: string): { meta: Encryption; dek: Buffer } {
  const dek = crypto.randomBytes(32);
  return {
    dek,
    meta: {
      alg: ALGORITHM,
      v: 1,
      ...wrap(dek, owner),
      nonce: crypto.randomBytes(8).toString("base64"),
      chunkSize: CHUNK,
    },
  };
}

/** Re-wraps the same DEK for another owner (used by copies). */
export function rewrap(meta: Encryption, owner: string): Encryption {
  return { ...meta, ...wrap(unwrap(meta), owner) };
}

const iv = (nonce: Buffer, index: number) => {
  const value = Buffer.alloc(12);
  nonce.copy(value, 0, 0, 8);
  value.writeUInt32BE(index, 8);
  return value;
};
const aad = (index: number, last: boolean) => {
  const value = Buffer.alloc(9);
  value.write("edv1", 0);
  value.writeUInt32BE(index, 4);
  value[8] = last ? 1 : 0;
  return value;
};

function sealChunk(dek: Buffer, nonce: Buffer, index: number, last: boolean, data: Buffer) {
  if (index > 0xffffffff) throw new Error("File is too large to encrypt");
  const cipher = crypto.createCipheriv("aes-256-gcm", dek, iv(nonce, index));
  cipher.setAAD(aad(index, last));
  return Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);
}

function openChunk(dek: Buffer, nonce: Buffer, index: number, last: boolean, data: Buffer) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", dek, iv(nonce, index));
  decipher.setAAD(aad(index, last));
  decipher.setAuthTag(data.subarray(data.length - TAG));
  return Buffer.concat([decipher.update(data.subarray(0, data.length - TAG)), decipher.final()]);
}

/** Size on disk of an encrypted file with `size` plaintext bytes. */
export const encryptedSize = (size: number, chunk = CHUNK) =>
  size + TAG * Math.max(1, Math.ceil(size / chunk));

/** Streaming encryptor. Holds back one chunk so the last one can be flagged. */
export class EncryptStream extends Transform {
  private buffer: Buffer = Buffer.alloc(0);
  private index = 0;
  private readonly nonce: Buffer;
  /** Plaintext bytes seen so far. */
  bytes = 0;
  constructor(
    private readonly dek: Buffer,
    meta: Encryption,
    private readonly limit = Infinity,
  ) {
    super();
    this.nonce = Buffer.from(meta.nonce, "base64");
  }
  _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback) {
    this.bytes += chunk.length;
    if (this.bytes > this.limit) return done(new LimitError());
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (this.buffer.length > CHUNK) {
      this.push(sealChunk(this.dek, this.nonce, this.index++, false, this.buffer.subarray(0, CHUNK)));
      this.buffer = this.buffer.subarray(CHUNK);
    }
    done();
  }
  _flush(done: TransformCallback) {
    this.push(sealChunk(this.dek, this.nonce, this.index, true, this.buffer));
    done();
  }
}

export class LimitError extends Error {
  constructor() {
    super("Upload is too large");
  }
}

/** Plain counting stream for unencrypted writes, with the same size limit. */
export class CountStream extends Transform {
  bytes = 0;
  constructor(private readonly limit = Infinity) {
    super();
  }
  _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback) {
    this.bytes += chunk.length;
    if (this.bytes > this.limit) return done(new LimitError());
    done(null, chunk);
  }
}

export function encryptBuffer(data: Buffer, owner: string) {
  const { meta, dek } = newEncryption(owner),
    nonce = Buffer.from(meta.nonce, "base64"),
    parts: Buffer[] = [],
    count = Math.max(1, Math.ceil(data.length / CHUNK));
  for (let i = 0; i < count; i++)
    parts.push(sealChunk(dek, nonce, i, i === count - 1, data.subarray(i * CHUNK, (i + 1) * CHUNK)));
  return { meta, data: Buffer.concat(parts) };
}

/**
 * Decrypts plaintext bytes [start, end] (inclusive) of a file whose plaintext
 * length is `size`, yielding them in pieces of at most one chunk.
 */
export async function* decryptRange(
  handle: fs.FileHandle,
  meta: Encryption,
  size: number,
  start: number,
  end: number,
): AsyncGenerator<Buffer> {
  const dek = unwrap(meta),
    nonce = Buffer.from(meta.nonce, "base64"),
    chunk = meta.chunkSize,
    last = Math.max(0, Math.ceil(size / chunk) - 1);
  if (size === 0) {
    const sealed = Buffer.alloc(TAG);
    await handle.read(sealed, 0, TAG, 0);
    openChunk(dek, nonce, 0, true, sealed);
    return;
  }
  for (let index = Math.floor(start / chunk); index <= Math.floor(end / chunk); index++) {
    const plainLength = index === last ? size - index * chunk : chunk,
      sealed = Buffer.alloc(plainLength + TAG),
      { bytesRead } = await handle.read(sealed, 0, sealed.length, index * (chunk + TAG));
    if (bytesRead !== sealed.length) throw new Error("Encrypted file is truncated");
    const plain = openChunk(dek, nonce, index, index === last, sealed),
      from = index === Math.floor(start / chunk) ? start - index * chunk : 0,
      to = index === Math.floor(end / chunk) ? end - index * chunk + 1 : plain.length;
    yield plain.subarray(from, to);
  }
}

/** Reads a whole stored file as plaintext, encrypted or not. */
export async function readStored(location: string, file: { size: number; encryption?: Encryption | null }) {
  if (!file.encryption) return fs.readFile(location);
  const handle = await fs.open(location, "r");
  try {
    const parts: Buffer[] = [];
    if (file.size === 0) {
      for await (const _ of decryptRange(handle, file.encryption, 0, 0, 0));
      return Buffer.alloc(0);
    }
    for await (const part of decryptRange(handle, file.encryption, file.size, 0, file.size - 1))
      parts.push(part);
    return Buffer.concat(parts);
  } finally {
    await handle.close();
  }
}

/** Writes plaintext to `location`, encrypting it when a key is configured. */
export async function writeStored(location: string, data: Buffer, owner: string, flag = "w") {
  if (!encryptionEnabled()) {
    await fs.writeFile(location, data, { flag });
    return null;
  }
  const sealed = encryptBuffer(data, owner);
  await fs.writeFile(location, sealed.data, { flag });
  return sealed.meta;
}
