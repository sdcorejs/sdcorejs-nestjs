# Package root

Import path: `@sdcorejs/nestjs`

The root entrypoint bootstraps the library and re-exports the contracts most applications need in
their root module. Use the documented subpaths for complete feature-specific APIs.

## Bootstrap

```ts
import { Module } from '@nestjs/common';
import { SdCoreModule } from '@sdcorejs/nestjs';
import { z } from 'zod';

const PrincipalSchema = z.object({
  sub: z.string().min(1),
  tenant: z.string().min(1).max(64),
  roles: z.array(z.string().min(1)).optional(),
});

@Module({
  imports: [
    SdCoreModule.forRoot({
      context: {
        identity: {
          principalResolver: (principal: unknown) => {
            const claims = PrincipalSchema.parse(principal);
            return {
              userId: claims.sub,
              tenant: claims.tenant,
              roles: claims.roles,
            };
          },
        },
      },
      cache: { backend: 'memory', ttl: 60, maxEntries: 1_000 },
      http: {
        baseURL: 'https://inventory.internal.example',
        trustedOrigins: ['https://inventory.internal.example'],
      },
      jwt: {
        jwks: { allowedIssuerHosts: ['https://identity.example.com'] },
        audience: 'inventory-api',
      },
      i18n: { supportedLanguages: ['en', 'vi'], fallbackLanguage: 'en' },
    }),
  ],
})
export class AppModule {}
```

`SdCoreModule.forRoot(options?: SdCoreModuleOptions): DynamicModule` is global. Context, tenancy,
audit, permission, cache and HTTP modules are always wired. JWT, i18n, uploaded files, action
history, job scheduler and BullMQ are wired only when their corresponding option is present.

### `SdCoreModuleOptions`

| Property | Type | Default / effect |
| --- | --- | --- |
| `context` | `ContextModuleOptions` | Default headers; verified-principal mapper; trusted-header mode off |
| `tenancy` | `TenancyModuleOptions` | Fail-closed default strategy for scoped entities |
| `audit` | `AuditModuleOptions` | `DefaultAuditStrategy` |
| `permission` | `PermissionModuleOptions` | Deny-all `DefaultPermissionStrategy` |
| `cache` | `CacheConfig` | In-memory LRU, TTL 60 seconds, 1,000 entries |
| `http` | `HttpClientConfig` | 30-second timeout; no trusted propagation origins |
| `jwt` | `JwtConfig` | Omit to disable JWT module wiring |
| `i18n` | `I18nModuleOptions` | Omit to leave library error messages untranslated |
| `internalSecret` | `{ envVar?: string } \| { key: string }` | Omit to register no built-in internal secret; static `key` is deprecated |
| `uploadedFile` | `UploadedFileConfig` | Omit to disable uploaded-file providers |
| `actionHistory` | `ActionHistoryModuleOptions` | Omit to disable action-history providers |
| `jobScheduler` | `JobSchedulerModuleOptions` | Omit to disable database job-lock providers |
| `queue` | `QueueModuleConfig` | Omit to disable BullMQ wiring |
| `providers` | `Provider[]` | Extra global extension providers |

Prefer an environment-backed or rotating implementation of `IInternalSecretProvider`; never embed
production secrets in source.

## Root export table

| Export | Kind | Purpose |
| --- | --- | --- |
| `SdCoreModule` | class | Global composition module; `forRoot(options?)` |
| `SdCoreModuleOptions`, `InternalSecretConfig` | types | Root configuration contracts |
| `ContextService` | class | AsyncLocalStorage-backed request context |
| `ContextIdentityOptions`, `HeadersConfig`, `IdentityContextSource`, `RequestContext` | types | Request-context configuration and store shape |
| `ResolvedContextIdentity`, `ResolvedContextIdentityOptions`, `TrustedHeaderIdentityOptions`, `VerifiedPrincipalResolver` | types | Trusted identity mapping contracts |
| `defaultVerifiedPrincipalResolver` | function | Conservative mapper for `sub`/`userId`/`id` claims |
| `CONTEXT_HEADERS_CONFIG`, `CONTEXT_IDENTITY_CONFIG` | values | Context DI tokens |
| `ITenancyStrategy`, `IAuditStrategy`, `IPermissionStrategy` | types | Tenancy, audit and permission extension contracts |
| `TENANCY_STRATEGY`, `AUDIT_STRATEGY`, `PERMISSION_STRATEGY` | values | Strategy DI tokens |
| `PERMISSION_METADATA_KEY` | value | Permission decorator metadata key |
| `HasPermission`, `HasAnyPermission` | decorators | Attach required permission codes |
| `InternalGuard`, `INTERNAL_SECRET_HEADER` | class/value | Internal-call guard and default `x-internal-secret` header |
| `IInternalSecretProvider`, `INTERNAL_SECRET_PROVIDER` | type/value | Rotatable secret source and DI token |
| `IInternalContextEnricher`, `INTERNAL_CONTEXT_ENRICHER` | type/value | Post-secret trusted-context hook and DI token |
| `ApiErrorBody`, `ApiResponseEnvelope` | types | Standard error and response shapes |
| `apiError`, `ApiResponse` | values | Response-envelope helpers |
| `ZodValidationGuard`, `parseZod` | functions | Zod request guard factory and direct parser |
| `ZodSchemaMap`, `ZodSource`, `ZodIssueDetail` | types | Validation source and issue contracts |
| `II18nResolver`, `ILanguageResolver` | types | Translation and language-resolution contracts |
| `I18N_RESOLVER`, `LANGUAGE_RESOLVER` | values | i18n DI tokens |

## Response helpers

```ts
interface ApiErrorBody {
  code: string;
  message: string;
  data?: Record<string, unknown>;
}

interface ApiResponseEnvelope<T = unknown> {
  data?: T;
  error?: ApiErrorBody;
}
```

`ApiResponse.ok(data)`, `ApiResponse.noContent()` and `ApiResponse.error(code, message, data?)`
construct envelopes. `apiError(code, message, data?)` constructs the body expected by library
exception handling.

## Related reference

- [Request context](./core/context.md)
- [Multi-tenancy](./core/tenancy.md)
- [JWT and JWKS](./auth/jwt.md)
- [Permissions and internal calls](./auth/permissions.md)
- [Validation](./validation.md)
