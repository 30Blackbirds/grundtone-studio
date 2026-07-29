<script setup lang="ts">
  import { ref, computed, watch } from 'vue'
  import {
    GTButton,
    GTBadge,
    GTTag,
    GTAlert,
    GTInput,
    GTSelect,
    GTToggle,
    GTCheckbox,
    GTCard,
    GTDetails,
    GTTooltip,
    GTBreadcrumb,
  } from '@grundtone/vue'
  import { COMPONENT_CATALOG, buildSnippet, type CatalogEntry } from '~~/lib/component-catalog'
  import { tokensToCssVars } from '~/composables/useThemeVars'
  import type { DashboardPayload } from '~~/server/lib/dashboard'
  import type { Tokens } from '~~/server/lib/tokens'

  definePageMeta({ layout: 'app' })
  const { t } = useI18n()

  // Explicit map because <component :is> can't use Nuxt's auto-resolution.
  const RENDERABLE: Record<string, unknown> = {
    GTButton,
    GTBadge,
    GTTag,
    GTAlert,
    GTInput,
    GTSelect,
    GTToggle,
    GTCheckbox,
    GTCard,
    GTDetails,
    GTTooltip,
    GTBreadcrumb,
  }

  // Projects come from the dashboard aggregate — NOT useOrgContext, whose
  // project list is derived from the route's org slug and therefore EMPTY on
  // this global page (the v1 bug: the whole gallery hid behind it).
  const { data: dash } = await useAsyncData<DashboardPayload>(
    'workbench-projects',
    () => $fetch<DashboardPayload>('/api/dashboard', { headers: useRequestHeaders(['cookie']) }),
    { default: () => ({ orgs: [], projects: [], activity: [] }) },
  )

  const STUDIO_DEFAULT = ''
  const selectedProjectId = ref(STUDIO_DEFAULT)
  const projectOptions = computed(() => [
    { value: STUDIO_DEFAULT, label: t('componentLibrary.studioDefault') },
    ...dash.value.projects.map((p) => ({ value: p.id, label: `${p.name} (${p.orgName})` })),
  ])

  interface ConfigResponse {
    draft: { tokens: Tokens } | null
    active: { tokens: Tokens } | null
    defaults: Tokens
  }
  const { data: config } = await useAsyncData<ConfigResponse | null>(
    () => `workbench-theme-${selectedProjectId.value || 'default'}`,
    async () => {
      if (!selectedProjectId.value) return null
      return await $fetch<ConfigResponse>(`/api/projects/${selectedProjectId.value}/config`, {
        headers: useRequestHeaders(['cookie']),
      })
    },
    { watch: [selectedProjectId], default: () => null },
  )

  const darkMode = ref(false)
  const baseTokens = computed<Partial<Tokens>>(
    () =>
      config.value?.active?.tokens ?? config.value?.draft?.tokens ?? config.value?.defaults ?? {},
  )
  const hasDarkSet = computed(() => Boolean(baseTokens.value.dark?.colors))
  // Dark = the project's dark-override layer merged over its base colors —
  // exactly what the published CDN css serves for prefers-color-scheme: dark.
  const themeVars = computed(() => {
    const tokens = baseTokens.value
    if (!darkMode.value || !tokens.dark?.colors) return tokensToCssVars(tokens)
    return tokensToCssVars({
      ...tokens,
      colors: { ...(tokens.colors ?? {}), ...tokens.dark.colors },
    })
  })

  // ── Workbench state ───────────────────────────────────────────────────────
  const search = ref('')
  const selectedName = ref(COMPONENT_CATALOG[0]!.name)
  const entry = computed<CatalogEntry>(
    () => COMPONENT_CATALOG.find((c) => c.name === selectedName.value) ?? COMPONENT_CATALOG[0]!,
  )

  const filtered = computed(() => {
    const q = search.value.trim().toLowerCase()
    const list = q
      ? COMPONENT_CATALOG.filter((c) => c.name.toLowerCase().includes(q))
      : COMPONENT_CATALOG
    const groups = new Map<string, CatalogEntry[]>()
    for (const c of list) {
      if (!groups.has(c.group)) groups.set(c.group, [])
      groups.get(c.group)!.push(c)
    }
    return [...groups.entries()]
  })

  const controlState = ref<Record<string, string | boolean>>({})
  const slotState = ref('')
  const modelState = ref<unknown>('')

  function resetControls() {
    controlState.value = Object.fromEntries(
      entry.value.controls.map((control) => [control.prop, control.default]),
    )
    slotState.value = entry.value.slotText ?? ''
    modelState.value =
      entry.value.name === 'GTToggle' || entry.value.name === 'GTCheckbox' ? false : ''
  }
  watch(entry, resetControls, { immediate: true })

  // Empty strings must not reach the component as real props (e.g. an empty
  // errorText would flip GTInput into its error state).
  const liveProps = computed(() => {
    const props: Record<string, unknown> = { ...(entry.value.fixedProps ?? {}) }
    for (const control of entry.value.controls) {
      const value = controlState.value[control.prop]
      if (control.type === 'text' && String(value ?? '').length === 0) continue
      props[control.prop] = value
    }
    return props
  })

  const snippet = computed(() => buildSnippet(entry.value, controlState.value, slotState.value))

  const copied = ref(false)
  async function copySnippet() {
    await navigator.clipboard.writeText(snippet.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  }
</script>

<template>
  <div class="flex flex-col gap-4">
    <header class="flex justify-between items-center gap-4 flex-wrap">
      <div>
        <h1 class="m-0">{{ t('componentLibrary.title') }}</h1>
        <p class="text-tertiary m-0 text-sm">{{ t('componentLibrary.subtitle') }}</p>
      </div>
      <div class="flex items-center gap-4 flex-wrap">
        <GTToggle
          v-model="darkMode"
          :label="t('componentLibrary.dark')"
          :disabled="!hasDarkSet && !darkMode"
        />
        <GTSelect
          v-model="selectedProjectId"
          :label="t('componentLibrary.projectTheme')"
          :options="projectOptions"
        />
      </div>
    </header>

    <div class="workbench">
      <!-- Rail: search + grouped component list -->
      <nav
        class="workbench__rail flex flex-col gap-3"
        :aria-label="t('componentLibrary.railLabel')"
      >
        <GTInput v-model="search" :placeholder="t('componentLibrary.search')" size="sm" />
        <template v-for="[group, entries] in filtered" :key="group">
          <h2 class="text-xs uppercase text-tertiary tracking-wide m-0">{{ group }}</h2>
          <ul class="list-reset flex flex-col gap-1">
            <li v-for="c in entries" :key="c.name">
              <button
                type="button"
                class="block w-full text-left p-2 rounded text-sm border-0 bg-transparent cursor-pointer hover:bg-surface-raised"
                :class="{ 'bg-surface-raised font-bold': c.name === selectedName }"
                @click="selectedName = c.name"
              >
                {{ c.name }}
              </button>
            </li>
          </ul>
        </template>
        <p v-if="!filtered.length" class="text-tertiary text-sm m-0">
          {{ t('componentLibrary.noMatches') }}
        </p>
      </nav>

      <!-- Canvas: themed live render -->
      <div class="flex flex-col gap-3">
        <div
          class="workbench__canvas rounded-lg border bg-surface"
          :class="{ 'workbench__canvas--dark': darkMode && hasDarkSet }"
          :style="themeVars"
        >
          <component :is="RENDERABLE[entry.name]" v-bind="liveProps" v-model="modelState">
            <template v-if="entry.slotText !== undefined" #default>{{ slotState }}</template>
          </component>
        </div>

        <!-- Snippet -->
        <div class="p-4 bg-surface-raised border rounded-lg flex items-start gap-3">
          <pre class="workbench__snippet flex-1"><code>{{ snippet }}</code></pre>
          <GTButton variant="outlined" size="sm" @click="copySnippet">
            {{ copied ? t('componentLibrary.copied') : t('componentLibrary.copy') }}
          </GTButton>
        </div>
      </div>

      <!-- Controls -->
      <aside
        class="p-4 bg-surface-raised border rounded-lg flex flex-col gap-3"
        :aria-label="t('componentLibrary.controlsLabel')"
      >
        <h2 class="text-xs uppercase text-tertiary tracking-wide m-0">
          {{ t('componentLibrary.controlsLabel') }}
        </h2>
        <template v-for="control in entry.controls" :key="control.prop">
          <GTSelect
            v-if="control.type === 'select'"
            :model-value="String(controlState[control.prop])"
            :label="control.prop"
            :options="(control.options ?? []).map((o) => ({ value: o, label: o }))"
            size="sm"
            @update:model-value="(v) => (controlState[control.prop] = String(v))"
          />
          <GTToggle
            v-else-if="control.type === 'boolean'"
            :model-value="Boolean(controlState[control.prop])"
            :label="control.prop"
            size="sm"
            @update:model-value="(v) => (controlState[control.prop] = Boolean(v))"
          />
          <GTInput
            v-else
            :model-value="String(controlState[control.prop])"
            :label="control.prop"
            size="sm"
            @update:model-value="(v) => (controlState[control.prop] = String(v))"
          />
        </template>
        <GTInput
          v-if="entry.slotText !== undefined"
          v-model="slotState"
          :label="t('componentLibrary.slotLabel')"
          size="sm"
        />
      </aside>
    </div>
  </div>
</template>
