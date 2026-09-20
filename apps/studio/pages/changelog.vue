<script setup lang="ts">
  // 🔴 THE LAYOUT DEPENDS ON WHETHER ANYONE IS SIGNED IN ([designer], KH-1027).
  // The visitor arrives from the FOOTER OF /login — a shell-less page — and the
  // app shell then draws a sidebar, an org switcher and a breadcrumb that
  // cannot work without a session. Measured on the served build: three
  // `GET /api/auth/organization/list` calls answer 401 and the chrome renders
  // empty. Controls that cannot work are worse than no controls.
  //
  // 🔴 THE SOURCE IS THE SERVER, NOT THE CLIENT, and that choice is the whole
  // reason this is not a hydration mismatch. `auth.global.ts` opens with
  // `if (import.meta.server) return`, so the CLIENT does not know the answer
  // until after hydration — deciding there would render one layout, resolve the
  // session, and swap to another, which is exactly the class of defect KH-1034
  // is about. `event.context.auth` is already resolved server-side by
  // `server/middleware/auth.ts`, so the first paint is right and `useState`
  // carries the same value into the client through the payload.
  definePageMeta({ layout: false })

  const signedIn = useState('changelog-signed-in', () =>
    Boolean((useRequestEvent()?.context as { auth?: unknown } | undefined)?.auth),
  )

  const { t } = useI18n()

  interface ChangelogResponse {
    source: string
    html: string
    markdown: string
  }

  const { data: studio } = await useAsyncData('changelog-studio', () =>
    $fetch<ChangelogResponse>('/api/changelog/studio'),
  )
  const { data: sdk } = await useAsyncData('changelog-sdk', () =>
    $fetch<ChangelogResponse>('/api/changelog/sdk'),
  )
</script>

<template>
  <NuxtLayout :name="signedIn ? 'app' : 'auth'">
    <section class="p-6">
      <header class="mb-6">
        <h1 class="m-0">{{ t('changelog.title') }}</h1>
        <p class="text-tertiary mt-2">{{ t('changelog.intro') }}</p>
      </header>

      <GTTabs
        :tabs="[
          { id: 'studio', label: t('changelog.studio') },
          { id: 'sdk', label: t('changelog.sdk') },
        ]"
      >
        <GTTabPanel id="studio">
          <article v-if="studio?.html" class="container-prose" v-html="studio.html" />
          <p v-else class="text-tertiary">{{ t('changelog.empty') }}</p>
        </GTTabPanel>

        <GTTabPanel id="sdk">
          <article v-if="sdk?.html" class="container-prose" v-html="sdk.html" />
          <p v-else class="text-tertiary">{{ t('changelog.empty') }}</p>
        </GTTabPanel>
      </GTTabs>
    </section>
  </NuxtLayout>
</template>
