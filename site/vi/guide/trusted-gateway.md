# Danh tính gateway đáng tin cậy {#trusted-gateway-identity}

Chế độ trusted-header dành cho môi trường triển khai nơi gateway xác thực caller và chuyển tiếp
danh tính được bảo vệ toàn vẹn. Đây không phải cách tắt để chấp nhận header public `X-User-Id` hoặc
`X-Tenant`.

## Bằng chứng tin cậy bắt buộc {#required-trust-proof}

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

Đây là ví dụ shared-secret tối thiểu, không phải thiết kế edge hoàn chỉnh. Gateway phải loại bỏ
identity/proof header do caller cung cấp trước khi thêm header của chính nó, backend không được
truy cập public bằng cách đi vòng gateway và secret phải được luân chuyển. Ưu tiên mTLS hoặc signed header có
bảo vệ timestamp/replay khi nền tảng hỗ trợ.

## Phân giải tùy chỉnh {#custom-resolution}

Dùng `trustedHeaders.resolve` khi một header đã xác minh chứa identity envelope được ký/mã hóa:

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

`verifyGatewayBoundary` và `verifyAndDecodeIdentityEnvelope` là placeholder bảo mật của ứng dụng,
không phải API của thư viện. Chúng phải xác minh tính xác thực và độ mới trước khi trả về dữ liệu.

## Kết hợp gateway và JWT {#combining-gateway-and-jwt}

Request có thể nhận danh tính gateway đáng tin cậy trước rồi đi qua `AuthGuard` sau đó. Guard so sánh
các trường user, tenant, role, permission, permission version và danh tính tùy chỉnh bị trùng. Xung đột
trả về 401; các giá trị không xung đột được merge và nguồn cuối cùng trở thành
`verified-principal`.

## Kiểm tra vận hành {#operational-checks}

- Xác nhận truy cập trực tiếp backend đã bị chặn.
- Xác nhận gateway loại bỏ mọi identity header inbound.
- Kiểm thử identity header giả mạo không có gateway proof hợp lệ; phải trả về 401.
- Kiểm thử xung đột tenant giữa gateway/JWT; phải trả về 401.
- Bổ sung kiểm soát replay khi bằng chứng tin cậy là chữ ký request.
- Không ghi proof secret hoặc authorization token vào log.
