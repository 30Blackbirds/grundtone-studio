import { describe, it, expect } from 'vitest'
import { mockH3 } from './endpoint-fixtures'

// Tests af selve testværktøjet.
//
// Baggrund: mockH3's createError satte kun `Error.message` og aldrig
// `err.statusMessage`, så en assertion på en fejlbesked læste `undefined`
// (fundet under SIK-011). Den første fejlmelding påstod desuden, at
// `toMatchObject` ville bestå TAVST i den situation, fordi H3Errors
// statusMessage ikke er enumerable — **det viste sig at være forkert**, og
// påstanden nåede at blive citeret videre af to andre tabs, før nogen
// forsøgte at reproducere den.
//
// Derfor står den korrekte adfærd her som eksekverbare cases frem for som en
// kommentar: en påstand om hvad vores værktøj gør, skal kunne fejle.

describe('mockH3().createError', () => {
  it('bærer statusMessage som egen property, ikke kun som Error.message', () => {
    const err = mockH3().createError({
      statusCode: 403,
      statusMessage: 'add crossorigin',
    }) as Error & {
      statusCode: number
      statusMessage?: string
    }
    expect(err.statusCode).toBe(403)
    expect(err.statusMessage).toBe('add crossorigin')
    expect(err.message).toBe('add crossorigin')
  })

  it('udelader statusMessage helt når den ikke er givet', () => {
    const err = mockH3().createError({ statusCode: 404 }) as Error & { statusMessage?: string }
    // `toBeUndefined()` alene ville også bestå på en mock der intet satte —
    // altså også på selve den defekt testen skal fange. Derfor spørges der
    // på property'ens TILSTEDEVÆRELSE: her skal den mangle helt, mens den i
    // testen ovenfor skal være der med den rigtige værdi. De to sammen kan
    // ikke bestå tomt.
    expect('statusMessage' in err).toBe(false)
    expect(err.statusMessage).toBeUndefined()
  })

  // 🔴 Selve grunden til at createError er skrevet som
  // `Object.assign(new Error(…), input)` og ikke felt for felt: den OPREGNER
  // ikke felterne og kan derfor ikke glemme et. Den felt-for-felt-form der
  // stod her før, kunne — `statusMessage` blev tabt i fem inline-kopier af
  // netop den form.
  //
  // Testen bruger et felt der IKKE står i mockens signatur, fordi det er den
  // egenskab der skal låses: at et felt h3 måtte tilføje i morgen bæres med
  // uden at nogen husker at udvide en liste. Bliver formen igen felt-for-felt,
  // bliver denne test rød.
  it('bærer ETHVERT felt med — også et mocken ikke kender', () => {
    const err = mockH3().createError({
      statusCode: 429,
      statusMessage: 'Too many requests',
      data: { code: 'quota_exceeded' },
      // Uden for signaturen med vilje — h3's createError tager flere felter
      // end de tre vi har skrevet op.
      fatal: true,
    } as Parameters<ReturnType<typeof mockH3>['createError']>[0]) as Error & {
      statusCode: number
      statusMessage?: string
      data?: unknown
      fatal?: boolean
    }
    expect(err).toMatchObject({
      statusCode: 429,
      statusMessage: 'Too many requests',
      data: { code: 'quota_exceeded' },
      fatal: true,
    })
  })
})

// Hvad `toMatchObject` FAKTISK gør — den mekanisme, den forkerte diagnose
// handlede om. Skulle Vitest en dag skifte adfærd, bliver det rødt her frem
// for at gøre en hel kategori af assertions tavs uden at nogen ser det.
describe('toMatchObject mod manglende og non-enumerable felter', () => {
  const withHiddenStatus = (value: string) => {
    const err = Object.assign(new Error('x'), { statusCode: 403 })
    Object.defineProperty(err, 'statusMessage', { value, enumerable: false })
    return err
  }

  it('FANGER et felt der mangler helt (den gamle mocks tilfælde)', () => {
    const err = Object.assign(new Error('kun i message'), { statusCode: 403 })
    expect(() =>
      expect(err).toMatchObject({ statusCode: 403, statusMessage: 'add crossorigin' }),
    ).toThrow()
  })

  it("FANGER en forkert værdi selv når property'en er non-enumerable", () => {
    expect(() =>
      expect(withHiddenStatus('Forbidden')).toMatchObject({
        statusCode: 403,
        statusMessage: expect.stringContaining('crossorigin'),
      }),
    ).toThrow()
  })

  it('accepterer en korrekt værdi på en non-enumerable property', () => {
    expect(withHiddenStatus('add crossorigin here')).toMatchObject({
      statusCode: 403,
      statusMessage: expect.stringContaining('crossorigin'),
    })
  })
})
