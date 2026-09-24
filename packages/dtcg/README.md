# @grundtone-studio/dtcg

Converts a Studio token set to [DTCG 2025.10](https://www.designtokens.org/TR/2025.10/format/)
files. The package has no app dependencies. …and back: it also maps a DTCG document onto a Studio
draft. The Studio server uses it for the Export and Import tabs and for `grundtone-tokens export` /
`grundtone-tokens import`.

## Files

| File                      | When                                    | Media type                                     |
| ------------------------- | --------------------------------------- | ---------------------------------------------- |
| `<slug>.tokens.json`      | always                                  | `application/design-tokens+json`               |
| `<slug>.dark.tokens.json` | the project has at least one dark color | `application/design-tokens+json`               |
| `<slug>.resolver.json`    | same as the dark file                   | `application/json` (as the resolver spec asks) |

The resolver has one set, `base` (the tokens file), and one modifier, `theme`, with the contexts
`light` (no extra sources) and `dark` (the dark file). The default context is `light`.

## Path convention

| Studio                              | DTCG path                                                             | `$type`      |
| ----------------------------------- | --------------------------------------------------------------------- | ------------ |
| `colors.<slot>`                     | `color.<slot>`                                                        | `color`      |
| `dark.colors.<slot>`                | `color.<slot>` in the dark file                                       | `color`      |
| `radius.<size>`, `spacing.<size>`   | `radius.<size>`, `spacing.<size>`                                     | `dimension`  |
| `typography.fontFamily.<role>`      | `font.family.<role>`                                                  | `fontFamily` |
| `typography.slots.<slot>.family`    | `font.<slot>.family`                                                  | `fontFamily` |
| `typography.slots.<slot>.weights[]` | `font.<slot>.weight.<weight>`                                         | `fontWeight` |
| `assets.logo`                       | `$extensions["dk.klanghaus.grundtone-studio"].logo` on the root group | none         |

Every token carries its own `$type`. A font slot's source (`curated`/`custom`), fallback keys and
font file names are kept in `$extensions["dk.klanghaus.grundtone-studio"]` on its family token. File
names only: the export contains no font or logo bytes and no URLs.

## Values

- **Colors.** Hex, `rgb()`/`rgba()` and named colors become `srgb`. `hsl()`/`hsla()` stays `hsl`.
  Every color has a 6-digit `hex`. Alpha below 1 goes in `alpha`, never in the hex.
- **Dimensions.** `px` and `rem` pass through unchanged. `in`, `cm`, `mm`, `pt` and `pc` are
  converted exactly to `px` (CSS Values 4 ratios, e.g. `12pt` → `16px`), and so is a unitless `0`.
  These conversions are listed in the report.
- **Font families.** A CSS stack becomes an array of names without quotes. A single name stays a
  string.

## What the export leaves out

A value DTCG cannot express is left out of the files and listed in the report with its Studio path,
the stored value and a reason code. One bad value never fails the export, and
`exported + omitted = total`. Left out today:

- `var(--…)` colors. The reference has no fixed value.
- Keywords such as `currentcolor`.
- Malformed `rgb()`/`hsl()` values.
- `em`, `%`, `vh`, `vw`, `ch`, `ex`, and unitless lengths other than 0.

## Not full DTCG round-tripping

Studio's model has no place for `$description`, `$deprecated`, aliases, composite types (typography,
shadow, …) or other vendors' `$extensions`. A DTCG file made elsewhere can hold more than Studio can
store, so the export is not a lossless store for arbitrary DTCG.

## Schemas and tests

`vendor/dtcg-community-group` holds the official schemas and test suite, copied unchanged at a
pinned commit (see `SOURCE.md`). The tests work in two steps:

1. Check that the vendored schemas classify the official fixtures as their manifests say.
2. Validate exports against those schemas, including every Studio color slot, a dark layer and both
   font slots.

`@grundtone-studio/dtcg/testing` exposes the validator for other packages' tests.
