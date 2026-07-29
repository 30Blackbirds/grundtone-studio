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
  import type { Tokens } from '~~/server/lib/tokens'

  // Project-level workbench (Allan 2026-07-29): renders the catalog in the
  // tokens the parent passes — on the project page that's the live editor
  // state, so unsaved colour/spacing tweaks show up here immediately.
  const props = defineProps<{
    tokens: Partial<Tokens>
    mode?: 'base' | 'dark'
  }>()

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

  const themeVars = computed(() => tokensToCssVars(props.tokens))

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
  <div class="workbench">
    <!-- Rail: search + grouped component list -->
    <nav class="workbench__rail flex flex-col gap-3" :aria-label="t('componentLibrary.railLabel')">
      <GTInput v-model="search" :placeholder="t('componentLibrary.search')" size="sm" />
      <template v-for="[group, entries] in filtered" :key="group">
        <h3 class="text-xs uppercase text-tertiary tracking-wide m-0">{{ group }}</h3>
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

    <!-- Canvas: live render in the parent-supplied theme -->
    <div class="flex flex-col gap-3">
      <div
        class="workbench__canvas rounded-lg border"
        :class="{ 'workbench__canvas--dark': mode === 'dark' }"
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
      class="workbench__controls p-4 bg-surface-raised border rounded-lg flex flex-col gap-3"
      :aria-label="t('componentLibrary.controlsLabel')"
    >
      <h3 class="text-xs uppercase text-tertiary tracking-wide m-0">
        {{ t('componentLibrary.controlsLabel') }}
      </h3>
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
</template>
