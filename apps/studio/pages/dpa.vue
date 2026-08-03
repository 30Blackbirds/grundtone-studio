<script setup lang="ts">
  // Informations-side om databehandleraftalen. Indholdet spejler [jura]s
  // dpa-skabelon.md (849ca2f) — men skabelonen er selv markeret UDKAST med
  // krav om ekstern advokat-review før underskrift, så siden PUBLICERER IKKE
  // kontraktteksten; den beskriver rammen faktuelt korrekt og henviser til
  // privacy@klanghaus.dk. Fuld tekst-publicering afventer juras/advokatens go.
  definePageMeta({ layout: 'auth' })
  const { t } = useI18n()
</script>

<template>
  <article class="container-prose mx-auto p-6 flex flex-col gap-4">
    <header>
      <h1 class="font-heading text-3xl mt-0 mb-2">{{ t('dpa.title') }}</h1>
      <p class="text-tertiary m-0">{{ t('dpa.updated') }}</p>
    </header>

    <GTAlert variant="info" :heading="t('dpa.intakeHeading')">
      {{ t('dpa.intakeBody') }}
      <a href="mailto:privacy@klanghaus.dk" class="text-primary">privacy@klanghaus.dk</a>
    </GTAlert>

    <p>{{ t('dpa.intro') }}</p>

    <h2 class="font-heading text-2xl mt-6 mb-3">1. {{ t('dpa.scopeHeading') }}</h2>
    <p>{{ t('dpa.scope') }}</p>

    <h2 class="font-heading text-2xl mt-6 mb-3">2. {{ t('dpa.processingHeading') }}</h2>
    <ul class="pl-6">
      <li>{{ t('dpa.processing.purpose') }}</li>
      <li>{{ t('dpa.processing.duration') }}</li>
      <li>{{ t('dpa.processing.dataTypes') }}</li>
      <li>{{ t('dpa.processing.subjects') }}</li>
    </ul>

    <h2 class="font-heading text-2xl mt-6 mb-3">3. {{ t('dpa.securityHeading') }}</h2>
    <ul class="pl-6">
      <li>{{ t('dpa.security.encryption') }}</li>
      <li>{{ t('dpa.security.access') }}</li>
      <li>{{ t('dpa.security.audit') }}</li>
      <li>{{ t('dpa.security.incident') }}</li>
    </ul>

    <h2 class="font-heading text-2xl mt-6 mb-3">4. {{ t('dpa.subProcessorsHeading') }}</h2>
    <p>
      {{ t('dpa.subProcessors') }}
      <NuxtLink to="/sub-processors" class="text-primary">{{
        t('privacy.subProcessorsLink')
      }}</NuxtLink
      >.
    </p>

    <h2 class="font-heading text-2xl mt-6 mb-3">5. {{ t('dpa.terminationHeading') }}</h2>
    <p>{{ t('dpa.termination') }}</p>

    <h2 class="font-heading text-2xl mt-6 mb-3">6. {{ t('dpa.lawHeading') }}</h2>
    <p>{{ t('dpa.law') }}</p>
  </article>
</template>
