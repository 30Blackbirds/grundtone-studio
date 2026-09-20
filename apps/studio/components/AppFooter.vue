<script setup lang="ts">
  const { t } = useI18n()
</script>

<template>
  <footer class="footer flex flex-wrap gap-4 justify-center items-center p-6 text-tertiary text-sm">
    <NuxtLink to="/docs/install" class="no-underline text-inherit">
      {{ t('footer.installGuide') }}
    </NuxtLink>
    <NuxtLink to="/changelog" class="no-underline text-inherit">
      {{ t('changelog.title') }}
    </NuxtLink>
    <!-- Jura-krav studio-beta-1.0 pkt. 8: vilkårene (og dermed aftaleparten
         Asp Productions ApS) skal være ét klik væk fra prissiden — footeren
         linkede privacy/dpa/sub-processors, men ikke vilkårene. -->
    <NuxtLink to="/legal/terms" class="no-underline text-inherit">
      {{ t('footer.terms') }}
    </NuxtLink>
    <NuxtLink to="/privacy" class="no-underline text-inherit">
      {{ t('footer.privacy') }}
    </NuxtLink>
    <NuxtLink to="/dpa" class="no-underline text-inherit">
      {{ t('footer.dpa') }}
    </NuxtLink>
    <NuxtLink to="/sub-processors" class="no-underline text-inherit">
      {{ t('footer.subProcessors') }}
    </NuxtLink>
  </footer>
</template>

<style scoped>
  /* 🔴 The separator belongs to the link, not to the row.
     Found by [designer] at 375px: the dots were their own flex items, so a
     wrap could leave one dangling at the end of a line with nothing after it.
     As a ::before on every link but the first, the dot can only ever move
     together with the link it precedes — a line cannot end on one.
     The 1rem margin reproduces the previous rhythm, where `gap-4` sat on both
     sides of a standalone dot. */
  .footer > a + a::before {
    content: '·';
    margin-inline-end: 1rem;
  }
</style>
