import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { zipName, zipChunks } from "../lib/folder-zip";
import { filePath } from "../lib/storage";
import { writeStored } from "../lib/crypto-store";

test("ZIP names are safe and unique across case and directory collisions", () => {
  const used = new Set<string>();
  assert.equal(zipName("../a\\b.txt", used), ".._a_b.txt");
  assert.equal(zipName("CON.txt", used), "_CON.txt");
  assert.equal(zipName("..", used), "unnamed");
  assert.equal(zipName("Report.txt", used), "Report.txt");
  assert.equal(zipName("report.txt", used), "report (1).txt");
});

test("streamed ZIP round trips encrypted, plain, empty and multi-chunk files", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "drive-zip-"));
  process.env.STORAGE_DIR = directory;
  process.env.STORAGE_ENCRYPTION_KEY = "ab".repeat(32);
  try {
    await fs.mkdir(path.join(directory, "documents"));
    const payload = Buffer.from("large plaintext ".repeat(12000));
    const encryption = await writeStored(filePath("documents", "aaaaaaaaaaaaaaaaaaaaaaaa.txt"), payload, "owner");
    await fs.writeFile(filePath("documents", "bbbbbbbbbbbbbbbbbbbbbbbb.txt"), "plain");
    const emptyEncryption = await writeStored(filePath("documents", "cccccccccccccccccccccccc.txt"), Buffer.alloc(0), "owner");
    const parts: Uint8Array[] = [];
    for await (const chunk of zipChunks([
      { path: "Root/" }, { path: "Root/Empty/" },
      { path: "Root/日本語.txt", file: { folder: "documents", storedName: "aaaaaaaaaaaaaaaaaaaaaaaa.txt", size: payload.length, encryption } },
      { path: "Root/plain.txt", file: { folder: "documents", storedName: "bbbbbbbbbbbbbbbbbbbbbbbb.txt", size: 5 } },
      { path: "Root/empty.txt", file: { folder: "documents", storedName: "cccccccccccccccccccccccc.txt", size: 0, encryption: emptyEncryption } },
    ])) parts.push(chunk);
    const bytes = Buffer.concat(parts);
    assert.ok(bytes.indexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06])) >= 0, "ZIP64 end record");
    const zipped = unzipSync(bytes);
    assert.deepEqual(Buffer.from(zipped["Root/日本語.txt"]), payload);
    assert.equal(strFromU8(zipped["Root/plain.txt"]), "plain");
    assert.equal(zipped["Root/empty.txt"].length, 0);
    assert.ok(zipped["Root/Empty/"]);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(async () => {
      for await (const _ of zipChunks([{ path: "Root/" }], controller.signal));
    }, /abort/i);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
