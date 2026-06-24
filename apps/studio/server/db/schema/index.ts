// Identity tables (user/session/account/verification/organization/member/
// invitation) live in the central auth service's database now — studio only
// owns its product tables.
export * from './studio'
