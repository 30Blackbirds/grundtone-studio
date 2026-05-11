# Grundtone Studio — changelog

The studio app deploys continuously from `main`, so each entry below corresponds to a notable
user-facing change rather than a single release tag. The companion SDK
([`@grundtone/saas-client`](./packages/saas-client/CHANGELOG.md)) versions independently via semver.

## Unreleased

### Added

- Auth + multi-tenant dashboard (Better Auth, organizations, invites, roles)
- Token editor with live preview (colors, typography, radius)
- API-key management with hash-at-rest and one-time plaintext display
- Publish pipeline (immutable per-version blobs + active pointer)
- Version history with one-click rollback
- `@grundtone/saas-client` SDK distributed via CDN bundle
- Danish + English localization
- Skip-link a11y baseline
- This changelog
