import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createWriteStream, mkdtempSync } from "node:fs";
import * as store from "../lib/crypto-store";

// The key is read lazily, on first use.
process.env.STORAGE_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
const dir = mkdtempSync(path.join(os.tmpdir(), "edv-crypto-"));
const plain = (n: number) => crypto.randomBytes(n);

async function sealed(data: Buffer, owner = "alice") {
  const location = path.join(dir, crypto.randomUUID());
  const meta = await store.writeStored(location, data, owner);
  return { location, meta: meta!, size: data.length };
}
async function range(f: { location: string; meta: any; size: number }, start: number, end: number) {
  const handle = await fs.open(f.location, "r");
  try {
    const parts: Buffer[] = [];
    for await (const part of store.decryptRange(handle, f.meta, f.size, start, end)) parts.push(part);
    return Buffer.concat(parts);
  } finally {
    await handle.close();
  }
}

test("round trips across chunk boundaries and sizes", async () => {
  for (const n of [0, 1, store.CHUNK - 1, store.CHUNK, store.CHUNK + 1, 3 * store.CHUNK + 17]) {
    const data = plain(n), f = await sealed(data);
    assert.equal((await fs.stat(f.location)).size, store.encryptedSize(n));
    assert.notDeepEqual(await fs.readFile(f.location), data);
    assert.deepEqual(await store.readStored(f.location, { size: n, encryption: f.meta }), data);
  }
});

test("serves arbitrary byte ranges", async () => {
  const data = plain(5 * store.CHUNK + 123), f = await sealed(data);
  for (const [a, b] of [[0, 0], [10, 20], [store.CHUNK - 3, store.CHUNK + 3], [2 * store.CHUNK, 4 * store.CHUNK + 5], [data.length - 1, data.length - 1]])
    assert.deepEqual(await range(f, a, b), data.subarray(a, b + 1));
});

test("detects tampering and truncation", async () => {
  const data = plain(2 * store.CHUNK + 5), f = await sealed(data);
  const raw = await fs.readFile(f.location);
  raw[100] ^= 1;
  await fs.writeFile(f.location, raw);
  await assert.rejects(store.readStored(f.location, { size: data.length, encryption: f.meta }));
  const g = await sealed(data);
  await fs.truncate(g.location, store.CHUNK + 16);
  await assert.rejects(store.readStored(g.location, { size: data.length, encryption: g.meta }));
});

test("keys are bound to their owner and can be re-wrapped", async () => {
  const data = plain(1000), f = await sealed(data, "alice");
  await assert.rejects(store.readStored(f.location, { size: 1000, encryption: { ...f.meta, keyOwner: "bob" } }));
  const copy = store.rewrap(f.meta, "bob");
  assert.equal(copy.keyOwner, "bob");
  assert.deepEqual(await store.readStored(f.location, { size: 1000, encryption: copy }), data);
});

test("streaming encryption matches and enforces limits", async () => {
  const data = plain(4 * store.CHUNK + 9), { meta, dek } = store.newEncryption("carol");
  const location = path.join(dir, "stream");
  const enc = new store.EncryptStream(dek, meta);
  await pipeline(Readable.from([data.subarray(0, 1000), data.subarray(1000, 200000), data.subarray(200000)]), enc, createWriteStream(location));
  assert.equal(enc.bytes, data.length);
  assert.deepEqual(await store.readStored(location, { size: data.length, encryption: meta }), data);
  const limited = new store.EncryptStream(dek, meta, 10);
  await assert.rejects(pipeline(Readable.from([plain(11)]), limited, createWriteStream(path.join(dir, "x"))), store.LimitError);
});
