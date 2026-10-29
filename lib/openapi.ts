import { API_OPERATIONS } from "@/lib/api-operations";
import { permissionNames, PERMISSIONS } from "@/lib/permissions-catalog";
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const text = { type: "string" },
  date = { type: "string", format: "date-time" },
  id = { type: "string", pattern: "^[a-fA-F0-9]{24}$" };
const object = (
  properties: Record<string, unknown>,
  required: string[] = [],
  extra = false,
) => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: extra,
});
const list = (items: unknown) => ({ type: "array", items });
const envelope = (data: unknown) =>
  object(
    { success: { type: "boolean", enum: [true] }, data },
    ["success", "data"],
    true,
  );
const grant = object(
  { email: { type: "string", format: "email" }, userId: id },
  [],
  false,
);
const restriction = {
  resourceMode: { type: "string", enum: ["all", "selected"], default: "all" },
  fileIds: { ...list(id), maxItems: 100 },
  folderSlugs: {
    ...list({ type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,99}$" }),
    maxItems: 100,
  },
};
const tokenFields = {
  name: { type: "string", minLength: 1, maxLength: 80 },
  scopes: {
    ...list({ type: "string", enum: permissionNames }),
    minItems: 1,
    uniqueItems: true,
  },
  ...restriction,
};
export const schemas: Record<string, unknown> = {
  Error: object({ success: { type: "boolean", enum: [false] }, error: text }, [
    "success",
    "error",
  ]),
  File: object(
    {
      _id: id,
      name: text,
      folder: text,
      storedName: text,
      mimeType: text,
      size: { type: "integer", minimum: 0 },
      url: {
        type: "string",
        description:
          "Browser session URL; API clients should use /files/{id}/download.",
      },
      uploadedBy: id,
      uploadedByUsername: text,
      allowedUsers: list(id),
      expiresAt: { ...date, nullable: true },
      createdAt: date,
      updatedAt: date,
    },
    ["_id", "name", "folder", "mimeType", "size", "url"],
    true,
  ),
  Folder: object(
    {
      _id: id,
      slug: text,
      name: text,
      description: text,
      allowedUsers: list(id),
      createdBy: id,
      createdAt: date,
      updatedAt: date,
      builtin: { type: "boolean" },
    },
    ["slug", "name"],
    true,
  ),
  Member: object(
    {
      _id: id,
      email: { type: "string", format: "email" },
      name: text,
      role: { type: "string", enum: ["admin", "member"] },
      isOwner: { type: "boolean" },
      lastLogin: { ...date, nullable: true },
      createdAt: date,
    },
    ["_id", "email", "role"],
    true,
  ),
  Token: object(
    {
      _id: id,
      ...tokenFields,
      ownerId: id,
      prefix: {
        type: "string",
        description: "Non-secret masked token identifier",
      },
      expiresAt: date,
      revokedAt: { ...date, nullable: true },
      lastUsedAt: { ...date, nullable: true },
      createdAt: date,
    },
    ["_id", "name", "ownerId", "scopes", "expiresAt"],
    true,
  ),
  Share: object(
    {
      _id: id,
      fileId: id,
      token: {
        type: "string",
        pattern: "^[a-f0-9]{64}$",
        description: "Public download capability. Treat as a secret.",
      },
      expiresAt: { ...date, nullable: true },
      maxDownloads: { type: "integer", minimum: 1, nullable: true },
      downloadCount: { type: "integer", minimum: 0 },
      createdAt: date,
    },
    ["_id", "fileId", "token"],
    true,
  ),
  Pagination: object(
    {
      limit: { type: "integer", minimum: 1, maximum: 100 },
      nextCursor: {
        type: "string",
        nullable: true,
        description: "Pass this value as cursor; null marks the last page.",
      },
    },
    ["limit", "nextCursor"],
  ),
  FileList: object(
    {
      success: { type: "boolean" },
      data: list(ref("File")),
      folderCounts: {
        type: "object",
        additionalProperties: { type: "integer" },
      },
      pagination: ref("Pagination"),
    },
    ["success", "data", "pagination"],
  ),
  Storage: object(
    {
      usedBytes: { type: "integer", minimum: 0 },
      quotaBytes: {
        type: "integer",
        minimum: 1,
        nullable: true,
        description: "null when unlimited.",
      },
      member: {
        type: "object",
        description: "Usage and quota of the token owner.",
        properties: {
          usedBytes: { type: "integer", minimum: 0 },
          quotaBytes: { type: "integer", minimum: 1, nullable: true },
        },
      },
    },
    ["usedBytes", "quotaBytes"],
  ),
  AuditEvent: object(
    {
      _id: id,
      requestId: text,
      actorId: id,
      tokenId: { ...text, nullable: true },
      action: text,
      target: text,
      status: { type: "integer" },
      createdAt: date,
    },
    ["_id", "action", "status"],
    true,
  ),
  upload: object(
    {
      files: {
        type: "array",
        items: { type: "string", format: "binary" },
        minItems: 1,
        maxItems: 20,
      },
      folder: {
        type: "string",
        description:
          "A custom folder slug, or all for automatic MIME categories. A restricted token must allow every resulting destination.",
      },
      expiresIn: { type: "integer", minimum: 1, maximum: 31536000 },
    },
    ["files"],
  ),
  rename: object({ name: { type: "string", minLength: 1, maxLength: 255 } }, [
    "name",
  ]),
  move: object(
    {
      folder: {
        type: "string",
        description:
          "Existing custom slug or images/videos/audio/documents/other; all detects MIME.",
      },
    },
    ["folder"],
  ),
  expiry: object(
    {
      expiresAt: {
        ...date,
        nullable: true,
        description: "Future UTC instant, or null to clear expiry.",
      },
    },
    ["expiresAt"],
  ),
  content: object(
    {
      content: {
        type: "string",
        description: "UTF-8 text, at most 2 MiB after encoding.",
      },
    },
    ["content"],
  ),
  grant: {
    ...grant,
    description:
      "Provide email or userId of an existing whitelisted account; the content owner or an administrator must perform this operation.",
  },
  revokeGrant: object({ userId: id }, ["userId"]),
  share: object({
    password: {
      type: "string",
      maxLength: 72,
      description:
        "Optional; at most 72 UTF-8 bytes, not characters. Never put it in a query string.",
    },
    expiresAt: { ...date, nullable: true },
    maxDownloads: {
      type: "integer",
      minimum: 1,
      maximum: 1000000,
      nullable: true,
    },
  }),
  folder: object(
    {
      name: { type: "string", minLength: 1, maxLength: 80 },
      description: { type: "string", maxLength: 300 },
    },
    ["name"],
  ),
  folderUpdate: object({
    name: { type: "string", minLength: 1, maxLength: 80 },
    description: { type: "string", maxLength: 300 },
  }),
  member: object(
    {
      email: { type: "string", format: "email" },
      role: {
        type: "string",
        enum: ["member", "admin"],
        default: "member",
        description: "admin additionally requires members:role.",
      },
      issueInvitation: {
        type: "boolean",
        default: false,
        description:
          "true additionally requires members:invite; otherwise no invitation is issued.",
      },
    },
    ["email"],
  ),
  role: object({ role: { type: "string", enum: ["member", "admin"] } }, [
    "role",
  ]),
  settings: object({
    siteName: { type: "string", minLength: 1, maxLength: 60 },
    defaultLocale: { type: "string", enum: ["en", "it"] },
    uploadMaxMb: {
      type: "number",
      minimum: 0,
      nullable: true,
      description: "Per-file limit in MiB. null uses UPLOAD_MAX_MB; 0 is unlimited.",
    },
    storageQuotaGb: {
      type: "number",
      minimum: 0,
      nullable: true,
      description: "Workspace quota in GiB. null uses STORAGE_QUOTA_GB; 0 is unlimited.",
    },
    userQuotaGb: {
      type: "number",
      minimum: 0,
      description: "Default quota per member in GiB; 0 is unlimited.",
    },
    maxFilesPerUpload: { type: "integer", minimum: 0, description: "0 is unlimited." },
    editorMaxMb: { type: "number", minimum: 0, description: "0 is unlimited." },
    sharingEnabled: { type: "boolean" },
    maxShareLifetimeHours: { type: "integer", minimum: 0, description: "0 is unlimited." },
    apiEnabled: { type: "boolean" },
    membersCanCreateTokens: { type: "boolean" },
    defaultTokenLifetimeDays: { type: "integer", minimum: 1 },
    maxTokenLifetimeDays: { type: "integer", minimum: 1 },
    apiRequestsPerMinute: { type: "integer", minimum: 0, description: "0 is unlimited." },
    writeRequestsPerMinute: { type: "integer", minimum: 0, description: "0 is unlimited." },
    statsRetentionDays: { type: "integer", minimum: 0, description: "0 keeps events forever." },
    googleEnabled: { type: "boolean" },
    cognitoEnabled: { type: "boolean" },
  }),
  tokenCreate: object(
    {
      ...tokenFields,
      expiresAt: date,
      ownerId: {
        ...id,
        description:
          "Defaults to self; another owner requires tokens:manage:any.",
      },
    },
    ["name", "scopes"],
  ),
  tokenUpdate: object(tokenFields),
};
const messages: Record<number, string> = {
  400: "Invalid input",
  401: "Missing, expired or revoked token",
  403: "Permission, role or resource access denied",
  404: "Resource or operation not found",
  409: "Conflict, busy file or protected owner",
  411: "Content-Length required for upload",
  413: "Request, file, quota or editor limit exceeded",
  415: "File is not editable text",
  416: "Invalid byte range",
  429: "Rate limit exceeded; Retry-After is provided",
  500: "Service error",
  503: "API disabled or service unavailable",
};
export function openApiDocument() {
  const paths: Record<string, any> = {};
  for (const operation of API_OPERATIONS) {
    const parameters: any[] = [...operation.path.matchAll(/\{(\w+)\}/g)].map(
      (match) => ({
        name: match[1],
        in: "path",
        required: true,
        schema: match[1] === "id" ? id : text,
      }),
    );
    if (
      ["/files", "/folders", "/members", "/tokens", "/audit"].includes(
        operation.path,
      ) &&
      operation.method === "GET"
    )
      parameters.push(
        {
          name: "limit",
          in: "query",
          schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
        },
        { name: "cursor", in: "query", schema: id },
      );
    if (operation.path === "/files" && operation.method === "GET")
      parameters.push(
        {
          name: "folder",
          in: "query",
          schema: text,
          description:
            "Default all includes accessible custom folders and automatic categories.",
        },
        {
          name: "search",
          in: "query",
          schema: { type: "string", maxLength: 200 },
        },
      );
    if (operation.path === "/tokens" && operation.method === "GET")
      parameters.push({
        name: "all",
        in: "query",
        schema: { type: "boolean", default: false },
        description:
          "Workspace-wide listing additionally requires tokens:manage:any.",
      });
    if (operation.binary)
      parameters.push({
        name: "Range",
        in: "header",
        schema: text,
        example: "bytes=0-1023",
      });
    let data: any = { type: "object", additionalProperties: true },
      response: any;
    if (operation.handler === "files" && operation.path === "/files")
      response = ref("FileList");
    else {
      if (
        ["file", "rename", "move", "expiry"].includes(operation.handler) ||
        operation.path.endsWith("/copy")
      )
        data = ref("File");
      else if (operation.handler === "upload") data = list(ref("File"));
      else if (
        operation.handler === "folder" ||
        (operation.handler === "folders" && operation.method !== "GET")
      )
        data = ref("Folder");
      else if (operation.path === "/folders") data = list(ref("Folder"));
      else if (operation.path === "/members")
        data = operation.method === "GET" ? list(ref("Member")) : ref("Member");
      else if (operation.handler === "shares")
        data = operation.method === "GET" ? list(ref("Share")) : ref("Share");
      else if (operation.handler === "storage") data = ref("Storage");
      else if (operation.path === "/tokens")
        data = operation.method === "GET" ? list(ref("Token")) : ref("Token");
      else if (operation.handler === "audit") data = list(ref("AuditEvent"));
      response = envelope(data);
      if (operation.path === "/tokens" && operation.method === "POST")
        response = object(
          {
            success: { type: "boolean" },
            data: ref("Token"),
            secret: {
              type: "string",
              pattern: "^edv_[a-f0-9]{64}$",
              description: "Returned once. Never stored in plaintext.",
            },
          },
          ["success", "data", "secret"],
        );
      if (operation.path === "/members" && operation.method === "POST")
        response = object(
          {
            success: { type: "boolean" },
            data: ref("Member"),
            invitation: {
              type: "string",
              description:
                "Only returned if issueInvitation=true; one-time credential.",
            },
          },
          ["success", "data"],
        );
      if (operation.path.endsWith("/content"))
        response =
          operation.method === "GET"
            ? object({ success: { type: "boolean" }, content: text }, [
                "success",
                "content",
              ])
            : object({ success: { type: "boolean" } }, ["success"]);
      if (operation.path.endsWith("/access") && operation.method === "GET")
        response = object(
          {
            success: { type: "boolean" },
            isPublic: {
              type: "boolean",
              description:
                "Legacy name: true means all whitelisted members, not the public internet.",
            },
            allowedUsers: list(
              object(
                {
                  id,
                  email: { type: "string", format: "email" },
                  username: text,
                },
                ["id", "email"],
              ),
            ),
          },
          ["success", "isPublic", "allowedUsers"],
        );
    }
    if (
      operation.method === "DELETE" ||
      ["tokenUpdate", "memberRole"].includes(operation.handler) ||
      (operation.path.endsWith("/access") && operation.method === "POST")
    )
      response = object({ success: { type: "boolean" } }, ["success"]);
    if (operation.handler === "memberInvite")
      response = object(
        { success: { type: "boolean" }, invitation: { type: "string" } },
        ["success", "invitation"],
      );
    if (
      ["/folders", "/members", "/tokens", "/audit"].includes(operation.path) &&
      operation.method === "GET"
    )
      response = {
        ...response,
        properties: { ...response.properties, pagination: ref("Pagination") },
      };
    if (operation.handler === "permissions")
      response = envelope(
        list(
          object(
            {
              scope: { type: "string", enum: permissionNames },
              description: text,
            },
            ["scope", "description"],
          ),
        ),
      );
    const created =
      (operation.method === "POST" &&
        ["/files/upload", "/folders", "/members", "/tokens"].includes(
          operation.path,
        )) ||
      (operation.method === "POST" && operation.path.endsWith("/shares")) ||
      operation.path.endsWith("/copy");
    const responses: Record<string, any> = {
      [created ? "201" : "200"]: {
        description: "Success",
        content: operation.binary
          ? {
              "application/octet-stream": {
                schema: { type: "string", format: "binary" },
              },
            }
          : { "application/json": { schema: response } },
        headers: {
          "X-Request-Id": {
            schema: text,
            description: "Correlation identifier",
          },
        },
      },
    };
    if (operation.binary)
      responses["206"] = {
        description: "Partial content",
        content: {
          "application/octet-stream": {
            schema: { type: "string", format: "binary" },
          },
        },
        headers: {
          "Content-Range": { schema: text },
          "Accept-Ranges": { schema: text },
        },
      };
    for (const [status, description] of Object.entries(messages))
      responses[status] = {
        description,
        content: { "application/json": { schema: ref("Error") } },
      };
    const op: any = {
      operationId: `${operation.method.toLowerCase()}${operation.path.replace(/[^a-zA-Z0-9]/g, "_")}`,
      summary: operation.summary,
      tags: [operation.path.split("/")[1]],
      security: [{ bearerAuth: [] }],
      parameters,
      responses,
      "x-permissions": operation.scope ? [operation.scope] : [],
    };
    if (operation.body)
      op.requestBody = {
        required: true,
        content: {
          [operation.body === "upload"
            ? "multipart/form-data"
            : "application/json"]: { schema: ref(operation.body) },
        },
      };
    paths[operation.path] ||= {};
    paths[operation.path][operation.method.toLowerCase()] = op;
  }
  return {
    openapi: "3.0.3",
    info: {
      title: "ErvisioDrive API",
      version: "1.1.0",
      description:
        "Versioned Bearer API. Every request rechecks the token, whitelist, current owner role, resource restrictions and content ACL. Tokens cannot delegate scopes, resources or lifetimes beyond their own. Workspace roles are not inferred from Cognito groups. See docs/API.md for examples and security semantics.",
    },
    servers: [{ url: "/api/v1" }],
    security: [{ bearerAuth: [] }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "edv_<64 lowercase hexadecimal characters>",
        },
      },
      schemas,
    },
    "x-permission-catalog": PERMISSIONS,
  };
}
