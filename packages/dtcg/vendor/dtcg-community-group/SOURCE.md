# Vendored DTCG 2025.10 schemas and test suite

Copied unchanged from
[design-tokens/community-group](https://github.com/design-tokens/community-group)
at commit `882ebd6716abef9a46d8ef5fb12e82009d6cee2e` (2026-09-08):

| Here | Upstream |
| --- | --- |
| `schemas/2025.10/` | `schemas/src/2025.10/` (the split source schemas, 22 files) |
| `test-suite/2025.10/` | `test-suite/tests/2025.10/` (manifests and fixtures, 253 files) |

Licence: test suites and other software in that repository are contributed under the
[W3C 3-clause BSD License](https://www.w3.org/Consortium/Legal/2008/03-bsd-license.html)
(repository `LICENSE.md`).

These files are excluded from Prettier so they stay byte-identical to upstream. To update, check
out a newer commit and copy the same two directories over, then run
`pnpm --filter @grundtone-studio/dtcg test`. The instrument test checks that the schemas still
classify the fixtures as their manifests say, before any export is validated against them.
