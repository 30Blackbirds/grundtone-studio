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
  /* 🔴 NO SEPARATOR CHARACTER AT ALL — `gap` carries the rhythm ([designer],
     second finding on the same row at 375px).

     #290 moved the dots off the row and onto the link as a `::before`, so a
     line could no longer END on a dangling dot. That cured half of it: a
     `::before` travels WITH its link, so when the link wraps the dot wraps
     too, and the next line BEGINS with one. Measured at 375px on /login by
     re-applying the #290 rule to this exact DOM — three lines, two of which
     open on a dot, the last being the lone "· Sub-processors". Without the
     rule: two lines, both centred. The dots also cost a whole line, because
     each one adds its glyph plus a 1rem margin to a row that was already at
     the width limit.

     `gap` is the only rule that cannot strand at EITHER end, at any width,
     for any number of links — and nothing in the design record asks for the
     dot: there is no footer in any prototype (0 of the files under
     docs/design/grundtone-studio/prototypes contain one), so the separator
     was ours, not the design's.

     `nowrap` is what makes gap-only separation legible: with no glyph between
     items, a label broken across two lines would leave no way to see where
     one link ends and the next begins. It is safe at 375px — the widest
     label in either locale is "Databehandleraftale" at 129px against 327px of
     content width (375 minus the row's 2×24px padding), so a label would have
     to grow by 2.5x before it could overflow. */
  .footer > a {
    white-space: nowrap;
  }
</style>
