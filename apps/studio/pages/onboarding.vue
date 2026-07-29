<script setup lang="ts">
  definePageMeta({ layout: 'auth' })

  const { t } = useI18n()
  const { state, stepIndex } = useOnboardingState()

  const steps = computed(() => [
    { label: t('onboarding.steps.org') },
    { label: t('onboarding.steps.project') },
    { label: t('onboarding.steps.tokens') },
    { label: t('onboarding.steps.install') },
  ])

  // Screen-reader announcement on step change (redesign R8 / UX-audit #15:
  // the wizard had no aria-live). Visually hidden `role=status` region reads
  // "Trin 2 af 4: Projekt" when the step flips; polite so it never interrupts.
  const stepAnnouncement = computed(() =>
    t('onboarding.stepAnnouncement', {
      current: stepIndex.value + 1,
      total: steps.value.length,
      label: steps.value[stepIndex.value]?.label ?? '',
    }),
  )
</script>

<template>
  <section class="max-w-3xl mx-auto p-6 flex flex-col gap-8">
    <header class="flex justify-between items-start gap-6">
      <div class="flex flex-col gap-1">
        <p class="text-tertiary text-sm m-0">{{ t('onboarding.welcomeKicker') }}</p>
        <h1 class="m-0">{{ t('onboarding.welcomeTitle') }}</h1>
      </div>
      <NuxtLink to="/dashboard" class="text-tertiary text-sm no-underline">
        {{ t('onboarding.skip') }}
      </NuxtLink>
    </header>

    <!--
      Client-only: grundtone's GTInput/GTSelect mint auto-IDs from a global
      counter that diverges between SSR and the client (different render
      order), and the wizard is a stateful one-time flow with no SEO value
      anyway. Same workaround as TokenPreview.
    -->
    <ClientOnly>
      <GTStepper :steps="steps" :active-step="stepIndex" />
      <span role="status" aria-live="polite" class="visually-hidden">{{ stepAnnouncement }}</span>

      <OnboardingOrgStep v-if="state.step === 'org'" />
      <OnboardingProjectStep v-else-if="state.step === 'project'" />
      <OnboardingTokensStep v-else-if="state.step === 'tokens'" />
      <OnboardingInstallStep v-else-if="state.step === 'install'" />
    </ClientOnly>
  </section>
</template>
