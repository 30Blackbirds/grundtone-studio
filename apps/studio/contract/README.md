# Extension contract

The extension points a private Nuxt layer builds on (the hosted service's billing layer is one),
checked from the outside. `layer/` is a fixture layer that uses every one of them the way a real
layer does. It is **not** part of any normal build: Nuxt registers layers only from
`apps/studio/layers/`, and this folder is elsewhere.

The `Extension contract` job in `.github/workflows/build.yml` (the workflow that runs on pull
requests):

1. copies `layer/` to `apps/studio/layers/contract`;
2. builds Studio and starts the built server;
3. runs `node contract/check.mjs <base-url>`, which fails on the first broken promise.

Studio's normal typecheck also covers `layer/`, so a change to the TypeScript API of an extension
point fails the typecheck on every pull request, not only this job.

What it checks, and where the extension point lives:

| Extension point                                              | Studio file                                 |
| ------------------------------------------------------------ | ------------------------------------------- |
| entitlements provider (`setEntitlementsProvider`)            | `server/lib/entitlements.ts`                |
| feature registry (`registerFeature`, `/api/features`)        | `server/lib/features.ts`                    |
| brand-count hook and org-served hook                         | `server/lib/brand-hooks.ts`, `org-hooks.ts` |
| `app.config` registries: org links, upgrade path, processors | `lib/extensions.ts`, `app.config.ts`        |
| layer i18n messages rendered by Studio's processor table     | `components/LegalProcessorsTable.vue`       |
| layer server routes, Nitro plugins and tasks, pages          | Nuxt layering                               |

Run it locally from `apps/studio`:

```bash
cp -R contract/layer layers/contract
pnpm build
node .output/server/index.mjs   # with the env the CI job sets
node contract/check.mjs http://127.0.0.1:3000
rm -r layers/contract
```
