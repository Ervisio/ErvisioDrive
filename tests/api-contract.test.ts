import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import SwaggerParser from "@apidevtools/swagger-parser";
import { openApiDocument } from "../lib/openapi";
import { API_OPERATIONS, matchOperation } from "../lib/api-operations";
import { permissionNames } from "../lib/permissions-catalog";
import { translate } from "../lib/i18n/core";
test("OpenAPI is valid, contains every operation and has no undocumented runtime scopes", async () => {
  const document = openApiDocument();
  await SwaggerParser.validate(JSON.parse(JSON.stringify(document)));
  assert.equal(
    Object.values(document.paths).reduce(
      (n: any, path: any) => n + Object.keys(path).length,
      0,
    ),
    API_OPERATIONS.length,
  );
  for (const op of API_OPERATIONS) {
    const match = matchOperation(
      op.method,
      op.path
        .split("/")
        .filter(Boolean)
        .map((s) => (s.startsWith("{") ? "0123456789abcdef01234567" : s)),
    );
    assert.equal(match?.operation, op);
    if (op.scope) assert.ok(permissionNames.includes(op.scope));
  }
  assert.equal(matchOperation("POST", ["files", "anything", "download"]), null);
  assert.deepEqual(
    JSON.parse(fs.readFileSync("docs/openapi.json", "utf8")),
    document,
  );
});
test("English is canonical; Italian supports interpolation without translating file names", () => {
  assert.equal(translate("en", "Upload"), "Upload");
  assert.equal(translate("it", "Upload"), "Carica");
  assert.equal(
    translate("it", 'Move "{name}" to "{folder}"?', {
      name: "report.txt",
      folder: "My folder",
    }),
    'Spostare "report.txt" in "My folder"?',
  );
  assert.equal(translate("en", "Unrecognized label"), "Unrecognized label");
  assert.equal(translate("it", "constructor"), "constructor");
});
