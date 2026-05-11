// Shared state between onboarding-wizard steps. Lives on the client only —
// each step calls the same server APIs that the rest of the app uses, so this
// composable's job is just to remember what we created as we go (org slug,
// project id, draft color, generated API key plaintext) so the final "install"
// step can render the right snippet.

export type OnboardingStepId = 'org' | 'project' | 'tokens' | 'install'
export const ONBOARDING_STEPS: OnboardingStepId[] = ['org', 'project', 'tokens', 'install']

export interface OnboardingState {
  step: OnboardingStepId
  orgId: string | null
  orgSlug: string | null
  orgName: string | null
  projectId: string | null
  projectSlug: string | null
  projectName: string | null
  primaryColor: string
  apiKey: string | null
}

const DEFAULT_STATE: OnboardingState = {
  step: 'org',
  orgId: null,
  orgSlug: null,
  orgName: null,
  projectId: null,
  projectSlug: null,
  projectName: null,
  primaryColor: '#4F46E5',
  apiKey: null,
}

export const useOnboardingState = () => {
  const state = useState<OnboardingState>('onboarding', () => ({ ...DEFAULT_STATE }))

  const goTo = (step: OnboardingStepId) => {
    state.value.step = step
  }

  const next = () => {
    const i = ONBOARDING_STEPS.indexOf(state.value.step)
    if (i >= 0 && i < ONBOARDING_STEPS.length - 1) {
      state.value.step = ONBOARDING_STEPS[i + 1]!
    }
  }

  const back = () => {
    const i = ONBOARDING_STEPS.indexOf(state.value.step)
    if (i > 0) state.value.step = ONBOARDING_STEPS[i - 1]!
  }

  const reset = () => {
    state.value = { ...DEFAULT_STATE }
  }

  const stepIndex = computed(() => ONBOARDING_STEPS.indexOf(state.value.step))

  return { state, stepIndex, goTo, next, back, reset }
}

// Nordic chars don't decompose under NFD (they're atomic codepoints), so
// transliterate them explicitly before stripping combining marks.
const NORDIC_MAP: Record<string, string> = {
  æ: 'ae',
  ø: 'o',
  å: 'a',
  ä: 'a',
  ö: 'o',
  ü: 'u',
  ñ: 'n',
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[æøåäöüñ]/g, (c) => NORDIC_MAP[c] ?? c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}
