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
