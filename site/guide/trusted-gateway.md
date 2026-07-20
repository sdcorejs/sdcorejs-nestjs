# Trusted gateway identity

Trusted-header mode is for deployments where a gateway authenticates the caller and forwards
integrity-protected identity. It is not a shortcut for accepting public `X-User-Id` or
`X-Tenant` headers.

## Required trust proof

```ts
import { timingSafeEqual } from 'node:crypto';
import { SdCoreModule } from '@sdcorejs/nestjs';

function equalSecret(left: string | undefined, right: string): boolean {
  if (!left) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

const gatewayProof = process.env.GATEWAY_PROOF;
if (!gatewayProof) throw new Error('GATEWAY_PROOF is required');

SdCoreModule.forRoot({
  context: {
    headers: {
      tenant: 'x-tenant',
      userId: 'x-user-id',
      customHeaders: { departmentCode: 'x-department-code' },
    },
    identity: {
      trustedHeaders: {
        isTrustedRequest: (request) => {
          const proof = request.headers['x-gateway-proof'];
          return typeof proof === 'string' && equalSecret(proof, gatewayProof);
        },
      },
    },
  },
});
```

This is a minimal shared-secret example, not a complete edge design. The gateway must remove
caller-supplied identity/proof headers before adding its own, the backend must not be publicly
reachable around the gateway, and the secret must rotate. Prefer mTLS or signed headers with
timestamp/replay protection when the platform supports them.

## Custom resolution

Use `trustedHeaders.resolve` when one verified header contains a signed/encrypted identity envelope:

```ts
trustedHeaders: {
  isTrustedRequest: verifyGatewayBoundary,
  resolve: (request) => {
    const envelope = verifyAndDecodeIdentityEnvelope(request);
    return {
      userId: envelope.subject,
      tenant: envelope.tenant,
      roles: envelope.roles,
      custom: { departmentCode: envelope.department },
    };
  },
},
```

`verifyGatewayBoundary` and `verifyAndDecodeIdentityEnvelope` are application security placeholders,
not library APIs. They must verify authenticity and freshness before returning data.

## Combining gateway and JWT

A request may first receive trusted gateway identity and later pass `AuthGuard`. The guard compares
overlapping user, tenant, roles, permissions, permission version, and custom identity fields. A
conflict returns 401; non-conflicting values are merged and the final source becomes
`verified-principal`.

## Operational checks

- Confirm direct backend access is blocked.
- Confirm the gateway strips all inbound identity headers.
- Test a forged identity header without valid gateway proof; it must return 401.
- Test a gateway/JWT tenant conflict; it must return 401.
- Include replay controls when the trust proof is a request signature.
- Do not log proof secrets or authorization tokens.
