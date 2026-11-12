<script setup lang="ts">
  import { orgWrites } from '~~/lib/org-writes'
  import type { DashboardPayload } from '~~/server/lib/dashboard'

  definePageMeta({ layout: 'app' })

  const { t, locale } = useI18n()

  // One reference time per render, so every relative time on the page agrees.
  const now = new Date()

  // 🔴 THE DEFAULT IS `null`, AND THAT IS THE FIX, NOT A STYLE CHOICE
  // (KH-1034 / KH-1123, found by [designer]).
  //
  // This used to default to `{ orgs: [], projects: [], activity: [] }`, and a
  // signed-in visitor who loaded /login directly ended up in the onboarding
  // wizard although they had an organization. MEASURED on the served build:
  // /api/dashboard was never requested at all on that path — so it was not a
  // race between the fetch and the check, and no `nextTick` would have cured
  // it. `useAsyncData` in nuxt 3.21.11 (dist/app/composables/asyncData.js:114)
  // short-circuits when `fetchOnServer && nuxtApp.isHydrating && data.value !=
  // null`: it sets the status to `success` and NEVER CALLS THE HANDLER,
  // because during hydration it assumes SSR already fetched. Arriving here via
  // a client-side redirect that runs while `isHydrating` is still true makes
  // that assumption false, and the non-null thing it saw was our own default.
  //
  // So the old fallback value was ALSO a valid normal outcome — "no orgs" is
  // what a brand-new user really looks like — and the page could not tell
  // "never fetched" from "fetched, and empty". `null` cannot be confused with
  // either, and it makes the short-circuit above fail, so the data is fetched
  // before mount instead.
  //
  // NOTE for anyone tempted by the obvious guard: `status` does NOT
  // discriminate here. In the short-circuited case it is literally 'success'.
  const { data: loaded, refresh } = await useAsyncData<DashboardPayload | null>(
    'dashboard',
    () =>
      $fetch<DashboardPayload>('/api/dashboard', {
        headers: useRequestHeaders(['cookie']),
      }),
    { default: () => null },
  )

  const EMPTY_DASHBOARD: DashboardPayload = { orgs: [], projects: [], activity: [] }
  // Everything that only RENDERS may read the empty shape; only the decision
  // below needs to tell "not loaded" from "loaded and empty".
  const dash = computed<DashboardPayload>(() => loaded.value ?? EMPTY_DASHBOARD)

  // Authed users with no orgs land in the onboarding wizard instead of an
  // empty dashboard. Client-only because navigateTo during SSR breaks the
  // auth-cookie round-trip on first signup.
  //
  // A watcher INSIDE onMounted, not a bare onMounted check: on the redirect
  // path the fetch resolves AFTER mount, so a one-shot check would read `null`
  // and decide nothing; `immediate` covers the ordinary path where the payload
  // is already there. Registering it in onMounted keeps it client-only without
  // an `import.meta.client` guard — which matters because that guard is
  // undefined under vitest, and a cell for this condition would have gone
  // green while testing nothing at all.
  //
  // It reads `loaded`, never `dash`, so the condition can only ever be true of
  // an answer the server actually gave.
  onMounted(() => {
    watch(
      loaded,
      (value) => {
        if (value && value.orgs.length === 0) navigateTo('/onboarding')
      },
      { immediate: true },
    )
  })

  const publishedCount = computed(
    () => dash.value.projects.filter((p) => p.status === 'published').length,
  )
  const lastPublishedAt = computed(() => {
    const dates = dash.value.projects
      .map((p) => p.publishedAt)
      .filter((x): x is string => Boolean(x))
      .sort()
    return dates.length ? dates[dates.length - 1] : null
  })

  // Create-org lives in a modal (UX-audit finding #6: inline-expanding forms
  // push content around).
  const showCreate = ref(false)
  const orgName = ref('')
  const orgSlug = ref('')
  const creating = ref(false)
  const error = ref<string | null>(null)

  async function create() {
    creating.value = true
    error.value = null
    const res = await orgWrites.create({ name: orgName.value, slug: orgSlug.value })
    creating.value = false
    if (res.error) {
      error.value = res.error.message ?? t('orgs.createError')
      return
    }
    showCreate.value = false
    orgName.value = ''
    orgSlug.value = ''
    // Refresh BOTH caches: the dashboard aggregate (stat cards) AND the shared
    // org-context list the sidebar/org-switcher read — without the latter the
    // new org is invisible in the chrome until a hard reload (Allan-bug
    // 2026-07-30: "2 Organizations" stat, empty sidebar).
    await Promise.all([refresh(), refreshNuxtData('org-context-orgs')])
  }

  function statusVariant(
    status: 'published' | 'draft' | 'none',
  ): 'success' | 'warning' | 'neutral' {
    if (status === 'published') return 'success'
    if (status === 'draft') return 'warning'
    return 'neutral'
  }
</script>

<template>
  <section class="p-6">
    <header class="dash-header flex justify-between mb-6">
      <div>
        <h1 class="m-0">{{ t('dashboard.title') }}</h1>
        <p class="text-tertiary mt-1 text-sm m-0">{{ t('dashboard.subtitle') }}</p>
      </div>
      <GTButton @click="showCreate = true">{{ t('orgs.new') }}</GTButton>
    </header>

    <div class="dash-stats mb-6">
      <div class="dash-stat bg-surface-raised border rounded-lg">
        <div class="dash-stat__value">{{ dash.projects.length }}</div>
        <div class="dash-stat__label text-tertiary">{{ t('dashboard.statProjects') }}</div>
      </div>
      <div class="dash-stat bg-surface-raised border rounded-lg">
        <div class="dash-stat__value">{{ dash.orgs.length }}</div>
        <div class="dash-stat__label text-tertiary">{{ t('dashboard.statOrgs') }}</div>
      </div>
      <div class="dash-stat bg-surface-raised border rounded-lg">
        <div class="dash-stat__value">{{ publishedCount }}</div>
        <div class="dash-stat__label text-tertiary">{{ t('dashboard.statPublished') }}</div>
      </div>
      <div class="dash-stat bg-surface-raised border rounded-lg">
        <div
          class="dash-stat__value"
          :title="lastPublishedAt ? absoluteDate(new Date(lastPublishedAt), locale) : undefined"
        >
          {{ lastPublishedAt ? relativeTime(new Date(lastPublishedAt), now, locale) : '—' }}
        </div>
        <div class="dash-stat__label text-tertiary">{{ t('dashboard.statLastPublish') }}</div>
      </div>
    </div>

    <section class="mb-8">
      <h2 class="dash-heading">
        {{ t('dashboard.projectsHeading') }}
      </h2>
      <div v-if="dash.projects.length" class="dash-grid">
        <NuxtLink
          v-for="p in dash.projects"
          :key="p.id"
          :to="`/orgs/${p.orgSlug}/projects/${p.slug}`"
          class="dash-card bg-surface-raised border rounded-lg no-underline text-inherit"
        >
          <div class="flex items-center gap-2">
            <!-- Swatch color is per-project DATA (the brand's published primary
                 token), not theming — the one legitimate use of a style binding. -->
            <span
              v-if="p.primaryColor"
              class="dash-swatch"
              :style="{ background: p.primaryColor }"
              aria-hidden="true"
            />
            <strong>{{ p.name }}</strong>
          </div>
          <!-- Org name stays with multi-org: same-named projects in two orgs must
               be told apart ([designer] 2026-09-17). Own line, so the token count
               and badge keep one row as in the prototype. -->
          <div class="text-tertiary text-sm mt-1 truncate">{{ p.orgName }}</div>
          <div class="flex items-center justify-between gap-2 mt-2">
            <span class="text-tertiary text-sm">
              <template v-if="p.tokenCount !== null">
                {{ t('dashboard.tokenCount', { n: p.tokenCount }, p.tokenCount) }}
              </template>
            </span>
            <GTBadge :variant="statusVariant(p.status)">
              {{ t(`dashboard.status.${p.status}`) }}
            </GTBadge>
          </div>
        </NuxtLink>
      </div>
      <EmptyState v-else icon="folder" :title="t('dashboard.noProjects')">
        <NuxtLink v-if="dash.orgs.length" :to="`/orgs/${dash.orgs[0].slug}`" class="text-sm">
          {{ t('dashboard.noProjectsCta') }}
        </NuxtLink>
      </EmptyState>
    </section>

    <section v-if="dash.activity.length">
      <h2 class="dash-heading">
        {{ t('dashboard.activityHeading') }}
      </h2>
      <ul class="dash-activity list-reset bg-surface-raised border rounded-lg">
        <li
          v-for="a in dash.activity"
          :key="a.id"
          class="dash-activity__row flex items-center gap-3"
        >
          <span
            :class="['dash-activity__dot', `dash-activity__dot--${activityTone(a.action)}`]"
            aria-hidden="true"
          />
          <span>
            <template v-if="a.targetLabel">{{ a.targetLabel }} — </template>
            <span class="text-secondary">{{ t(auditActionKey(a.action)) }}</span>
          </span>
          <!-- Quick overview: no actor here. The Revisionslog keeps the full
               record (actor, target, exact time) unchanged ([designer]). -->
          <span
            class="text-tertiary dash-activity__meta"
            :title="absoluteDate(new Date(a.createdAt), locale)"
          >
            {{ relativeTime(new Date(a.createdAt), now, locale) }}
          </span>
        </li>
      </ul>
    </section>

    <GTModal :open="showCreate" :title="t('orgs.new')" @update:open="showCreate = $event">
      <form id="create-org-form" class="flex flex-col gap-4" @submit.prevent="create">
        <GTInput v-model="orgName" :label="t('orgs.nameLabel')" required />
        <GTInput v-model="orgSlug" :label="t('orgs.slugLabel')" required pattern="[a-z0-9-]+" />
        <GTAlert v-if="error" variant="error" :heading="error" />
      </form>
      <template #footer>
        <div class="flex gap-3 justify-end">
          <GTButton type="button" variant="secondary" @click="showCreate = false">
            {{ t('app.cancel') }}
          </GTButton>
          <GTButton type="submit" form="create-org-form" :loading="creating">
            {{ t('app.create') }}
          </GTButton>
        </div>
      </template>
    </GTModal>
  </section>
</template>
