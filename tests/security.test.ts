import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canReadFile,
  canReadFolder,
  canManage,
  normalizeEmail,
  safeName,
  type Actor,
} from "../lib/policy";
import { filePath } from "../lib/storage";
import {
  hashPassword,
  verifyPassword,
  tokenDigest,
  newInvitation,
} from "../lib/passwords";
import { checkOrigin, readJson } from "../lib/http";
import { NextRequest } from "next/server";
const alice: Actor = {
  id: "alice",
  email: "a@example.com",
  name: "Alice",
  role: "member",
};
const bob: Actor = {
  id: "bob",
  email: "b@example.com",
  name: "Bob",
  role: "member",
};
const admin: Actor = { ...alice, id: "admin", role: "admin" };
test("ACL: folder and file restrictions intersect; owner and admin rights are explicit", () => {
  const file = { uploadedBy: "alice", allowedUsers: ["bob"] },
    folder = { createdBy: "admin", allowedUsers: ["alice"] };
  assert.equal(canReadFile(alice, file, folder), true);
  assert.equal(canReadFile(bob, file, folder), false);
  assert.equal(canReadFile(admin, file, folder), true);
  assert.equal(canReadFolder(bob, { allowedUsers: [] }), false);
  assert.equal(canReadFolder(bob, { allowedUsers: [], visibility: "members" }), true);
  assert.equal(canManage(bob, "alice"), false);
  assert.equal(canManage(admin, "alice"), true);
  assert.equal(canReadFile(admin, { expiresAt: new Date(0) }), false);
});
test("ACL: every member has a private space unless content is shared", () => {
  const mine = { uploadedBy: "alice", allowedUsers: [] as string[] };
  assert.equal(canReadFile(alice, mine), true);
  assert.equal(canReadFile(bob, mine), false);
  assert.equal(canReadFile(admin, mine), true);
  assert.equal(canReadFile(bob, { ...mine, visibility: "members" as const }), true);
  assert.equal(canReadFile(bob, { ...mine, allowedUsers: ["bob"] }), true);
  // A shared folder covers its unrestricted files.
  const folder = { createdBy: "alice", allowedUsers: ["bob"] };
  assert.equal(canReadFile(bob, mine, folder), true);
  assert.equal(canReadFile(bob, { ...mine, allowedUsers: ["carol"] }, folder), false);
  assert.equal(canReadFile(bob, mine, { createdBy: "alice", allowedUsers: [] }), false);
});
test("reject path traversal, header injection and malformed filenames", () => {
  for (const value of ["../test", "a/b", "a\\b", "x\r\ny", "\0", ""])
    assert.throws(() => safeName(value));
  assert.throws(() => filePath("../outside", "a".repeat(24)));
  assert.throws(() => filePath("documents", "../../outside"));
  assert.equal(normalizeEmail(" A@Example.COM "), "a@example.com");
});
test("password hashing is salted, accepts Unicode and rejects bad credentials", async () => {
  const password = "Una password lunga 🔐";
  const first = await hashPassword(password),
    second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("Password sbagliata", first), false);
  assert.equal(await verifyPassword(password, null), false);
  await assert.rejects(() => hashPassword("short"));
  await assert.rejects(() => hashPassword("x".repeat(129)));
  const invitation = newInvitation();
  assert.equal(invitation.inviteHash, tokenDigest(invitation.token));
  assert.notEqual(invitation.inviteHash, invitation.token);
});
test("mutations require same-origin requests and JSON has a bounded reader", async () => {
  process.env.NEXTAUTH_URL = "http://localhost:3000";
  const cross = new NextRequest("http://localhost:3000/api/test", {
    method: "POST",
    headers: { origin: "https://other.example" },
    body: "{}",
  });
  assert.throws(() => checkOrigin(cross));
  const own = new NextRequest("http://localhost:3000/api/test", {
    method: "POST",
    headers: { origin: "http://localhost:3000" },
    body: '{"ok":true}',
  });
  checkOrigin(own);
  assert.deepEqual(await readJson(own), { ok: true });
  const large = new NextRequest("http://localhost:3000/api/test", {
    method: "POST",
    body: "x".repeat(300),
  });
  await assert.rejects(() => readJson(large, 100));
});
