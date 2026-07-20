# API audit {#audit-api}

Đường dẫn import: `@sdcorejs/nestjs/core`

Lớp audit điền các cột actor trên entity `WithAudit`. Lớp này tách biệt với [feature lịch sử thao
tác](../features/action-history.md), nơi lưu snapshot trước/sau.

## Các export {#exports}

| Export | Loại | Mục đích |
| --- | --- | --- |
| `IAuditStrategy` | interface | Các hook `onCreate`, `onUpdate`, `onSoftDelete` |
| `AUDIT_STRATEGY` | value | DI token của strategy |
| `DefaultAuditStrategy` | class | Điền UUID actor từ `RequestContext.userId` |
| `AuditSubscriber` | class | Subscriber vòng đời TypeORM cho entity `WithAudit` |
| `AuditModule`, `AuditModuleOptions` | class/type | Đăng ký strategy và provider subscriber |

Các export ORM liên quan là `WithAudit`, `WithTimestamps`, `isAuditEnabled`, `UserSnapshot` và
`BaseRepositoryOptions.auditStrategy`.

## Contract của strategy {#strategy-contract}

```ts
interface IAuditStrategy {
  onCreate(entity: DeepPartial<any>, ctx: RequestContext): void;
  onUpdate(entity: DeepPartial<any>, ctx: RequestContext): void;
  onSoftDelete(entity: DeepPartial<any>, ctx: RequestContext): void;
}
```

```ts
@Injectable()
export class AppAuditStrategy implements IAuditStrategy {
  onCreate(entity: any, ctx: RequestContext): void {
    if (!ctx.userId) return;
    entity.createdBy ??= ctx.userId;
    entity.modifiedBy ??= ctx.userId;
    const actor = ctx.custom?.actorSnapshot as UserSnapshot | undefined;
    if (actor) {
      entity.creator ??= actor;
      entity.modifier ??= actor;
    }
  }

  onUpdate(entity: any, ctx: RequestContext): void {
    if (ctx.userId) entity.modifiedBy = ctx.userId;
  }

  onSoftDelete(): void {}
}

AuditModule.forRoot({ strategy: AppAuditStrategy });
```

Các hook là đồng bộ. `DefaultAuditStrategy` âm thầm bỏ qua thao tác ẩn danh, đặt
`createdBy`/`modifiedBy`, và không điền JSON snapshot.

## Đăng ký subscriber TypeORM {#register-the-typeorm-subscriber}

`AuditModule` cung cấp `AuditSubscriber`, nhưng không thể thay đổi cấu hình datasource của bạn.
Gắn instance do DI tạo một lần trong quá trình bootstrap:

```ts
const subscriber = app.get(AuditSubscriber);
const dataSource = app.get(DataSource);

if (!dataSource.subscribers.includes(subscriber)) {
  dataSource.subscribers.push(subscriber);
}
```

Subscriber chỉ tác động lên entity `WithAudit`. Khi insert, nó bỏ qua hàng đã có `createdBy`, giúp
tránh điền hai lần khi `BaseRepository.create` đã chạy trực tiếp strategy.

## Tích hợp repository {#repository-integration}

Truyền `auditStrategy` vào một `BaseRepository` cụ thể khi bạn cần hook repository độc lập với
subscriber TypeORM:

```ts
super(Product, dataSource, {
  auditStrategy,
  contextService,
});
```

Hook create/update của repository chạy trước khi persist. Repository áp dụng write scope tenancy
sau hook audit create và từ chối mọi trường scope do hook audit update đưa vào.

## Lưu ý bảo mật {#security-notes}

- Giá trị actor phải đến từ danh tính request đã xác minh, không phải header thô hoặc trường DTO.
- Tránh serialize toàn bộ object `ctx.user` vào `creator`/`modifier`; hãy ánh xạ snapshot rõ ràng,
  có giới hạn và che thông tin xác thực/token.
- `AuditSubscriber` không tạo event log chống giả mạo. Dùng action history hoặc audit sink
  append-only bên ngoài khi cần thuộc tính đó.
