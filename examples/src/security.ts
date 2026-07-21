import { Injectable } from '@nestjs/common';
import type { JwtPayload, IPermissionStrategy } from '@sdcorejs/nestjs/auth';
import type { ITenancyStrategy, RequestContext, VerifiedPrincipalResolver } from '@sdcorejs/nestjs/core';

type ClaimRecord = Record<string, unknown>;

const record = (value: unknown): ClaimRecord | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as ClaimRecord) : undefined;

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const stringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === 'string') ? [...new Set(value)] : undefined;

/**
 * Maps only claims from a passport-verified Keycloak token. Request headers are not trusted as an
 * identity source; `AuthGuard` calls this resolver after signature, issuer, audience and expiry
 * validation has succeeded.
 */
export const mapKeycloakPrincipal: VerifiedPrincipalResolver = (principal) => {
  const claims = record(principal) as (JwtPayload & ClaimRecord) | undefined;
  const userId = nonEmptyString(claims?.sub);
  const tenant = nonEmptyString(claims?.tenant_code);
  if (!claims || !userId || !tenant) {
    throw new Error('Verified Keycloak principal must contain non-empty sub and tenant_code claims');
  }

  const realmAccess = record(claims.realm_access);
  const roles = stringArray(realmAccess?.roles);
  const permissions = stringArray(claims.permissions);
  const permissionVersion = nonEmptyString(claims.permission_version);
  const username = nonEmptyString(claims.preferred_username);
  const fullName = nonEmptyString(claims.name);
  const custom: Record<string, unknown> = {};
  if (username) custom.username = username;
  if (fullName) custom.fullName = fullName;

  return {
    userId,
    tenant,
    roles,
    permissions: permissions?.length ? permissions : undefined,
    permissionVersion,
    custom: Object.keys(custom).length ? custom : undefined,
  };
};

@Injectable()
export class AppTenancyStrategy implements ITenancyStrategy {
  getCurrentScope(context: RequestContext): Record<string, unknown> {
    return { tenantCode: context.tenant };
  }

  shouldBypass(_context: RequestContext): boolean {
    return false;
  }
}

@Injectable()
export class AppPermissionStrategy implements IPermissionStrategy {
  async load(context: RequestContext): Promise<string[]> {
    const permissions = new Set(context.permissions ?? []);

    for (const role of context.roles ?? []) {
      if (role === 'catalog-reader') permissions.add('catalog_product:read');
      if (role === 'catalog-editor') {
        permissions.add('catalog_product:read');
        permissions.add('catalog_product:create');
      }
      if (role === 'tenant-auditor') permissions.add('action_history:read');
      if (role === 'tenant-file-admin') permissions.add('uploaded_file:read-tenant');
    }

    return [...permissions].sort();
  }
}
