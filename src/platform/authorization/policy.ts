export type MembershipPermission = { role: { permissions: Array<{ permission: { key: string } }> } };

export function membershipHasPermission(roles: MembershipPermission[], requiredPermission: string) {
  return roles.some(({ role }) => role.permissions.some(({ permission }) => permission.key === requiredPermission));
}
