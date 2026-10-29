// Container entry point. Applies the overrides saved by the Ervisio plugin,
// opens the plugin's unix socket when PLUGIN_SOCKET is set, then starts the
// Next.js standalone server in this same process.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.env.STORAGE_DIR || "./data/files");
try {
  const saved = JSON.parse(fs.readFileSync(path.join(root, ".ervisio", "runtime.json"), "utf8"));
  if (typeof saved.publicUrl === "string") process.env.NEXTAUTH_URL = saved.publicUrl;
  if (typeof saved.trustProxy === "boolean") process.env.TRUST_PROXY = String(saved.trustProxy);
} catch {}

const socket = process.env.PLUGIN_SOCKET;
if (socket) process.env.PLUGIN_SOCKET_SECRET = crypto.randomBytes(32).toString("hex");

await import(pathToFileURL(path.resolve(process.argv[2] || "server.js")).href);

if (socket) {
  const port = Number(process.env.PORT || 3000),
    hop = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "host", "x-ervisio-plugin"]);
  const server = http.createServer((req, res) => {
    // Only the plugin API is reachable through the socket.
    if (!/^\/api\/plugin(\/|\?|$)/.test(req.url || "")) {
      res.writeHead(404).end();
      return;
    }
    const headers = Object.fromEntries(
      Object.entries(req.headers).filter(([name]) => !hop.has(name.toLowerCase())),
    );
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port,
        path: req.url,
        method: req.method,
        headers: { ...headers, host: `127.0.0.1:${port}`, "x-ervisio-plugin": process.env.PLUGIN_SOCKET_SECRET },
      },
      (response) => {
        res.writeHead(response.statusCode || 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });
  try {
    fs.mkdirSync(path.dirname(socket), { recursive: true });
    fs.rmSync(socket, { force: true });
    server.listen(socket, () => {
      // The host's Ervisio daemon connects as root; nobody else needs it.
      fs.chmodSync(socket, 0o660);
      console.log(`Ervisio plugin socket: ${socket}`);
    });
  } catch (error) {
    // The drive keeps working without the plugin.
    console.error("Ervisio plugin socket unavailable:", error instanceof Error ? error.message : error);
  }
  server.on("error", (error) => console.error("Ervisio plugin socket error:", error.message));
}
