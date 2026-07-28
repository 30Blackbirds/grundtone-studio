<script setup lang="ts">
  import { ref, computed, watch } from 'vue'
  import { useOrgContext } from '~/composables/useOrgContext'
  import { tokensToCssVars } from '~/composables/useThemeVars'
  import type { Tokens } from '~~/server/lib/tokens'

  definePageMeta({ layout: 'app' })

  interface ConfigVersion {
    id: string
    version: number
    tokens: Tokens
  }
  interface ConfigResponse {
    draft: ConfigVersion | null
    active: ConfigVersion | null
    defaults: Tokens
  }

  const { projects } = useOrgContext()

  // Theme switcher — the selected project's tokens drive the whole gallery, so
  // you see components in that project's brand and watch colours change live.
  const selectedProjectId = ref('')
  watch(
    projects,
    (list) => {
      if (!selectedProjectId.value && list.length) selectedProjectId.value = list[0].id
    },
    { immediate: true },
  )

  const { data: config } = await useAsyncData<ConfigResponse | null>(
    () => `components-theme-${selectedProjectId.value || 'none'}`,
    async () => {
      if (!selectedProjectId.value) return null
      return await $fetch<ConfigResponse>(`/api/projects/${selectedProjectId.value}/config`, {
        headers: useRequestHeaders(['cookie']),
      })
    },
    { watch: [selectedProjectId], default: () => null },
  )

  // Prefer the published (active) theme, fall back to the draft, then defaults.
  const activeTokens = computed<Partial<Tokens>>(
    () =>
      config.value?.active?.tokens ?? config.value?.draft?.tokens ?? config.value?.defaults ?? {},
  )
  const themeVars = computed(() => tokensToCssVars(activeTokens.value))
  const source = computed(() =>
    config.value?.active ? 'aktiv' : config.value?.draft ? 'draft' : 'defaults',
  )

  const projectOptions = computed(() => projects.value.map((p) => ({ value: p.id, label: p.name })))
  const primary = computed(() => activeTokens.value.colors?.primary ?? '—')

  // Curated gallery of components (studio's installed @grundtone/vue set). New
  // develop-only components (GTAppShell/GTDrawer/GTMeter/GTRichText) join once
  // the design system is prereleased under a consumable version.
  const selectValue = ref('a')
  const toggleValue = ref(true)
  const checkValue = ref(false)
  const inputValue = ref('')
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex justify-between items-center gap-4 flex-wrap">
      <div>
        <h1 class="m-0">Komponent-bibliotek</h1>
        <p class="text-tertiary m-0">
          Interaktivt grundtone-komponent-galleri. Vælg et projekt for at se komponenterne i dets
          tema.
        </p>
      </div>
      <div class="flex items-center gap-4">
        <div class="flex items-center gap-2">
          <span
            :style="{
              display: 'inline-block',
              inlineSize: '1.25rem',
              blockSize: '1.25rem',
              borderRadius: '0.25rem',
              background: primary,
              border: '1px solid var(--color-border-light)',
            }"
            :title="`primary: ${primary}`"
          />
          <code class="text-sm">{{ primary }}</code>
        </div>
        <GTSelect
          v-model="selectedProjectId"
          label="Projekt-tema"
          :options="projectOptions"
          style="min-inline-size: 14rem"
        />
      </div>
    </header>

    <p v-if="!projectOptions.length" class="text-tertiary">
      Ingen projekter endnu — opret et projekt for at se dets tema anvendt her.
    </p>

    <!-- Themed preview: the selected project's tokens are applied as scoped CSS
         vars, so every @grundtone component inside renders in that brand. -->
    <div v-else :style="themeVars" class="p-6 rounded-lg border bg-surface flex flex-col gap-8">
      <p class="text-tertiary text-sm m-0">
        Tema-kilde: <strong>{{ source }}</strong> · ændr projektets tokens i token-editoren og se
        galleriet skifte.
      </p>

      <section class="flex flex-col gap-3">
        <h2 class="text-sm uppercase text-tertiary tracking-wide m-0">Knapper</h2>
        <div class="flex gap-3 flex-wrap items-center">
          <GTButton variant="primary">Primær</GTButton>
          <GTButton variant="secondary">Sekundær</GTButton>
          <GTButton variant="outlined">Outlined</GTButton>
          <GTButton variant="negative">Negativ</GTButton>
          <GTButton variant="primary" :loading="true">Loader</GTButton>
        </div>
      </section>

      <section class="flex flex-col gap-3">
        <h2 class="text-sm uppercase text-tertiary tracking-wide m-0">Badges &amp; tags</h2>
        <div class="flex gap-3 flex-wrap items-center">
          <GTBadge variant="info">Info</GTBadge>
          <GTBadge variant="success">Success</GTBadge>
          <GTBadge variant="warning">Warning</GTBadge>
          <GTBadge variant="error">Error</GTBadge>
          <GTTag label="Tag" />
        </div>
      </section>

      <section class="flex flex-col gap-3">
        <h2 class="text-sm uppercase text-tertiary tracking-wide m-0">Feedback</h2>
        <GTAlert variant="info" heading="Info">Tokens fra det valgte projekt.</GTAlert>
        <GTAlert variant="success" heading="Success">Farverne kommer fra projektets tema.</GTAlert>
      </section>

      <section class="flex flex-col gap-3">
        <h2 class="text-sm uppercase text-tertiary tracking-wide m-0">Formular</h2>
        <div class="grid gap-4" style="max-inline-size: 24rem">
          <GTInput v-model="inputValue" label="Navn" placeholder="Skriv…" />
          <GTSelect
            v-model="selectValue"
            label="Valg"
            :options="[
              { value: 'a', label: 'Første' },
              { value: 'b', label: 'Anden' },
            ]"
          />
          <GTToggle v-model="toggleValue" label="Aktiveret" />
          <GTCheckbox v-model="checkValue" label="Accepter vilkår" />
        </div>
      </section>

      <section class="flex flex-col gap-3">
        <h2 class="text-sm uppercase text-tertiary tracking-wide m-0">Kort</h2>
        <GTCard title="Projekt-kort" variant="raised" style="max-inline-size: 24rem">
          Et kort med projektets surface- og tekst-tokens.
        </GTCard>
      </section>
    </div>
  </div>
</template>
