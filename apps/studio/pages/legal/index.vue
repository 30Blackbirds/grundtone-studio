<script setup lang="ts">
  // Minimal legal-oversigt: /legal er interim-target for font-licens-linket
  // (designer-krav 2026-08-04) og et naturligt indeks for de fire legal-
  // flader. Juras ToS-licenstekst får sin egen sektion/side når den lander
  // (spor hos projektleder) — indtil da henviser vi til vilkårene.
  definePageMeta({ layout: 'auth' })
  const { t } = useI18n()

  const pages = [
    { to: '/privacy', key: 'privacy' },
    { to: '/dpa', key: 'dpa' },
    { to: '/sub-processors', key: 'subProcessors' },
    { to: '/legal/cookies', key: 'cookies' },
  ] as const
</script>

<template>
  <article class="container-prose mx-auto p-6 flex flex-col gap-4">
    <header>
      <h1 class="font-heading text-3xl mt-0 mb-2">{{ t('legalIndex.title') }}</h1>
      <p class="text-tertiary m-0">{{ t('legalIndex.intro') }}</p>
    </header>

    <ul class="list-reset grid gap-3 mt-4">
      <li v-for="p in pages" :key="p.to" class="p-4 bg-surface-raised border rounded-lg">
        <NuxtLink :to="p.to" class="text-primary font-medium">
          {{ t(`legalIndex.pages.${p.key}`) }}
        </NuxtLink>
      </li>
    </ul>

    <h2 class="font-heading text-2xl mt-6 mb-3">{{ t('legalIndex.fontLicensesHeading') }}</h2>
    <p>{{ t('legalIndex.fontLicensesBody') }}</p>
  </article>
</template>
