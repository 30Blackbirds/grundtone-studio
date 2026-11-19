<script setup lang="ts">
  // Listen er [jura]s privatlivspolitik §6 / DPA Bilag C (infra-verificeret,
  // 849ca2f) — samme delte tabel-komponent som /privacy §6, så de to flader
  // aldrig drifter. GitHub er bevidst UDE (bærer ingen kundedata, jura-
  // verificeret 2026-08-02). Rækkerne er et layer-register (app.config.ts):
  // en deployment med betaling tilføjer selv sin betalingsformidler.
  definePageMeta({ layout: 'auth' })
  const { t } = useI18n()
</script>

<template>
  <article class="container-prose mx-auto p-6 flex flex-col gap-4">
    <header>
      <h1 class="font-heading text-3xl mt-0 mb-2">{{ t('subProcessors.title') }}</h1>
      <p class="text-tertiary m-0">{{ t('subProcessors.updated') }}</p>
    </header>

    <p>{{ t('subProcessors.intro') }}</p>

    <LegalProcessorsTable />

    <p class="text-tertiary text-sm">{{ t('subProcessors.sentrySubNote') }}</p>
    <p class="text-tertiary text-sm mt-4">{{ t('subProcessors.notification') }}</p>
    <p>
      <NuxtLink to="/privacy" class="text-primary">{{ t('subProcessors.backToPrivacy') }}</NuxtLink>
    </p>
  </article>
</template>
