<script setup lang="ts">
  import type { OverflowMenuItem } from '@grundtone/vue'

  // GTOverflowMenu-based per redesign-language-switch.html (UX-audit #15 —
  // the old raw "DA EN" text buttons weren't a real component). Flags live as
  // label prefixes: the published OverflowMenuItem has an `active` state but
  // no per-item icon slot ([designer]-afklaret pragmatik 2026-07-30; icon-slot
  // er flagget som upstream-ønske).
  const { locale, locales, setLocale } = useI18n()

  const FLAGS: Record<string, string> = { da: '🇩🇰', en: '🇬🇧' }

  const typedLocales = computed(() => locales.value as { code: string; name: string }[])
  const current = computed(() => typedLocales.value.find((l) => l.code === locale.value))

  const items = computed<OverflowMenuItem[]>(() =>
    typedLocales.value.map((l) => ({
      label: `${FLAGS[l.code] ?? ''} ${l.name}`.trim(),
      value: l.code,
      active: l.code === locale.value,
    })),
  )

  async function onSelect(item: OverflowMenuItem) {
    if (item.value && item.value !== locale.value) {
      await setLocale(item.value as 'da' | 'en')
    }
  }
</script>

<template>
  <GTOverflowMenu
    :items="items"
    :label="`${FLAGS[locale] ?? ''} ${current?.name ?? locale.toUpperCase()}`"
    :aria-label="$t('app.language')"
    align="left"
    @select="onSelect"
  />
</template>
