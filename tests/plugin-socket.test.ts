import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

// The socket forwards only /api/plugin to the app, with the process secret.
test("plugin socket proxies the plugin API with a secret header", async () => {
  if (process.platform === "win32") return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "edv-sock-")),
    socket = path.join(dir, "api.sock"),
    server = path.join(dir, "server.mjs");
  fs.writeFileSync(
    server,
    `import http from "node:http";
http.createServer((req, res) => res.end(JSON.stringify({ url: req.url, secret: req.headers["x-ervisio-plugin"] || null, env: process.env.PLUGIN_SOCKET_SECRET, publicUrl: process.env.NEXTAUTH_URL }))).listen(Number(process.env.PORT));`,
  );
  fs.mkdirSync(path.join(dir, "files", ".ervisio"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "files", ".ervisio", "runtime.json"),
    JSON.stringify({ publicUrl: "https://drive.example.com", trustProxy: true }),
  );
  const port = 39000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ["scripts/start.mjs", server], {
    env: { ...process.env, PORT: String(port), PLUGIN_SOCKET: socket, STORAGE_DIR: path.join(dir, "files") },
    stdio: "pipe",
  });
  try {
    for (let i = 0; i < 100 && !fs.existsSync(socket); i++) await new Promise((r) => setTimeout(r, 50));
    const get = (url: string, headers: Record<string, string> = {}) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        http
          .get({ socketPath: socket, path: url, headers }, (res) => {
            let body = "";
            res.on("data", (c) => (body += c));
            res.on("end", () => resolve({ status: res.statusCode || 0, body }));
          })
          .on("error", reject);
      });
    assert.equal((await get("/api/files")).status, 404);
    const forged = JSON.parse((await get("/api/plugin/status", { "x-ervisio-plugin": "forged" })).body);
    assert.equal(forged.url, "/api/plugin/status");
    assert.equal(forged.secret, forged.env);
    assert.ok(forged.secret.length >= 64);
    assert.equal(forged.publicUrl, "https://drive.example.com");
    assert.equal((fs.statSync(socket).mode & 0o777).toString(8), "660");
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
