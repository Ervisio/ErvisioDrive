import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { MongoMemoryServer } from "mongodb-memory-server";

test("production HTTP flow: bootstrap, CSRF, local login, file operations and session revocation", async () => {
  const mongo = await MongoMemoryServer.create({
    instance: { args: ["--nounixsocket"] },
    binary: { version: "8.0.13" },
  });
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), "drive-http-"));
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const base = `http://localhost:${port}`;
  const env = {
    ...process.env,
    MONGODB_URI: mongo.getUri("drivehttp"),
    STORAGE_DIR: storage,
    STORAGE_QUOTA_GB: "1",
    STORAGE_ENCRYPTION_KEY: "ab".repeat(32),
    BOOTSTRAP_ADMIN_EMAIL: "owner@example.com",
    NEXTAUTH_URL: base,
    NEXTAUTH_SECRET: "disposable-test-secret-with-at-least-32-characters",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
  };
  const bootstrap = execFileSync(
    process.execPath,
    ["scripts/ops.mjs", "bootstrap"],
    { env, encoding: "utf8" },
  );
  const token = bootstrap.match(/activate#([a-f0-9]{64})/)?.[1];
  assert.ok(token);
  const server = spawn(process.execPath, [".next/standalone/server.js"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  server.stdout.on("data", (chunk) => {
    logs += chunk;
  });
  server.stderr.on("data", (chunk) => {
    logs += chunk;
  });
  const client = () => {
    const jar = new Map();
    return async (pathname, options = {}) => {
      const headers = new Headers(options.headers);
      if (jar.size)
        headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
      if (options.method && options.method !== "GET" && !headers.has("origin"))
        headers.set("origin", base);
      const response = await fetch(base + pathname, {
        ...options,
        headers,
        redirect: "manual",
      });
      for (const cookie of response.headers.getSetCookie()) {
        const first = cookie.split(";")[0],
          index = first.indexOf("=");
        jar.set(first.slice(0, index), first.slice(index + 1));
      }
      return response;
    };
  };
  const owner = client(),
    member = client();
  const post = (body) => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  async function login(client, email, password) {
    const csrf = await (await client("/api/auth/csrf")).json();
    const result = await client("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        csrfToken: csrf.csrfToken,
        email,
        password,
        json: "true",
        callbackUrl: base,
      }),
    });
    const body = await result.json();
    assert.ok(!body.url.includes("error="), body.url);
  }
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(base + "/api/health")).ok) {
          ready = true;
          break;
        }
      } catch {}
      if (server.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, logs);
    assert.equal((await owner("/api/admin/members")).status, 401);
    assert.equal((await owner("/api/admin/cdn/files")).status, 401);
    const csrfMissing = await owner("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        email: "owner@example.com",
        password: "a password",
      }),
    });
    assert.ok(csrfMissing.status === 302 || csrfMissing.status === 400);
    const activation = await owner(
      "/api/activate",
      post({ token, password: "An excellent password 123!" }),
    );
    assert.equal(activation.status, 200, await activation.text());
    await login(owner, "owner@example.com", "An excellent password 123!");
    assert.equal((await owner("/api/admin/members")).status, 200);
    const html = await (await owner("/")).text();
    assert.ok(html.includes("ErvisioDrive"));
    assert.ok(!html.includes("Accesso negato"));
    const foreign = await owner("/api/admin/members", {
      ...post({ email: "bad@example.com" }),
      headers: {
        "content-type": "application/json",
        origin: "https://foreign.example",
      },
    });
    const csrfToken = await (await owner("/api/auth/csrf")).json();
    assert.ok(csrfToken.csrfToken);
    assert.equal(foreign.status, 403);
    const invitation = await (
      await owner("/api/admin/members", post({ email: "member@example.com" }))
    ).json();
    assert.equal(
      (
        await member(
          "/api/activate",
          post({
            token: new URL(invitation.invitation).hash.slice(1),
            password: "A different password 123!",
          }),
        )
      ).status,
      200,
    );
    await login(member, "member@example.com", "A different password 123!");
    assert.equal((await member("/api/admin/members")).status, 403);
    const form = new FormData();
    form.append(
      "files",
      new File(["content from HTTP"], "http.txt", { type: "text/plain" }),
    );
    const upload = await owner("/api/admin/cdn/upload", {
      method: "POST",
      body: form,
    });
    assert.equal(upload.status, 201);
    const file = (await upload.json()).data[0];
    assert.equal((await fetch(base + file.url)).status, 401);
    // Uploads are private until the owner shares them with the workspace.
    assert.equal((await member(file.url)).status, 403);
    const shared = await owner(`/api/admin/cdn/files/${file._id}/access`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visibility: "members" }),
    });
    assert.equal(shared.status, 200);
    assert.equal(await (await member(file.url)).text(), "content from HTTP");
    const removed = await owner("/api/admin/members", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: invitation.data._id }),
    });
    assert.equal(removed.status, 200);
    assert.equal((await member(file.url)).status, 401);
    assert.equal((await member("/api/admin/cdn/files")).status, 401);
  } finally {
    server.kill("SIGTERM");
    await once(server, "exit").catch(() => {});
    await mongo.stop();
    await fs.rm(storage, { recursive: true, force: true });
  }
});
