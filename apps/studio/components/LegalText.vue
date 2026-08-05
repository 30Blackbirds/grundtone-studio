<script setup lang="ts">
  // Renderer **fed skrift** fra juras kildetekst uden v-html.
  //
  // Fremhaevningen er ikke pynt: jura fremhaever de led, der baerer en
  // forpligtelse ("Tjenesten udbydes udelukkende til erhvervsdrivende", "Det
  // aktive brand er den faktureerbare enhed"). Strippes den, mister teksten en
  // skelnen, forfatteren lagde ind med vilje - og v-html paa kunde-vendt
  // juridisk tekst ville give en injektionsflade, teksten ikke har brug for.
  //
  // Split paa ** giver skiftevis almindelig/fed. Ulige antal markoerer kan ikke
  // producere markup, kun en fed hale, saa en tastefejl i kilden bliver grim
  // frem for farlig.
  const props = defineProps<{ text: string }>()

  const parts = computed(() =>
    props.text.split('**').map((value, i) => ({ value, strong: i % 2 === 1 })),
  )
</script>

<template>
  <span>
    <template v-for="(part, i) in parts" :key="i">
      <strong v-if="part.strong">{{ part.value }}</strong>
      <template v-else>{{ part.value }}</template>
    </template>
  </span>
</template>
