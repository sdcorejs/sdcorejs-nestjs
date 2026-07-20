# Lời gọi service nội bộ {#internal-service-calls}

`InternalGuard` bảo vệ các route được chọn bằng `X-Internal-Secret`. Guard so sánh giá trị được cung cấp
trong thời gian không đổi và có thể chấp nhận nhiều khóa đang hoạt động trong quá trình luân chuyển.

## Provider biến môi trường tích hợp {#built-in-environment-provider}

```ts
import { Controller, Post, UseGuards } from '@nestjs/common';
import { SdCoreModule } from '@sdcorejs/nestjs';
import { InternalGuard } from '@sdcorejs/nestjs/auth';

SdCoreModule.forRoot({
  internalSecret: { envVar: 'INTERNAL_SECRET_KEY' },
});

@Controller('internal/reindex')
export class ReindexController {
  @Post()
  @UseGuards(InternalGuard)
  run() {
    return { accepted: true };
  }
}
```

Nếu biến môi trường không tồn tại, không header nào có thể khớp. Nếu hoàn toàn không đăng ký provider,
việc dùng `InternalGuard` sẽ trả về lỗi cấu hình tại thời điểm xử lý request.

## Provider luân chuyển {#rotating-provider}

```ts
import { Injectable } from '@nestjs/common';
import { SdCoreModule } from '@sdcorejs/nestjs';
import {
  INTERNAL_SECRET_PROVIDER,
  type IInternalSecretProvider,
} from '@sdcorejs/nestjs/auth';

@Injectable()
class RotatingInternalSecretProvider implements IInternalSecretProvider {
  getKey(): string {
    return process.env.INTERNAL_SECRET_CURRENT ?? '';
  }

  getKeys(): string[] {
    return [
      process.env.INTERNAL_SECRET_CURRENT,
      process.env.INTERNAL_SECRET_NEXT,
    ].filter((value): value is string => Boolean(value));
  }
}

SdCoreModule.forRoot({
  providers: [{
    provide: INTERNAL_SECRET_PROVIDER,
    useClass: RotatingInternalSecretProvider,
  }],
});
```

Khi có `getKeys()`, guard kiểm tra các giá trị đó và bỏ qua `getKey()`. Giữ khoảng thời gian
chồng lấn ngắn.

## Bổ sung context đáng tin cậy sau khi xác thực {#enrich-trusted-context-after-authentication}

```ts
import { Injectable } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { SdCoreModule } from '@sdcorejs/nestjs';
import { ContextService } from '@sdcorejs/nestjs/core';
import {
  INTERNAL_CONTEXT_ENRICHER,
  type IInternalContextEnricher,
} from '@sdcorejs/nestjs/auth';

@Injectable()
class InternalContextEnricher implements IInternalContextEnricher {
  constructor(private readonly context: ContextService) {}

  enrich(request: IncomingMessage): void {
    const tenant = request.headers['x-tenant'];
    if (typeof tenant === 'string') this.context.set('tenant', tenant);
    this.context.set('custom', { internalCaller: 'inventory-service' });
  }
}

SdCoreModule.forRoot({
  providers: [{
    provide: INTERNAL_CONTEXT_ENRICHER,
    useClass: InternalContextEnricher,
  }],
});
```

Enricher chỉ chạy sau khi secret khớp. Nó không thay thế tenancy hoặc phân quyền tài nguyên:
hãy validate mọi giá trị được bổ sung và duy trì các policy downstream.

## Lời gọi outbound {#outbound-call}

```ts
import { Injectable } from '@nestjs/common';
import { HttpService } from '@sdcorejs/nestjs/services';

@Injectable()
class InventoryClient {
  constructor(private readonly http: HttpService) {}

  reindex(productIds: string[], internalSecret: string) {
    return this.http.post(
      '/internal/reindex',
      { productIds },
      { headers: { 'x-internal-secret': internalSecret } },
    );
  }
}
```

Cấu hình origin đích trong `http.trustedOrigins`; nếu không, client sẽ loại bỏ
`x-internal-secret`. Client không tự tạo secret này cho bạn.

Shared secret nội bộ bổ sung chứ không thay thế TLS, network policy, rate limit và danh tính service.
Ưu tiên workload identity/mTLS khi có thể.
