---
---

Refresh the tested build lock to follow-redirects 1.16.1 within the existing Axios range and the documentation Vite override to 6.4.4, retaining VitePress 1.6.4. These patch updates address GHSA-q3jh-wrc6-jgq8, GHSA-8r9p-f939-6h3c and the Vite 6.4.4 security fixes without changing public dependencies or suppressing release audits. Existing consumer lockfiles must resolve their own patched transitive dependencies.
