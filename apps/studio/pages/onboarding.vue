<script setup lang="ts">
  definePageMeta({ layout: 'auth' })

  const { t } = useI18n()
  const { state, stepIndex } = useOnboardingState()

  // 🔴 THE ICONS ARE THE CLOSEST THE SET HAS, AND TWO OF THEM ARE
  // APPROXIMATIONS. @grundtone/icons ships 27 icons (measured) and has no
  // palette/colour glyph and no code glyph, so the brand step borrows
  // `settings` and the install step borrows `check-circle` ("Næsten færdig").
  // The R8 prototype does not name icons — it specifies an icon in a tinted
  // square — so this is a gap in the icon set rather than a deviation from the
  // design. [designer] picks, or the library grows the two glyphs.
  const steps = computed(() => [
    { label: t('onboarding.steps.org'), title: t('onboarding.org.title'), icon: 'users' },
    {
      label: t('onboarding.steps.project'),
      title: t('onboarding.project.title'),
      icon: 'folder',
    },
    { label: t('onboarding.steps.tokens'), title: t('onboarding.tokens.title'), icon: 'settings' },
    {
      label: t('onboarding.steps.install'),
      title: t('onboarding.install.title'),
      icon: 'check-circle',
    },
  ])

  const stepLabel = computed(() =>
    t('onboarding.stepLabel', {
      current: stepIndex.value + 1,
      total: steps.value.length,
      title: steps.value[stepIndex.value]?.title ?? '',
    }),
  )

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
      <!-- 🔴 A SEGMENTED BAR, NOT GTStepper. The R8 prototype draws four 4px
           segments and a single line of text ("Trin 2 af 4 — Opret dit første
           projekt"); GTStepper draws four named, labelled steps. Both are
           honest progress indicators, and the prototype is the decision.
           The bar is `aria-hidden` and the text beside it is the real
           announcement, so a screen reader hears the step once, not five
           times. -->
      <div class="onboarding-progress">
        <div class="onboarding-progress__track" aria-hidden="true">
          <span
            v-for="(s, i) in steps"
            :key="s.label"
            class="onboarding-progress__seg"
            :class="{ 'onboarding-progress__seg--on': i <= stepIndex }"
          />
        </div>
        <p class="onboarding-progress__label m-0">{{ stepLabel }}</p>
      </div>
      <span role="status" aria-live="polite" class="visually-hidden">{{ stepAnnouncement }}</span>

      <OnboardingOrgStep v-if="state.step === 'org'" />
      <OnboardingProjectStep v-else-if="state.step === 'project'" />
      <OnboardingTokensStep v-else-if="state.step === 'tokens'" />
      <OnboardingInstallStep v-else-if="state.step === 'install'" />
    </ClientOnly>
  </section>
</template>
