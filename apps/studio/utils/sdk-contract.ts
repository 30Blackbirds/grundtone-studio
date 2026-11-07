// Public contract version of the browser SDK served at /client (KH-988, KH-991).
//
// It is a contract, not the package version: /client/v1.js is always the
// latest build of the major line, while /client/v<x.y.z>.js is served with an
// immutable cache so customers can pin it with SRI. Bump this when the bytes of
// the build change; every version ever committed under apps/studio/sdk-contract/
// keeps being served, so a bump never breaks a pin (KH-991).
//
// 1.0.0 -> 1.0.1 (2026-09-21): #287 moved @grundtone/core 2.22 -> 3.2 inside the
// bundled SDK. Measured: bytes changed, BEHAVIOUR did not — both built bundles
// write the same 106 CSS properties for the same payloads (8 cases, positive
// control included). v1.0.0 stays served with its ORIGINAL bytes.
//
// 1.0.1 -> 1.0.2 (2026-10-23): #348 moved vite 8.3.2 -> 8.3.3, whose rolldown
// writes `// src/x.ts` instead of `//#region` / `//#endregion` in the ESM
// bundle. Measured: v1.js byte-identical; v1.mjs differs in comment-only lines
// alone (6 -> 3), the code is byte-identical once they are removed (396 lines).
// BEHAVIOUR cannot differ. v1.0.1 stays served with its ORIGINAL bytes.
export const SDK_CONTRACT_VERSION = '1.0.2'

export const SDK_CONTRACT_MAJOR = SDK_CONTRACT_VERSION.split('.')[0]
