# API HTTP client {#http-client-api}

Đường dẫn import: `@sdcorejs/nestjs/services`

`HttpService` bọc Axios và chỉ truyền identity header đã cấu hình từ request context tới origin
HTTP(S) tin cậy chính xác. Nó đánh giá lại độ tin cậy khi redirect.

## Các export {#exports}

| Export | Loại | Mục đích |
| --- | --- | --- |
| `HttpClientConfig` | interface | Base URL, timeout và propagation policy |
| `HTTP_CLIENT_CONFIG` | value | DI token cấu hình |
| `HttpService` | class | API `get`/`post`/`put`/`patch`/`delete` dựa trên Axios |
| `HttpClientModule` | class | Module provider global; `forRoot(config?)` |

## Cấu hình {#configuration}

```ts
HttpClientModule.forRoot({
  baseURL: 'https://inventory.internal.example/v1',
  timeout: 10_000,
  trustedOrigins: ['https://inventory.internal.example'],
  propagateHeaders: ['x-tenant', 'x-user-id', 'x-correlation-id'],
});
```

| Option | Mặc định | Hành vi |
| --- | --- | --- |
| `baseURL` | Mặc định Axios | Phân giải URL request tương đối |
| `timeout` | `30_000` ms | Timeout request Axios |
| `trustedOrigins` | `[]` | Origin HTTP(S) chuẩn hóa chính xác được phép nhận identity header |
| `propagateHeaders` | Identity header context đã cấu hình | Tên identity header được chọn |

Giá trị `trustedOrigins` có thể chứa path, nhưng chỉ `new URL(value).origin` được giữ. Scheme, host
và effective port đều phải khớp. Subdomain và suffix giả mạo không khớp. Entry không hợp lệ hoặc
không phải HTTP(S) sẽ ném lỗi khi khởi tạo.

## Các method {#methods}

```ts
get<T>(url: string, config?: AxiosRequestConfig): Promise<T>
post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>
put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>
patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>
delete<T>(url: string, config?: AxiosRequestConfig): Promise<T>
```

Mỗi method trả `AxiosResponse.data`, không phải toàn bộ response Axios.

```ts
@Injectable()
export class InventoryGateway {
  constructor(private readonly http: HttpService) {}

  reserve(productId: string, quantity: number) {
    return this.http.post<{ reservationId: string }>('/reservations', {
      productId,
      quantity,
    });
  }
}
```

## Quy tắc truyền header {#header-propagation-rules}

Client lấy giá trị từ `ContextService` và `HeadersConfig`:

- `tenant` ánh xạ tới header tenant đã cấu hình (mặc định `x-tenant`).
- `userId` ánh xạ tới header user đã cấu hình (mặc định `x-user-id`).
- Giá trị `custom` ánh xạ qua `HeadersConfig.customHeaders`.

Trước mỗi request, identity header đã cấu hình bị loại khỏi header do caller cung cấp. Chúng chỉ
được điền lại từ context tin cậy khi origin đích nằm trong allowlist. Điều này ngăn caller tuồn
identity header giả mạo qua wrapper.

`authorization` luôn thuộc sở hữu caller và bị loại khỏi propagation context. Header
`x-internal-secret` cũng do caller cung cấp; nó chỉ được giữ cho origin tin cậy chính xác và bị loại
khỏi đích không tin cậy. Trên mỗi redirect, identity header bị loại rồi chỉ được điền lại nếu đích
redirect độc lập được tin cậy. Hook `beforeRedirect` của consumer chạy trước, sau đó security policy
được thực thi.

```ts
await http.post(
  'https://inventory.internal.example/reindex',
  {},
  { headers: { 'x-internal-secret': await secrets.current() } },
);
```

## Lưu ý bảo mật {#security-notes}

- Giữ `trustedOrigins` rỗng trừ khi downstream service được cấp quyền rõ ràng để nhận danh tính
  hiện tại.
- URL tuyệt đối truyền vào method có thể override `baseURL`; độ tin cậy được tính từ đích cuối, vì
  vậy nó sẽ không nhận identity header trừ khi độc lập nằm trong allowlist.
- Client này không tạo internal secret hoặc bearer token. Gắn chúng rõ ràng và áp dụng policy xoay
  credential/least-privilege riêng.
- Truyền context không phải xác thực end-user. Service nhận phải bảo vệ trust boundary, ví dụ bằng
  [`InternalGuard`](../auth/permissions.md#internal-call-exports) hoặc cơ chế mTLS/gateway đã xác
  minh.
