import { afterEach, describe, expect, it } from 'vitest'
import { featureEnabled, registerFeature, resetFeatures } from './features'

afterEach(() => resetFeatures())

describe('feature registry', () => {
  // A self-hosted Studio registers nothing, so /api/features says billing: false.
  it('reports an unregistered feature as off', () => {
    expect(featureEnabled('billing')).toBe(false)
  })

  it('asks the registered switch on every read, so a later change is seen', () => {
    let on = true
    registerFeature('billing', () => on)
    expect(featureEnabled('billing')).toBe(true)
    on = false
    expect(featureEnabled('billing')).toBe(false)
  })
})
