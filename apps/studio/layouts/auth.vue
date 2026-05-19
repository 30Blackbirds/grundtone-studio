<script setup lang="ts">
  const { t } = useI18n()
</script>

<template>
  <div>
    <GTSkipLink href="#main">{{ t('skip.toContent') }}</GTSkipLink>
    <header class="flex justify-between items-center p-6 text-lg">
      <NuxtLink to="/" class="brand-link">{{ t('app.name') }}</NuxtLink>
      <LanguageSwitch />
    </header>
    <main id="main">
      <slot />
    </main>
    <AppFooter />
  </div>
</template>
