import fs from "node:fs";
import { PERMISSIONS } from "../lib/permissions-catalog";
import { openApiDocument } from "../lib/openapi";
fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync(
  "docs/openapi.json",
  JSON.stringify(openApiDocument(), null, 2) + "\n",
);
fs.writeFileSync(
  "docs/PERMISSIONS.md",
  "# API permission catalog\n\nPermissions are explicit. Ownership, ACL, current roles and resource envelopes remain required.\n\n| Scope | Capability |\n| --- | --- |\n" +
    Object.entries(PERMISSIONS)
      .map(([scope, description]) => `| \`${scope}\` | ${description} |`)
      .join("\n") +
    "\n",
);
console.log("Generated API contract and permission catalog");
