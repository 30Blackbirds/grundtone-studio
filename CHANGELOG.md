# Grundtone Studio — changelog

The studio app deploys continuously from `main`, so each entry below corresponds to a notable
user-facing change rather than a single release tag. The companion SDK
([`@grundtone/saas-client`](./packages/saas-client/CHANGELOG.md)) versions independently via semver.

## Unreleased

### Added

- **Audit log** — append-only `/orgs/[slug]/audit` page for managers and owners. Captures member
  invitations, role changes, project creations, API-key actions, publishes, and activations with
  before/after data. Cursor-paginated, filterable by action.
- **Five-tier organization roles** — `billing → member → admin → manager → owner` following the
  Sentry model. Owner is granted automatically to whoever creates the org. Dedicated member-detail
  page at `/orgs/[slug]/members/[memberId]` with role radio list, hierarchical assignment guard, and
  a per-member view of direct project memberships.
- **Privacy, DPA, sub-processors, integration guide** — public pages at `/privacy`, `/dpa`,
  `/sub-processors`, and `/docs/install`. Install guide carries copy-pasteable snippets for script
  tag, Vue, Nuxt, React, and Svelte. New footer links to all four. SDK bundles now emit SHA-384
  Subresource Integrity (SRI) hashes alongside the `.js` files.
- **"What is an API key?" tooltip** on the project's API-key panel.
- Auth + multi-tenant dashboard (Better Auth, organizations, invites, roles)
- Token editor with live preview (colors, typography, radius)
- API-key management with hash-at-rest and one-time plaintext display
- Publish pipeline (immutable per-version blobs + active pointer)
- Version history with one-click rollback
- `@grundtone/saas-client` SDK distributed via CDN bundle
- Danish + English localization
- Skip-link a11y baseline
- This changelog

### Changed

- **Member-management hierarchy** — actors can only assign or change roles strictly below their own
  rank. Owners are the only ones who can manage other owners.
- Migration `0003_sentry_style_org_roles.sql` renames existing org `admin` members to `manager` so
  their "admin on every project" semantics survive the five-tier rollout.
