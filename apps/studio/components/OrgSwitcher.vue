<script setup lang="ts">
  const { orgs, activeOrg } = useOrgContext()
</script>

<template>
  <!-- Single affordance (UX-audit finding #7): the dropdown IS the switcher.
       The old "← Orgs" back-link duplicated the sidebar's Dashboard entry. -->
  <GTSelect
    v-if="orgs && orgs.length"
    :model-value="activeOrg?.slug ?? ''"
    :options="orgs.map((o) => ({ value: o.slug, label: o.name }))"
    :placeholder="$t('orgs.title')"
    :aria-label="$t('orgs.switch')"
    size="sm"
    @update:model-value="(slug) => navigateTo(`/orgs/${slug}`)"
  />
</template>
