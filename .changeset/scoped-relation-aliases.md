---
'@sdcorejs/nestjs': patch
---

Escape relation aliases in scoped JOIN conditions through the database driver. This fixes PostgreSQL failures when paging or reading details with camel-case or nested relation names while preserving tenant predicates on every joined entity.
