<script setup lang="ts">
  definePageMeta({ layout: 'auth' })
  const { t } = useI18n()

  interface SubProcessor {
    name: string
    role: string
    location: string
    url: string
  }

  // Source of truth — keep aligned with klanghaus/docs/infrastructure/security-gdpr.md
  const processors: SubProcessor[] = [
    {
      name: 'UpCloud',
      role: t('subProcessors.upcloud.role'),
      location: 'EU (Helsinki / Frankfurt / Copenhagen)',
      url: 'https://upcloud.com/legal-overview/',
    },
    {
      name: 'Bunny.net',
      role: t('subProcessors.bunny.role'),
      location: 'EU zones',
      url: 'https://bunny.net/privacy/',
    },
    {
      name: 'Postmark',
      role: t('subProcessors.postmark.role'),
      location: 'EU region',
      url: 'https://postmarkapp.com/eu-privacy',
    },
    {
      name: 'Sentry',
      role: t('subProcessors.sentry.role'),
      location: 'EU region',
      url: 'https://sentry.io/legal/dpa/',
    },
    {
      name: 'GitHub (Microsoft)',
      role: t('subProcessors.github.role'),
      location: 'EU / US (source code only)',
      url: 'https://docs.github.com/en/site-policy/privacy-policies/github-data-protection-agreement',
    },
  ]
</script>

<template>
  <article class="container-prose mx-auto p-6 flex flex-col gap-4">
    <header>
      <h1 class="font-heading text-3xl mt-0 mb-2">{{ t('subProcessors.title') }}</h1>
      <p class="text-tertiary m-0">{{ t('subProcessors.updated') }}</p>
    </header>

    <p>{{ t('subProcessors.intro') }}</p>

    <ul class="list-reset grid gap-3 mt-4">
      <li
        v-for="p in processors"
        :key="p.name"
        class="p-4 bg-surface-raised border rounded-lg flex flex-col gap-1"
      >
        <div class="flex items-baseline justify-between gap-3">
          <strong>{{ p.name }}</strong>
          <a :href="p.url" target="_blank" rel="noopener" class="text-primary text-sm">
            {{ t('subProcessors.dpaLink') }}
          </a>
        </div>
        <span class="text-tertiary text-sm">{{ p.role }}</span>
        <span class="text-tertiary text-sm">{{ p.location }}</span>
      </li>
    </ul>

    <p class="text-tertiary text-sm mt-6">{{ t('subProcessors.notification') }}</p>
  </article>
</template>
