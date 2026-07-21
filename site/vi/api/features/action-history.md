# API lịch sử thao tác {#action-history-api}

Đường dẫn import: `@sdcorejs/nestjs/features`

Action history lưu snapshot trước/sau có scope tenant cho thay đổi resource. Có thể gọi trực tiếp
hoặc đăng ký làm history recorder được `BaseRepository({ logHistory: true })` sử dụng.

## Các export {#exports}

| Export | Loại | Mục đích |
| --- | --- | --- |
| `ActionHistory` | entity class | Hàng PostgreSQL `action-history` |
| `ActionHistoryType` | enum | `CREATE`, `UPDATE`, `DELETE` |
| `ActionHistorySaveReq<T>` | interface | Request ghi thủ công |
| `ActionHistoryDTO<T>` | interface | Hàng đã serialize |
| `ActionHistoryActor`, `ActionHistoryActorResolver` | type | Ánh xạ actor theo từng request |
| `ACTION_HISTORY_ACTOR_RESOLVER` | value | DI token của actor resolver |
| `ActionHistoryQuery`, `ActionHistoryPage<T>` | interface | Query/kết quả resource có giới hạn |
| `ActionHistoryAuthorizationRequest`, `ActionHistoryAuthorizationPolicy` | type | Đầu vào/callback read policy bắt buộc |
| `ActionHistorySnapshotRedactor` | type | Biến đổi trước khi che dữ liệu, tùy chọn |
| `ActionHistoryResourceTenantRequest`, `ActionHistoryResourceTenantResolver` | type | Ánh xạ scope resource đã persist sang tenant |
| `ActionHistorySecurityOptions` | interface | Policy đọc, che dữ liệu, tenant, trang và retention |
| `ACTION_HISTORY_SECURITY_OPTIONS` | value | DI token của security policy |
| `ActionHistoryService` | class | API `create`, `record` và `all` |
| `ActionHistoryModule`, `ActionHistoryModuleOptions` | class/type | Đăng ký feature và recorder |
| `ActionHistoryController` | class | Endpoint đọc có xác thực, tùy chọn |
| `MissingActionHistoryTenantError` | class | Lần ghi thủ công không có tenant tin cậy |
| `MissingActionHistoryResourceTenantError` | class | Scope đã persist không thể ánh xạ an toàn về một tenant |
| `ActionHistorySnapshotLimitError` | class | Snapshot vượt giới hạn phòng vệ |

## Thiết lập entity và module {#entity-and-module-setup}

```ts
TypeOrmModule.forRoot({
  type: 'postgres',
  // ...
  entities: [ActionHistory, Product],
});

ActionHistoryModule.forRoot({
  authorizeRead: ({ context, tenantCode, table, tableId }) =>
    context.tenant === tenantCode &&
    context.permissions?.includes(`${table}:history:read`) === true,
  resolveActor: (ctx) => ({
    userId: ctx.userId,
    username: ctx.getCustom<string>('username'),
    fullName: ctx.getCustom<string>('fullName'),
  }),
  redactFields: ['payment.cardNumber'],
  maxPageSize: 100,
  retentionDays: 365,
});
```

Thêm `ActionHistory` vào datasource. Entity dùng enum PostgreSQL, UUID và snapshot JSONB. `global`
và `registerAsHistoryRecorder` đều mặc định là `true`. `retentionDays` chỉ là gợi ý vận hành; thư
viện không bao giờ tự động xóa history.

## History repository tự động {#automatic-repository-history}

```ts
export class ProductRepository extends BaseRepository<Product> {
  constructor(dataSource: DataSource) {
    super(Product, dataSource, { logHistory: true });
  }
}
```

Create/update/hard-delete của repository phát `HistoryEntry` trong cùng transaction. Loại resource
ổn định là `EntityMetadata.tablePath` của TypeORM, bao gồm schema. Với entity có scope, tenant được
quy về từ giá trị scope lấy từ hàng đã persist—không phải đầu vào DTO/request.

Ánh xạ mặc định đọc `resourceScope.tenantCode`. Nếu entity dùng thuộc tính tenant khác, hãy cấu hình
`resolveResourceTenant` đồng bộ:

```ts
resolveResourceTenant: ({ resourceScope }) =>
  typeof resourceScope.organizationId === 'string'
    ? resourceScope.organizationId
    : undefined,
```

Nếu `tenantCode` mặc định và resolver tùy chỉnh tạo giá trị khác nhau, thao tác ghi sẽ fail.
Resource có scope không thể ánh xạ cũng fail trước commit.

## Ghi thủ công {#manual-writes}

```ts
await history.create({
  table: 'public.product',
  tableId: product.id,
  type: ActionHistoryType.UPDATE,
  fromData: before,
  toData: after,
  note: 'Price corrected',
});
```

`create` thủ công lấy tenant từ `ContextService.tenant`, fallback về
`ContextService.custom.tenantCode`, và ném `MissingActionHistoryTenantError` nếu cả hai đều không
phải chuỗi không rỗng. `QueryRunner` tùy chọn sẽ ghi qua transaction đó.

`record(entry: HistoryEntry)` là method `IHistoryRecorder` được repository sử dụng.

## API đọc {#read-api}

```ts
const page = await history.all({
  table: 'public.product',
  tableId: product.id,
  pageNumber: 0,
  pageSize: 50,
});
```

Trang bắt đầu từ 0. Giá trị tối đa được cấu hình mặc định là 100; cấu hình hữu hạn bị giới hạn trong
`1..200`. Kích thước request bị giới hạn theo mức tối đa đó và offset cơ sở dữ liệu bị giới hạn ở
100,000. Kết quả sắp mới nhất trước và trả `{ items, total }`.

Quyền đọc bị từ chối trừ khi `authorizeRead` trả chính xác `true`. Thiếu tenant, query không hợp lệ,
policy từ chối/ném lỗi và dữ liệu bị thiếu đều tạo 404 `core.history.not-found`, ngăn enumeration
resource. Predicate SQL bao gồm tenant, table và table ID.

## Che dữ liệu và giới hạn snapshot {#snapshot-redaction-and-limits}

Biến đổi tùy chọn `redactSnapshot(snapshot, context)` chạy trước. Sau đó redactor đệ quy bắt buộc
thay thế các path đã cấu hình và tên trường phổ biến giống secret (password, secret, token,
authorization, API/private/access key và credential) bằng `[REDACTED]`. Việc khớp không phân biệt
hoa thường và nhận biết tên key ghép. Chu kỳ bị che; `Date` trở thành chuỗi ISO.

Giới hạn phòng vệ cố định là 32 level, 10,000 node và 1 MiB văn bản UTF-8 snapshot/path được đếm.
Vượt giới hạn sẽ ném `ActionHistorySnapshotLimitError` trước khi persist. Không dùng biến đổi tùy
chỉnh để đưa secret trở lại; bước che bắt buộc luôn chạy sau đó.

## Controller tùy chọn {#optional-controller}

`ActionHistoryController` không được tự động đăng ký. Thêm nó vào module ứng dụng:

```text
GET /action-history/:table/:tableId?pageNumber=0&pageSize=100
```

Nó áp dụng `AuthGuard`, bọc trang trong `ApiResponse.ok` và vẫn dựa vào `authorizeRead` ở cấp
service. Nếu `tablePath` chứa ký tự cần URL escaping, hãy encode route segment hoặc cung cấp
controller riêng của ứng dụng.

## Lưu ý bảo mật {#security-notes}

- Read policy là bắt buộc; bỏ qua đồng nghĩa deny all.
- Snapshot history là dữ liệu nhạy cảm. Áp dụng che trường, kiểm soát truy cập cơ sở dữ liệu và
  retention rõ ràng bên ngoài thư viện.
- Hàng này là audit trail, không phải bằng chứng chống giả mạo bằng mật mã. Dùng sink append-only
  bên ngoài nếu cần bảo đảm tính bất biến.
