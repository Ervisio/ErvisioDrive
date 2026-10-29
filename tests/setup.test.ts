import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnv, encodeEnv, validate, setup } from "../scripts/setup.mjs";
test("setup preserves secret, supports Windows paths and expands quota without creating file storage", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "drive-setup-")),
    previous = process.cwd();
  try {
    process.chdir(directory);
    await setup([
      "--non-interactive",
      "--admin-email",
      "owner@example.com",
      "--quota",
      "10",
      "--storage-path",
      "C:/Drive Files/storage",
    ]);
    const first = parseEnv(fs.readFileSync(".env", "utf8"));
    assert.equal(first.DRIVE_STORAGE_PATH, "C:/Drive Files/storage");
    assert.equal(first.STORAGE_QUOTA_GB, "10");
    assert.deepEqual(fs.readdirSync(directory), [".env"]);
    await setup(["--non-interactive", "--resize", "250"]);
    const second = parseEnv(fs.readFileSync(".env", "utf8"));
    assert.equal(second.NEXTAUTH_SECRET, first.NEXTAUTH_SECRET);
    assert.match(first.STORAGE_ENCRYPTION_KEY, /^[a-f0-9]{64}$/);
    assert.equal(second.STORAGE_ENCRYPTION_KEY, first.STORAGE_ENCRYPTION_KEY);
    assert.equal(second.DRIVE_STORAGE_PATH, first.DRIVE_STORAGE_PATH);
    assert.equal(second.STORAGE_QUOTA_GB, "250");
    assert.deepEqual(parseEnv(encodeEnv(second)), second);
    assert.throws(() =>
      validate({ ...second, NEXTAUTH_URL: "http://public.example" }),
    );
    // 0 is unlimited; negative or non-numeric quotas are rejected.
    validate({ ...second, STORAGE_QUOTA_GB: "0" });
    assert.throws(() => validate({ ...second, STORAGE_QUOTA_GB: "-1" }));
    assert.throws(() => validate({ ...second, STORAGE_ENCRYPTION_KEY: "short" }));
    assert.throws(() => encodeEnv({ DRIVE_STORAGE_PATH: "bad\npath" }));
  } finally {
    process.chdir(previous);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
