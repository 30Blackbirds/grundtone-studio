<script setup lang="ts">
  const { t } = useI18n()
</script>

<template>
  <div class="auth-shell">
    <GTSkipLink href="#main">{{ t('skip.toContent') }}</GTSkipLink>
    <header class="flex justify-between items-center p-6 text-lg">
      <NuxtLink to="/" class="brand-link">{{ t('app.name') }}</NuxtLink>
      <LanguageSwitch />
    </header>
    <!-- Vertically centered viewport per the R9 prototype (au__vp). -->
    <main id="main" class="auth-shell__main">
      <slot />
    </main>
    <AppFooter />
    <!-- Same toast host as the app shell (UX-audit finding 1): auth flows
         (sign-up, verify, invitations) can confirm actions too. -->
    <GTToastContainer />
  </div>
</template>
