<script setup lang="ts">
  defineProps<{
    /** Icon name from @grundtone/icons. */
    icon: string
    title: string
    body?: string
  }>()
</script>

<template>
  <!-- 🔴 ONE EMPTY STATE, USED EVERYWHERE — the R8 prototype's principle
       (UX-audit #10): "aldrig en bar tabel uden vej videre". An empty list gets
       the same tone as the wizard step that would fill it: an icon, a sentence
       that says what is missing, and the action that fixes it.
       The dashboard and the org page each had their own bordered box with a
       paragraph and a link; this is those two, in one place, so the next empty
       list inherits the pattern instead of inventing a third. -->
  <div class="empty-state">
    <span class="empty-state__icon" aria-hidden="true">
      <GTIcon :name="icon" size="md" />
    </span>
    <p class="empty-state__title m-0">{{ title }}</p>
    <p v-if="body" class="empty-state__body text-tertiary m-0">{{ body }}</p>
    <div v-if="$slots.default" class="empty-state__action"><slot /></div>
  </div>
</template>
