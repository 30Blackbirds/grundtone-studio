<script setup lang="ts">
  // 🔴 `<html lang>` was EMPTY on every page. Found by [designer] on /dpa;
  // measured afterwards on the served build, it was missing on /login,
  // /forgot-password and /changelog too, and was never set anywhere in the app.
  //
  // A screen reader with no `lang` falls back to the user's system voice, so
  // Danish copy gets read with an English pronunciation (or the reverse) —
  // silently, since nothing renders differently. It also costs the page its
  // language signal for search engines.
  //
  // Derived from the ACTIVE locale rather than hardcoded: studio ships `da` and
  // `en` with a runtime switcher, so a fixed value would be wrong for half the
  // users. `strategy: 'no_prefix'` means the URL carries no locale, which is
  // exactly why the attribute has to come from i18n state.
  const { locale } = useI18n()
  useHead({ htmlAttrs: { lang: locale } })
</script>

<template>
  <div>
    <!--
      🔴 ClientOnly, because the server and the client disagree about this node.
      Measured on the served production build (KH-1034): at this position the
      server emits a bare `<div></div>` while the client mounts
      `<span class="nuxt-route-announcer">`, and Vue reports "Hydration
      completed but contains mismatches". It is not specific to /login or to the
      auth layout — the announcer is absent from the server HTML of every
      server-rendered page measured (/login, /changelog, /dpa,
      /forgot-password), and `routeRules` does not disable SSR for any of them.

      The announcer only ever speaks after a client-side route change, so it has
      nothing to say during SSR. Rendering it client-side keeps the screen-reader
      announcement and removes the disagreement; the acceptance for this fix is
      BOTH — zero hydration warnings AND the announcer still present in the DOM,
      so the warning cannot be traded away for an accessibility loss.
    -->
    <ClientOnly>
      <NuxtRouteAnnouncer />
    </ClientOnly>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </div>
</template>
