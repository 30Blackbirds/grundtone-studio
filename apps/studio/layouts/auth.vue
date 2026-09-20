<script setup lang="ts">
  import { isInformationalPath } from '~~/middleware/auth-decision'

  const { t } = useI18n()
  const route = useRoute()

  // 🔴 A SHELL-LESS PAGE NEEDS A WAY BACK, and it belongs here rather than on
  // each page ([designer], KH-1027). The visitor arrives from the footer of
  // /login — a page with no navigation of its own — and on /dpa today there is
  // nothing to click: no sidebar, no header, no link home. Putting it in the
  // shared layout means the next footer page inherits the way back instead of
  // quietly not having one.
  //
  // Not on the auth entry points or mid-flow landings: there the visitor is
  // going FORWARD, and a competing control is worse than none.
  const showBack = computed(() => isInformationalPath(route.path))
</script>

<template>
  <div class="auth-shell">
    <GTSkipLink href="#main">{{ t('skip.toContent') }}</GTSkipLink>
    <!-- Shell-less, as the R9 prototype: the card carries the mark and the
         product name, so there is no header ([designer] 2026-09-17). The
         language must stay selectable before login, so the switch sits as a
         quiet control under the card. -->
    <main id="main" class="auth-shell__main">
      <NuxtLink v-if="showBack" to="/login" class="auth-shell__back">
        {{ t('auth.backToSignIn') }}
      </NuxtLink>
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
