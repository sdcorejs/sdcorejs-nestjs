# Changesets

Mọi PR có thay đổi user-facing phải kèm một file changeset.

## Thêm changeset

```bash
npx changeset
```

CLI sẽ hỏi:

1. Loại bump nào? — `patch` (bug fix) / `minor` (feature) / `major` (breaking change)
2. Mô tả thay đổi (1–3 dòng, ngôn ngữ tự nhiên)

File sinh ra tại `.changeset/<random-hash>.md`, commit cùng PR.

## Release

Khi merge vào `main`, Changesets Action tạo/cập nhật version PR. Khi version PR được merge, workflow
chạy `npm run release` để build và publish lên npm qua `NPM_TOKEN`.

Một version snapshot đã chạy `npm run changeset:version` sẽ không còn file changeset pending: version
và changelog đã được materialize. Merge snapshot đó vào `main` là bước publish, vì vậy chỉ merge sau
khi release-readiness và CI đều xanh.

## Tham khảo

- [Changesets docs](https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md)
- [Common questions](https://github.com/changesets/changesets/blob/main/docs/common-questions.md)
