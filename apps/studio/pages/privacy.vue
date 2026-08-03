<script setup lang="ts">
  // Indholdet er [jura]s privatlivspolitik v1.0 (docs/legal/privatlivspolitik.
  // {da,en}.md, 849ca2f) — dansk version er den autoritative. Ændringer i
  // teksten skal gå GENNEM juras dokumenter først; denne side er kun rendering.
  definePageMeta({ layout: 'auth' })
  const { t } = useI18n()

  const sections21to26 = ['s21', 's22', 's23', 's24', 's25', 's26'] as const
  const retentionRows = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'] as const
</script>

<template>
  <article class="container-prose mx-auto p-6 flex flex-col gap-4">
    <header>
      <h1 class="font-heading text-3xl mt-0 mb-2">{{ t('privacy.title') }}</h1>
      <p class="text-tertiary m-0">{{ t('privacy.versionLine') }}</p>
    </header>

    <h2 class="font-heading text-2xl mt-6 mb-3">1. {{ t('privacy.s1h') }}</h2>
    <!-- Mail-adressen ligger i templaten, ikke i i18n-strengen: rå @ i en
         vue-i18n-message er linked-message-syntaks og knækker builden (code 10). -->
    <p>
      {{ t('privacy.s1controller') }}
      {{ t('privacy.s1contactLabel') }}
      <a href="mailto:privacy@klanghaus.dk" class="text-primary">privacy@klanghaus.dk</a>.
    </p>
    <p class="text-tertiary text-sm">{{ t('privacy.s1dpoNote') }}</p>

    <h2 class="font-heading text-2xl mt-6 mb-3">2. {{ t('privacy.s2h') }}</h2>
    <section v-for="s in sections21to26" :key="s" class="flex flex-col gap-1">
      <h3 class="font-heading text-lg mt-3 mb-1">{{ t(`privacy.${s}h`) }}</h3>
      <ul class="pl-6">
        <li>{{ t(`privacy.${s}data`) }}</li>
        <li>{{ t(`privacy.${s}purpose`) }}</li>
        <li>{{ t(`privacy.${s}basis`) }}</li>
      </ul>
    </section>
    <p>{{ t('privacy.s2noTracking') }}</p>

    <h2 class="font-heading text-2xl mt-6 mb-3">3. {{ t('privacy.s3h') }}</h2>
    <p>{{ t('privacy.s3p') }}</p>

    <h2 class="font-heading text-2xl mt-6 mb-3">4. {{ t('privacy.s4h') }}</h2>
    <ul class="pl-6">
      <li>{{ t('privacy.s4controller') }}</li>
      <li>{{ t('privacy.s4processor') }}</li>
    </ul>

    <h2 class="font-heading text-2xl mt-6 mb-3">5. {{ t('privacy.s5h') }}</h2>
    <p>{{ t('privacy.s5p') }}</p>

    <h2 class="font-heading text-2xl mt-6 mb-3">6. {{ t('privacy.s6h') }}</h2>
    <p class="text-tertiary text-sm">{{ t('privacy.s6intro') }}</p>
    <LegalProcessorsTable />
    <p class="text-tertiary text-sm">{{ t('privacy.s6vimeoNote') }}</p>
    <p>
      {{ t('privacy.s6currentList') }}
      <NuxtLink to="/sub-processors" class="text-primary">{{
        t('privacy.subProcessorsLink')
      }}</NuxtLink
      >.
    </p>

    <h2 class="font-heading text-2xl mt-6 mb-3">7. {{ t('privacy.s7h') }}</h2>
    <div class="legal-table-wrap">
      <table class="legal-table">
        <thead>
          <tr>
            <th>{{ t('privacy.s7colCategory') }}</th>
            <th>{{ t('privacy.s7colRetention') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in retentionRows" :key="r">
            <td>{{ t(`privacy.s7${r}cat`) }}</td>
            <td>{{ t(`privacy.s7${r}val`) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h2 class="font-heading text-2xl mt-6 mb-3">8. {{ t('privacy.s8h') }}</h2>
    <p>{{ t('privacy.s8rights') }}</p>
    <p>
      {{ t('privacy.s8selfService') }}
      <a href="mailto:privacy@klanghaus.dk" class="text-primary">privacy@klanghaus.dk</a>.
      {{ t('privacy.s8responseTime') }}
    </p>
    <p>{{ t('privacy.s8noAutomated') }}</p>

    <h2 class="font-heading text-2xl mt-6 mb-3">9. {{ t('privacy.s9h') }}</h2>
    <p>{{ t('privacy.s9p') }}</p>

    <h2 class="font-heading text-2xl mt-6 mb-3">10. {{ t('privacy.s10h') }}</h2>
    <p>{{ t('privacy.s10p') }}</p>
  </article>
</template>
