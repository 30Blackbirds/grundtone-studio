# Changesets

Versioning for `@grundtone/saas-client`. The studio app (`apps/studio/`) is deployed via Docker
image tags, not npm versions, so it's listed under `ignore` in `config.json`.

## Adding a changeset

When you change something users (= consumers of the SDK) care about:

```bash
pnpm changeset
```

Pick a semver bump (patch/minor/major) and write a short user-facing summary. The tool drops a
markdown file in this folder; commit it with your code.

## How releases happen

Don't run `changeset version` or `changeset publish` manually. The `sdk-release.yml` workflow does
both:

1. On every push to `main`, the workflow inspects `.changeset/*.md`
2. If there are unreleased changesets, it opens (or updates) a "Version Packages" PR that bumps
   versions and writes the changelog
3. Merge that PR → workflow re-runs → publishes the SDK to the CDN + creates a git tag

Skip changesets only for repo-internal changes (CI, docs, etc.) — anything that affects the
consumer's bundle should ship with a changeset.
