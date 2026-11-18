// Product limits that hold for every deployment, whatever plan or payment
// provider is (or is not) configured. Per-organization quotas (brands,
// projects) are not here: they come from the entitlements provider.

// Locked 2026-08-04: "4 font files in total" across the two font slots (stated
// as files so italic files count too). Kept here as one config constant, not
// spread over validations, so a later change is a single edit. It is shown on
// the pricing page, which is the agreement source, and deliberately not in the
// terms.
export const MAX_FONT_FILES_TOTAL = 4
