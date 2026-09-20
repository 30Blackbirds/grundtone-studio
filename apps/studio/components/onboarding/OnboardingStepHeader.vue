<script setup lang="ts">
  defineProps<{
    /** Icon name from @grundtone/icons — see the note in onboarding.vue. */
    icon: string
    title: string
    subtitle?: string
  }>()
</script>

<template>
  <header class="flex flex-col gap-2">
    <!-- The tinted rounded square from the R8 prototype (`.ob__ic`: 44px,
         12% primary tint, primary glyph). Decorative — the title next to it
         carries the meaning, so the icon is hidden from assistive tech. -->
    <span class="onboarding-step-icon" aria-hidden="true">
      <GTIcon :name="icon" size="md" />
    </span>
    <!-- 🔴 h2, NOT h1. The page already has one ("Grundtone Studio"), and every
         step component used to add a second — two h1s on one page, which is a
         structure error a screen-reader user meets before anything else. The
         prototype has exactly one heading per step, under the progress bar. -->
    <h2 class="onboarding-step-title m-0">{{ title }}</h2>
    <p v-if="subtitle" class="text-tertiary m-0">{{ subtitle }}</p>
  </header>
</template>
