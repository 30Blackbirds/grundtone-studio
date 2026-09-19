// Named date formats for `d(date, '<name>')`. Without them vue-i18n renders an
// empty string for every call (measured 2026-09-17: blank "Last publish",
// audit day headings and billing renewal dates). tests/i18n-formats.test.ts
// fails when a page uses a format name that is not defined here.

const short = { year: 'numeric', month: 'short', day: 'numeric' } as const
const long = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
} as const

export const datetimeFormats = {
  da: { short, long },
  en: { short, long },
}
