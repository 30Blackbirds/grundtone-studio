<script setup lang="ts">
  definePageMeta({ layout: false })

  onMounted(() => {
    navigateTo('/dashboard')
  })
</script>

<template>
  <p class="muted" style="padding: 2rem">Loading…</p>
</template>
