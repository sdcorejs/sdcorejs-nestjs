# API tiện ích {#utilities-api}

Đường dẫn import: `@sdcorejs/nestjs/utils`.

## SingleFlightService {#singleflightservice}

`SingleFlightService` chia sẻ công việc đang chờ theo khóa chuỗi trong một instance và một process.
`run<T>(key, factory): Promise<T>` nhận giá trị đồng bộ hoặc kết quả Promise-like. Factory đầu tiên
chạy ngay sau khi đăng ký; các lời gọi đồng thời nhận cùng promise và kết quả/lỗi.
Kết quả thành công, promise reject và lỗi throw đồng bộ đều được dọn trước khi caller nhận
kết quả. Lời gọi sau sẽ chạy factory mới. Tiện ích không cache kết quả hoặc tự retry.

Đăng ký class trong providers của module và export provider đó nếu các module khác cần dùng
chung, hoặc giữ instance riêng cho namespace độc lập. Tiện ích không tự đăng ký global.
Các khóa và instance khác nhau chạy độc lập. Cùng khóa phải mô tả công việc tương đương
với cùng kiểu kết quả, kể cả khi caller truyền các factory khác nhau.

## Công việc không cache {#non-cache-work}

```ts
import { Injectable, Module } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { SingleFlightService } from '@sdcorejs/nestjs/utils';

@Injectable()
export class DiscoveryService {
  constructor(private readonly flights: SingleFlightService) {}

  read<T>(trusted: {
    tenant: string; realm: string; clientId: string;
    credentialVersion: string; permissionVersion: string;
    userId: string; permissions: string[]; resourceId: string;
  }, fetchAuthorized: () => Promise<T>): Promise<T> {
    const key = createHash('sha256').update(JSON.stringify([
      'discovery:v1', trusted.tenant, trusted.realm, trusted.clientId,
      trusted.credentialVersion, trusted.permissionVersion, trusted.userId,
      [...trusted.permissions].sort(), trusted.resourceId,
    ])).digest('hex');
    return this.flights.run(key, fetchAuthorized);
  }
}

@Module({ providers: [SingleFlightService, DiscoveryService] })
export class DiscoveryModule {}
```

Kiểm tra quyền từng caller trước khi tham gia flight. Tạo khóa từ context server tin cậy và
bao gồm mọi đầu vào ảnh hưởng kết quả: tenant, realm, client, phiên bản credential, user và
phạm vi quyền. Hash không cấp quyền truy cập. Không đưa credential vào khóa hoặc log khóa thô,
token hay giá trị bí mật. Tiện ích không tự log hoặc kiểm tra quyền.

## Công việc có cache {#cache-work}

Dùng `CacheService.load` khi cần cache kết quả; dịch vụ đã dùng các instance single-flight
riêng cho đọc và factory. Không cần bọc thêm.

```ts
import { CacheService } from '@sdcorejs/nestjs/services';

export async function cachedRead<T>(
  cache: CacheService,
  trustedScopedKey: string,
  fetchAuthorized: () => Promise<T>,
): Promise<T> {
  return cache.load(trustedScopedKey, fetchAuthorized, 60);
}
```

Quy tắc khóa tin cậy cũng áp dụng cho lời gọi cache trực tiếp. `@Cached` tiếp tục tạo scope
tenant/user riêng. Xem [API Cache](./services/cache).

## Vòng đời và giới hạn {#lifetime-and-limits}

Không có API cancellation, deadline, eviction hay giới hạn số công việc đồng thời. Factory
không kết thúc sẽ giữ khóa và các caller chờ; consumer cần giới hạn thao tác bên dưới.
Không gắn công việc dùng chung với abort signal của một caller trừ khi muốn hủy cho tất cả.
Timeout ngừng chờ không chứng minh side effect bên dưới đã dừng.

Factory không được await flight của chính nó, trực tiếp hoặc gián tiếp; vòng phụ thuộc cùng
khóa có thể chờ vô hạn. Có thể kết hợp các khóa khác nhau nếu không có vòng phụ thuộc.
Tiện ích không thay database lock, distributed lock hoặc bảo đảm idempotency bền vững.
Process khác và các lời gọi sau vẫn có thể thực thi lại thao tác.
