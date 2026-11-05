# Private Jest config merge implementation

This dev-only, unpublished package replaces Jest's `deepmerge` dependency through
the root file dependency and npm override. It is a hardened fork of the MIT-licensed
`deepmerge@4.3.1/dist/cjs.js`; upstream copyright and license are retained in LICENSE.
It is not an upstream release or an advisory exception, and it must not become a
runtime dependency of the published NestJS package.

GHSA-gcqx-w48m-w2h4 has no upstream patched release as of 2026-11-05. Reproduction
against the original dependency fails for null-prototype targets, nested null
placeholders, own `__proto__` keys, and the actual Jest `mergeConfig` integration.

The fork rejects `__proto__`, `constructor` and `prototype` before reading or writing
either target or source keys, writes own data properties with `Object.defineProperty`,
and propagates proxy membership failures. Primitive/null placeholders still behave
as absent properties. Other merge behavior is retained, including array concatenation,
symbols, custom options, and function/Date/RegExp handling.

Run `npm run test:tooling` and the full Jest coverage suite after any change. The
security cases resolve the dependency from `jest-config`, so an incorrectly wired
override cannot pass by testing only an unused local file. Remove this fork once
Jest uses a reviewed safe upstream implementation. Never rename the original
unmodified package to suppress an audit finding.

Upstream: https://github.com/TehShrike/deepmerge
Advisory: https://github.com/advisories/GHSA-gcqx-w48m-w2h4
