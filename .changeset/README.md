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

Khi merge vào `main`, GitHub Action sẽ chạy `changeset version` để bump version + cập nhật `CHANGELOG.md`, sau đó tag `v*` triggers publish lên npm qua `NPM_TOKEN`.

## Tham khảo

- [Changesets docs](https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md)
- [Common questions](https://github.com/changesets/changesets/blob/main/docs/common-questions.md)
