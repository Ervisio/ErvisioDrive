import fs from "node:fs";
import crypto from "node:crypto";
import { createInterface } from "node:readline/promises";

export function parseEnv(text) {
  /** @type {Record<string,string>} */
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line);
    if (match) {
      let value = match[2];
      if (
        (value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))
      )
        value = value.slice(1, -1);
      values[match[1]] = value;
    }
  }
  return values;
}
export function encodeEnv(values) {
  return (
    Object.entries(values)
      .map(([key, value]) => {
        const text = String(value);
        if (/[\r\n'\x00]/.test(text))
          throw new Error(`Unsupported character in ${key}`);
        return `${key}='${text}'`;
      })
      .join("\n") + "\n"
  );
}
export function validate(values) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.BOOTSTRAP_ADMIN_EMAIL))
    throw new Error("Invalid owner email");
  const url = new URL(values.NEXTAUTH_URL);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Use a base URL without path, query or credentials");
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error(
      "For remote access, use HTTPS through a reverse proxy or tunnel",
    );
  // 0 means unlimited; the in-app settings can override it later.
  if (
    values.STORAGE_QUOTA_GB === "" ||
    !Number.isFinite(Number(values.STORAGE_QUOTA_GB)) ||
    Number(values.STORAGE_QUOTA_GB) < 0
  )
    throw new Error("Invalid quota");
  if (
    values.STORAGE_ENCRYPTION_KEY &&
    !/^[a-f0-9]{64}$/i.test(values.STORAGE_ENCRYPTION_KEY)
  )
    throw new Error("STORAGE_ENCRYPTION_KEY must be 64 hex characters");
  if (
    !/^\d+$/.test(values.APP_PORT) ||
    Number(values.APP_PORT) < 1 ||
    Number(values.APP_PORT) > 65535
  )
    throw new Error("Invalid port");
  if (
    !/^(127\.0\.0\.1|0\.0\.0\.0|\d{1,3}(\.\d{1,3}){3})$/.test(
      values.BIND_ADDRESS,
    )
  )
    throw new Error("Invalid bind address");
  if (!values.DRIVE_STORAGE_PATH.trim())
    throw new Error("Missing storage directory");
  if (!values.NEXTAUTH_SECRET || values.NEXTAUTH_SECRET.length < 32)
    throw new Error("Invalid session secret");
  if (!!values.GOOGLE_CLIENT_ID !== !!values.GOOGLE_CLIENT_SECRET)
    throw new Error(
      "Set both Google Client ID and Client Secret, or leave both empty",
    );
}

export async function setup(args = process.argv.slice(2)) {
  const options = {};
  let resize = false,
    nonInteractive = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--resize") {
      resize = true;
      if (args[i + 1] && !args[i + 1].startsWith("--"))
        options.quota = args[++i];
    } else if (args[i] === "--non-interactive") nonInteractive = true;
    else if (
      args[i].startsWith("--") &&
      args[i + 1] &&
      !args[i + 1].startsWith("--")
    )
      options[args[i].slice(2)] = args[++i];
    else throw new Error(`Invalid option: ${args[i]}`);
  }
  const exists = fs.existsSync(".env"),
    previous = exists ? parseEnv(fs.readFileSync(".env", "utf8")) : {};
  if (resize && !exists) throw new Error("Run the initial setup first");
  const rl = nonInteractive
    ? null
    : createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (label, fallback = "") =>
    nonInteractive
      ? fallback
      : (
          await rl.question(`${label}${fallback ? ` [${fallback}]` : ""}: `)
        ).trim() || fallback;
  try {
    const values = { ...previous };
    values.NEXTAUTH_SECRET ||= crypto.randomBytes(48).toString("base64");
    // Losing this key makes stored files unreadable: it is generated once and kept.
    values.STORAGE_ENCRYPTION_KEY ||= crypto.randomBytes(32).toString("hex");
    if (!resize) {
      values.APP_PORT =
        options.port || (await ask("Local port", values.APP_PORT || "3000"));
      values.NEXTAUTH_URL = (
        options.url ||
        (await ask(
          "Service URL",
          values.NEXTAUTH_URL || `http://localhost:${values.APP_PORT}`,
        ))
      ).replace(/\/$/, "");
      values.BOOTSTRAP_ADMIN_EMAIL = (
        options["admin-email"] ||
        (await ask("Initial owner email", values.BOOTSTRAP_ADMIN_EMAIL || ""))
      ).toLowerCase();
      values.DRIVE_STORAGE_PATH =
        options["storage-path"] ||
        (await ask(
          "Host file directory (Windows: C:/ErvisioDrive/files)",
          values.DRIVE_STORAGE_PATH || "./data/files",
        ));
      values.BIND_ADDRESS =
        options.bind ||
        (await ask("Bind address", values.BIND_ADDRESS || "127.0.0.1"));
      values.GOOGLE_CLIENT_ID =
        options["google-client-id"] ?? values.GOOGLE_CLIENT_ID ?? "";
      values.GOOGLE_CLIENT_SECRET =
        options["google-client-secret"] ?? values.GOOGLE_CLIENT_SECRET ?? "";
      // The Ervisio plugin reaches the drive through a unix socket on the host.
      const ervisio = (
        options.ervisio ||
        (await ask(
          "Ervisio plugin integration (yes/no)",
          values.ERVISIO_SOCKET_DIR
            ? "yes"
            : process.platform === "linux" && fs.existsSync("/run")
              ? "yes"
              : "no",
        ))
      ).toLowerCase();
      if (!["yes", "no"].includes(ervisio))
        throw new Error("Answer yes or no for the Ervisio integration");
      if (ervisio === "yes") values.ERVISIO_SOCKET_DIR = "/run/ervisio-drive";
      else delete values.ERVISIO_SOCKET_DIR;
      values.UPLOAD_MAX_MB = values.UPLOAD_MAX_MB || "100";
      values.TRUST_PROXY = values.TRUST_PROXY || "false";
    }
    values.STORAGE_QUOTA_GB =
      options.quota ||
      (await ask(
        "Maximum file quota in GiB (0 = unlimited, no preallocation)",
        values.STORAGE_QUOTA_GB || "100",
      ));
    validate(values);
    // Atomic write; an existing secret and all unmodified settings are preserved.
    fs.writeFileSync(".env.tmp", encodeEnv(values), { mode: 0o600 });
    fs.renameSync(".env.tmp", ".env");
    fs.chmodSync(".env", 0o600);
    console.log(
      `Configuration saved. URL: ${values.NEXTAUTH_URL}. Quota: ${values.STORAGE_QUOTA_GB} GiB; space is used only as files are uploaded.`,
    );
  } finally {
    rl?.close();
  }
}
if (import.meta.url === new URL(process.argv[1], "file:").href)
  setup().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
