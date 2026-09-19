// Public contract version of the browser SDK served at /client (KH-988).
//
// It is a contract, not the package version: /client/v1.js is always the
// latest build of the major line, while /client/v1.0.0.js is served with an
// immutable cache so customers can pin it with SRI. Bump this when the bytes
// behind the versioned URL change; the CDN and every browser keep the old ones.
export const SDK_CONTRACT_VERSION = '1.0.0'

export const SDK_CONTRACT_MAJOR = SDK_CONTRACT_VERSION.split('.')[0]
