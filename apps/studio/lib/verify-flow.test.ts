import { describe, expect, it } from 'vitest'
import {
  isSafeRelativePath,
  readVerifyStash,
  verifyApiUrl,
  verifyDoneState,
  VERIFY_STASH_KEY,
} from './verify-flow'

describe('verifyDoneState', () => {
  it('maps no error param to success (already-verified lander også her)', () => {
    expect(verifyDoneState(undefined)).toBe('success')
    expect(verifyDoneState(null)).toBe('success')
    expect(verifyDoneState('')).toBe('success')
  })

  it('maps the locked auth enum exhaustively', () => {
    expect(verifyDoneState('TOKEN_EXPIRED')).toBe('expired')
    expect(verifyDoneState('INVALID_TOKEN')).toBe('invalid')
    expect(verifyDoneState('USER_NOT_FOUND')).toBe('userGone')
    expect(verifyDoneState('INVALID_USER')).toBe('wrongUser')
  })

  it('never shows success for unknown or malformed error params', () => {
    expect(verifyDoneState('SOMETHING_NEW')).toBe('invalid')
    expect(verifyDoneState(['TOKEN_EXPIRED'])).toBe('invalid')
    expect(verifyDoneState(42)).toBe('invalid')
  })
})

describe('isSafeRelativePath (open-redirect-værn)', () => {
  it('accepts app-relative paths', () => {
    expect(isSafeRelativePath('/dashboard')).toBe(true)
    expect(isSafeRelativePath('/orgs/acme/projects')).toBe(true)
  })

  it('rejects absolute, protocol-relative and backslash variants', () => {
    expect(isSafeRelativePath('https://evil.example')).toBe(false)
    expect(isSafeRelativePath('//evil.example')).toBe(false)
    expect(isSafeRelativePath('/\\evil.example')).toBe(false)
    expect(isSafeRelativePath('dashboard')).toBe(false)
    expect(isSafeRelativePath(undefined)).toBe(false)
    expect(isSafeRelativePath(['/dashboard'])).toBe(false)
  })
})

describe('readVerifyStash', () => {
  const storageWith = (value: string | null) => ({ getItem: () => value })

  it('reads a valid stash and validates next as relative', () => {
    expect(
      readVerifyStash(
        storageWith(JSON.stringify({ token: 't1', email: 'a@b.dk', next: '/dashboard' })),
      ),
    ).toEqual({ token: 't1', email: 'a@b.dk', next: '/dashboard' })
  })

  it('drops unsafe next and non-string fields', () => {
    const stash = readVerifyStash(
      storageWith(JSON.stringify({ token: 42, email: null, next: 'https://evil.example' })),
    )
    expect(stash).toEqual({ token: undefined, email: undefined, next: undefined })
  })

  it('survives missing or corrupt storage content', () => {
    expect(readVerifyStash(storageWith(null))).toEqual({})
    expect(readVerifyStash(storageWith('not-json{'))).toEqual({})
    expect(readVerifyStash(storageWith('"just-a-string"'))).toEqual({})
  })

  it('uses the shared stash key', () => {
    expect(VERIFY_STASH_KEY).toBe('gt-verify-flow')
  })
})

describe('verifyApiUrl', () => {
  it('encodes the token and pins callbackURL to /verify/done', () => {
    expect(verifyApiUrl('abc/+=')).toBe(
      '/api/auth/verify-email?token=abc%2F%2B%3D&callbackURL=%2Fverify%2Fdone',
    )
  })
})
