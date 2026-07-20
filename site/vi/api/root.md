# Package root {#package-root}

Đường dẫn import: `@sdcorejs/nestjs`

Entrypoint root bootstrap thư viện và re-export những contract mà phần lớn ứng dụng cần trong root
module. Dùng các subpath đã được tài liệu hóa để truy cập đầy đủ API theo từng feature.

## Bootstrap {#bootstrap}

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

`SdCoreModule.forRoot(options?: SdCoreModuleOptions): DynamicModule` là global. Các module context,
tenancy, audit, permission, cache và HTTP luôn được nối dây. JWT, i18n, uploaded files, action
history, job scheduler và BullMQ chỉ được nối dây khi có option tương ứng.

### `SdCoreModuleOptions` {#sdcoremoduleoptions}

| Thuộc tính | Kiểu | Mặc định / tác động |
| --- | --- | --- |
| `context` | `ContextModuleOptions` | Header mặc định; mapper verified-principal; chế độ trusted-header tắt |
| `tenancy` | `TenancyModuleOptions` | Strategy mặc định fail-closed cho entity có scope |
| `audit` | `AuditModuleOptions` | `DefaultAuditStrategy` |
| `permission` | `PermissionModuleOptions` | `DefaultPermissionStrategy` deny-all |
| `cache` | `CacheConfig` | LRU trong bộ nhớ, TTL 60 giây, 1,000 entry |
| `http` | `HttpClientConfig` | Timeout 30 giây; không có origin truyền tiếp tin cậy |
| `jwt` | `JwtConfig` | Bỏ qua để tắt việc nối dây module JWT |
| `i18n` | `I18nModuleOptions` | Bỏ qua để không dịch thông báo lỗi của thư viện |
| `internalSecret` | `{ envVar?: string } \| { key: string }` | Bỏ qua để không đăng ký internal secret tích hợp; `key` tĩnh đã deprecated |
| `uploadedFile` | `UploadedFileConfig` | Bỏ qua để tắt provider uploaded-file |
| `actionHistory` | `ActionHistoryModuleOptions` | Bỏ qua để tắt provider action-history |
| `jobScheduler` | `JobSchedulerModuleOptions` | Bỏ qua để tắt provider khóa job trong cơ sở dữ liệu |
| `queue` | `QueueModuleConfig` | Bỏ qua để tắt việc nối dây BullMQ |
| `providers` | `Provider[]` | Provider mở rộng global bổ sung |

Nên dùng triển khai `IInternalSecretProvider` dựa trên môi trường hoặc có khả năng xoay vòng;
không bao giờ nhúng secret production vào source.

## Bảng export của root {#root-export-table}

| Export | Loại | Mục đích |
| --- | --- | --- |
| `SdCoreModule` | class | Module kết hợp global; `forRoot(options?)` |
| `SdCoreModuleOptions`, `InternalSecretConfig` | type | Contract cấu hình root |
| `ContextService` | class | Request context dựa trên AsyncLocalStorage |
| `ContextIdentityOptions`, `HeadersConfig`, `IdentityContextSource`, `RequestContext` | type | Cấu hình request-context và hình dạng store |
| `ResolvedContextIdentity`, `ResolvedContextIdentityOptions`, `TrustedHeaderIdentityOptions`, `VerifiedPrincipalResolver` | type | Contract ánh xạ danh tính tin cậy |
| `defaultVerifiedPrincipalResolver` | function | Mapper thận trọng cho claim `sub`/`userId`/`id` |
| `CONTEXT_HEADERS_CONFIG`, `CONTEXT_IDENTITY_CONFIG` | value | DI token của context |
| `ITenancyStrategy`, `IAuditStrategy`, `IPermissionStrategy` | type | Contract mở rộng tenancy, audit và permission |
| `TENANCY_STRATEGY`, `AUDIT_STRATEGY`, `PERMISSION_STRATEGY` | value | DI token của strategy |
| `PERMISSION_METADATA_KEY` | value | Khóa metadata của decorator permission |
| `HasPermission`, `HasAnyPermission` | decorator | Gắn các mã permission bắt buộc |
| `InternalGuard`, `INTERNAL_SECRET_HEADER` | class/value | Guard lời gọi nội bộ và header `x-internal-secret` mặc định |
| `IInternalSecretProvider`, `INTERNAL_SECRET_PROVIDER` | type/value | Nguồn secret có thể xoay vòng và DI token |
| `IInternalContextEnricher`, `INTERNAL_CONTEXT_ENRICHER` | type/value | Hook trusted-context sau khi xác minh secret và DI token |
| `ApiErrorBody`, `ApiResponseEnvelope` | type | Hình dạng error và response chuẩn |
| `apiError`, `ApiResponse` | value | Helper tạo response envelope |
| `ZodValidationGuard`, `parseZod` | function | Factory guard request Zod và parser trực tiếp |
| `ZodSchemaMap`, `ZodSource`, `ZodIssueDetail` | type | Contract nguồn validation và issue |
| `II18nResolver`, `ILanguageResolver` | type | Contract dịch và phân giải ngôn ngữ |
| `I18N_RESOLVER`, `LANGUAGE_RESOLVER` | value | DI token i18n |

## Helper response {#response-helpers}

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

`ApiResponse.ok(data)`, `ApiResponse.noContent()` và `ApiResponse.error(code, message, data?)` tạo
envelope. `apiError(code, message, data?)` tạo body mà cơ chế xử lý exception của thư viện mong đợi.

## Tham chiếu liên quan {#related-reference}

- [Request context](./core/context.md)
- [Multi-tenancy](./core/tenancy.md)
- [JWT và JWKS](./auth/jwt.md)
- [Permission và lời gọi nội bộ](./auth/permissions.md)
- [Validation](./validation.md)
