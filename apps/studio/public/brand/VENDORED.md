# Vendorede brand-assets — kilde og sha

Studio loader ALDRIG brand-assets fra jsDelivr (jura-consent: ingen tredjeparts- CDN-loads,
IP-deling ved sidevisning). De kopieres i stedet fra `@grundtone/core`'s `packages/core/assets/` —
og **vendoring fryser filen**: indtil 2026-08-19 var logoet den blå placeholder fra core@2.22.0,
byte-identisk, og ingen core-release ville have rettet det (studio#225).

Kilde: 30Blackbirds/grundtone PR #140 (head `c1cc0de`), det officielle mærke.

| fil (public/)        | kilde i core            | sha256 (16)      |
| -------------------- | ----------------------- | ---------------- |
| brand/logo-32x32.png | assets/logo-32x32.png   | 61237378b359062b |
| favicon-32x32.png    | assets/logo-32x32.png   | 61237378b359062b |
| apple-touch-icon.png | assets/logo-180x180.png | b8c26d59495309b6 |

## "Er den frosset?" — ét kald, ikke en undersøgelse

```bash
# fra grundtone-studio-roden, med grundtone klonet ved siden af:
for f in brand/logo-32x32.png:logo-32x32.png favicon-32x32.png:logo-32x32.png apple-touch-icon.png:logo-180x180.png; do
  ours=$(shasum -a 256 apps/studio/public/${f%%:*} | cut -c1-16)
  core=$(shasum -a 256 ../grundtone/packages/core/assets/${f##*:} | cut -c1-16)
  [ "$ours" = "$core" ] && echo "= ${f%%:*}" || echo "≠ ${f%%:*}  (ours $ours, core $core) — re-vendor"
done
```

Ved nyt mærke i core: kopiér filerne igen, opdatér sha-kolonnen, og commit begge dele sammen.
