---
'@sdcorejs/nestjs': patch
---

Allow repository and service reads to reuse an optional caller-owned active QueryRunner from the same DataSource. Paging, search and related reads preserve tenancy, filters and caller transaction lifecycle without borrowing a second pooled connection. Reject invalid, released, inactive or foreign runners before reading. Add real PostgreSQL packed CJS/ESM regressions for transaction visibility, isolation and saturated connection pools.
