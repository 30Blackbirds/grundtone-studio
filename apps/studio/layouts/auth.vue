<script setup lang="ts">
  const { t } = useI18n()
</script>

<template>
  <div class="auth-shell">
    <GTSkipLink href="#main">{{ t('skip.toContent') }}</GTSkipLink>
    <!-- Shell-less, as the R9 prototype: the card carries the mark and the
         product name, so there is no header ([designer] 2026-09-17). The
         language must stay selectable before login, so the switch sits as a
         quiet control under the card. -->
    <main id="main" class="auth-shell__main">
      <slot />
      <div class="auth-shell__lang">
        <LanguageSwitch />
      </div>
    </main>
    <AppFooter />
    <!-- Same toast host as the app shell (UX-audit finding 1): auth flows
         (sign-up, verify, invitations) can confirm actions too. -->
    <GTToastContainer />
  </div>
</template>
