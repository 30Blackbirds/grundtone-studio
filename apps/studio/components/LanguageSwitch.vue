<script setup lang="ts">
  const { locale, locales, setLocale } = useI18n()

  const otherLocales = computed(() =>
    (locales.value as { code: string; name: string }[]).filter((l) => l.code !== locale.value),
  )
</script>

<template>
  <div class="flex items-center gap-2">
    <span class="text-tertiary text-sm">{{ locale.toUpperCase() }}</span>
    <GTButton
      v-for="other in otherLocales"
      :key="other.code"
      variant="tertiary"
      size="sm"
      :aria-label="`${$t('app.language')}: ${other.name}`"
      @click="setLocale(other.code as 'da' | 'en')"
    >
      {{ other.code.toUpperCase() }}
    </GTButton>
  </div>
</template>
