import type { Actor } from "@/lib/policy";
import { fail } from "@/lib/http";

import { permissionNames, type Permission } from "@/lib/permissions-catalog";
export * from "@/lib/permissions-catalog";
const adminOnly = new Set<Permission>([
  "members:list",
  "members:create",
  "members:role",
  "members:revoke",
  "members:invite",
  "settings:read",
  "settings:write",
  "tokens:manage:any",
  "audit:read",
]);
export function allowedPermissions(actor: Actor): Permission[] {
  return permissionNames.filter(
    (p) => actor.role === "admin" || !adminOnly.has(p),
  );
}
export function hasPermission(actor: Actor, scope: Permission) {
  return (
    allowedPermissions(actor).includes(scope) &&
    (!actor.api || actor.api.scopes.includes(scope))
  );
}
export function requirePermission(actor: Actor, ...scopes: Permission[]) {
  for (const scope of scopes)
    if (!hasPermission(actor, scope)) fail(403, `Missing permission: ${scope}`);
}
export function parsePermissions(value: unknown): Permission[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > permissionNames.length ||
    value.some(
      (p) =>
        typeof p !== "string" || !permissionNames.includes(p as Permission),
    )
  )
    fail(400, "Choose valid explicit permissions");
  return [...new Set(value as string[])] as Permission[];
}
