<script setup lang="ts">
  const { t } = useI18n()
</script>

<template>
  <footer class="flex flex-wrap gap-4 justify-center items-center p-6 text-tertiary text-sm">
    <NuxtLink to="/docs/install" class="no-underline text-inherit">
      {{ t('footer.installGuide') }}
    </NuxtLink>
    <span>·</span>
    <NuxtLink to="/changelog" class="no-underline text-inherit">
      {{ t('changelog.title') }}
    </NuxtLink>
    <span>·</span>
    <NuxtLink to="/privacy" class="no-underline text-inherit">
      {{ t('footer.privacy') }}
    </NuxtLink>
    <span>·</span>
    <NuxtLink to="/dpa" class="no-underline text-inherit">
      {{ t('footer.dpa') }}
    </NuxtLink>
    <span>·</span>
    <NuxtLink to="/sub-processors" class="no-underline text-inherit">
      {{ t('footer.subProcessors') }}
    </NuxtLink>
  </footer>
</template>
