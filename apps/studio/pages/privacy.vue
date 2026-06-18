<script setup lang="ts">
  definePageMeta({ layout: 'auth' })
  const { t } = useI18n()
</script>

<template>
  <article class="container-prose mx-auto p-6 flex flex-col gap-4">
    <header>
      <h1 class="font-heading text-3xl mt-0 mb-2">{{ t('privacy.title') }}</h1>
      <p class="text-tertiary m-0">{{ t('privacy.updated') }}</p>
    </header>

    <p>{{ t('privacy.intro') }}</p>

    <h2 class="font-heading text-2xl mt-6 mb-3">{{ t('privacy.controllerHeading') }}</h2>
    <p>{{ t('privacy.controller') }}</p>

    <h2 class="font-heading text-2xl mt-6 mb-3">{{ t('privacy.dataHeading') }}</h2>
    <ul class="pl-6">
      <li>{{ t('privacy.data.account') }}</li>
      <li>{{ t('privacy.data.session') }}</li>
      <li>{{ t('privacy.data.tokens') }}</li>
      <li>{{ t('privacy.data.cdn') }}</li>
    </ul>

    <h2 class="font-heading text-2xl mt-6 mb-3">{{ t('privacy.legalHeading') }}</h2>
    <p>{{ t('privacy.legal') }}</p>

    <h2 class="font-heading text-2xl mt-6 mb-3">{{ t('privacy.retentionHeading') }}</h2>
    <ul class="pl-6">
      <li>{{ t('privacy.retention.account') }}</li>
      <li>{{ t('privacy.retention.session') }}</li>
      <li>{{ t('privacy.retention.tokens') }}</li>
      <li>{{ t('privacy.retention.logs') }}</li>
    </ul>

    <h2 class="font-heading text-2xl mt-6 mb-3">{{ t('privacy.rightsHeading') }}</h2>
    <p>{{ t('privacy.rights') }}</p>

    <h2 class="font-heading text-2xl mt-6 mb-3">{{ t('privacy.subProcessorsHeading') }}</h2>
    <p>
      {{ t('privacy.subProcessors') }}
      <NuxtLink to="/sub-processors" class="text-primary">{{
        t('privacy.subProcessorsLink')
      }}</NuxtLink
      >.
    </p>

    <h2 class="font-heading text-2xl mt-6 mb-3">{{ t('privacy.contactHeading') }}</h2>
    <p>
      <a href="mailto:privacy@grundtone.com" class="text-primary">privacy@grundtone.com</a>
    </p>
  </article>
</template>
