import type { ResolvedContextIdentity, VerifiedPrincipalResolver } from './types';

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const stringOf = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
};

const stringsOf = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter((entry): entry is string => typeof entry === 'string');
  return values.length === value.length ? values : undefined;
};

/**
 * Conservative default mapper for a Passport-verified principal.
 *
 * It accepts common `sub`/`id`/`userId` identifiers plus explicit `tenant`/`tenantId`, `roles`,
 * `permissions`, and `permissionVersion` fields. Applications with different claim names should
 * configure `context.identity.principalResolver` instead of copying unverified request headers.
 */
export const defaultVerifiedPrincipalResolver: VerifiedPrincipalResolver = (principal): ResolvedContextIdentity => {
  const value = recordOf(principal);
  const userId = stringOf(value?.sub) ?? stringOf(value?.userId) ?? stringOf(value?.id);
  if (!value || !userId) {
    throw new Error('Verified principal does not contain a non-empty sub, userId, or id claim');
  }
  const tenant = stringOf(value.tenant) ?? stringOf(value.tenantId);
  const roles = stringsOf(value.roles);
  const permissions = stringsOf(value.permissions);
  const permissionVersion = stringOf(value.permissionVersion);
  if ((value.tenant !== undefined || value.tenantId !== undefined) && !tenant) {
    throw new Error('Verified principal tenant must be a non-empty identifier');
  }
  if (value.roles !== undefined && !roles) throw new Error('Verified principal roles must be a string array');
  if (value.permissions !== undefined && !permissions) throw new Error('Verified principal permissions must be a string array');
  if (value.permissionVersion !== undefined && !permissionVersion) {
    throw new Error('Verified principal permissionVersion must be a non-empty identifier');
  }

  return {
    userId,
    tenant,
    roles,
    permissions,
    permissionVersion,
  };
};

/** Clone and runtime-check identity values before placing them in AsyncLocalStorage. */
export function normalizeContextIdentity(value: Partial<ResolvedContextIdentity>, requireUserId: true): ResolvedContextIdentity;
export function normalizeContextIdentity(value: Partial<ResolvedContextIdentity>, requireUserId?: false): Partial<ResolvedContextIdentity>;
export function normalizeContextIdentity(value: Partial<ResolvedContextIdentity>, requireUserId = false): Partial<ResolvedContextIdentity> {
  const input = recordOf(value);
  if (!input) throw new Error('Resolved identity must be an object');

  const userId = stringOf(input.userId);
  if (requireUserId && !userId) throw new Error('Resolved verified identity must contain a non-empty userId');

  const tenant = stringOf(input.tenant);
  const roles = input.roles === undefined ? undefined : stringsOf(input.roles);
  const permissions = input.permissions === undefined ? undefined : stringsOf(input.permissions);
  const permissionVersion = input.permissionVersion === undefined ? undefined : stringOf(input.permissionVersion);
  const custom = input.custom === undefined ? undefined : recordOf(input.custom);
  if (input.userId !== undefined && !userId) throw new Error('Resolved identity userId must be a non-empty string');
  if (input.tenant !== undefined && !tenant) throw new Error('Resolved identity tenant must be a non-empty string');
  if (input.roles !== undefined && !roles) throw new Error('Resolved identity roles must be a string array');
  if (input.permissions !== undefined && !permissions) throw new Error('Resolved identity permissions must be a string array');
  if (input.permissionVersion !== undefined && !permissionVersion) {
    throw new Error('Resolved identity permissionVersion must be a non-empty string');
  }
  if (input.custom !== undefined && !custom) throw new Error('Resolved identity custom values must be an object');

  return {
    userId,
    tenant,
    roles: roles ? [...roles] : undefined,
    permissions: permissions ? [...permissions] : undefined,
    permissionVersion,
    custom: custom ? { ...custom } : undefined,
  };
}
