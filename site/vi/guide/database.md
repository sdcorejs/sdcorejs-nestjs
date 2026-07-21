# Cơ sở dữ liệu và PostgreSQL {#database-and-postgresql}

Toàn bộ bề mặt thư viện hướng đến PostgreSQL. TypeORM trừu tượng hóa truy cập entity cơ bản, nhưng
các hành vi public sau sử dụng kiểu hoặc SQL đặc thù của PostgreSQL:

- `WithAudit` lưu `creator` và `modifier` dưới dạng `jsonb`.
- file tải lên và lịch sử thao tác lưu metadata/bản chụp dưới dạng `jsonb`.
- job scheduler sử dụng cột enum/jsonb, `INSERT ... ON CONFLICT ... RETURNING`, đồng hồ cơ sở dữ liệu
  và phép ép kiểu interval của PostgreSQL.
- `BaseRepository.import()` sử dụng `RETURNING '*'`.
- tìm kiếm chứa sử dụng `UNACCENT(...)`, phép ép kiểu PostgreSQL và thứ tự `NULLS FIRST/LAST`.

Các thao tác TypeORM không có phạm vi cơ bản có thể tình cờ chạy được trên driver khác, nhưng dự án này không
cam kết hỗ trợ đầy đủ nhiều cơ sở dữ liệu. Hãy chạy integration suite của riêng bạn trước khi dùng driver khác;
đặc biệt, job scheduler phải được xem là chỉ dành cho PostgreSQL.

## Data source được khuyến nghị {#recommended-data-source}

```ts
import { TypeOrmModule } from '@nestjs/typeorm';

TypeOrmModule.forRoot({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  autoLoadEntities: true,
  synchronize: false,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: true }
    : undefined,
});
```

Sử dụng cấu hình CA đã xác minh của nền tảng thay vì tắt xác minh TLS.

## Extension `unaccent` {#unaccent-extension}

`@SearchableFields({ contain: [...] })` tạo các biểu thức `UNACCENT`. Hãy bật extension trong một
migration trước khi dùng tìm kiếm chứa:

```sql
CREATE EXTENSION IF NOT EXISTS unaccent;
```

Tìm kiếm chính xác và tra cứu UUID không cần `unaccent`.

## Migration cho entity của thư viện {#migrations-for-library-entities}

Khi bật module có trạng thái, hãy tạo và review migration cho các entity được export:

```ts
import {
  ActionHistory,
  JobScheduler,
  UploadedFile,
} from '@sdcorejs/nestjs/features';

export const libraryEntities = [UploadedFile, ActionHistory, JobScheduler];
```

Schema chính xác phụ thuộc vào naming strategy và schema data source của TypeORM. Hãy tạo migration
trong ứng dụng sử dụng thư viện; thư viện không thể cung cấp an toàn một migration SQL dùng chung duy nhất.

## Quy tắc transaction {#transaction-rules}

Các thay đổi nhiều bước có phạm vi sẽ tự tạo transaction khi không truyền `QueryRunner`. Nếu bạn
truyền runner vào một thay đổi có phạm vi, runner phải đang có transaction hoạt động, nếu không
`InactiveMutationTransactionError` sẽ được ném ra. Điều này tránh tách bước xác minh phạm vi và
thay đổi sang các ranh giới transaction khác nhau.

Các raw API `unsafeRepository`, `unsafeGetRepository()` và `unsafeCreateQueryRunner()` bỏ qua
tenancy và cơ chế bảo vệ số hàng bị ảnh hưởng. Chỉ dùng chúng phía sau một ranh giới bảo trì đã được review.

## Giới hạn phân trang và truy vấn {#paging-and-query-limits}

- Trang được đánh số từ 0 (`pageNumber: 0` là trang đầu tiên).
- `BaseRepository.paging()` mặc định trả về 10 hàng và giới hạn `pageSize` ở 200.
- `all()` cố ý không giới hạn và không được `BaseController` cung cấp.
- Tìm kiếm chung trả về tối đa 20 hàng.
- Phân trang lịch sử thao tác có giới hạn cấu hình được nhưng không bao giờ vượt quá 200.
