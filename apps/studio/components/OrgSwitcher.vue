<script setup lang="ts">
  const { orgs, activeOrg } = useOrgContext()
</script>

<template>
  <div class="flex items-center gap-2">
    <NuxtLink
      v-if="activeOrg"
      to="/dashboard"
      class="text-tertiary text-sm no-underline"
      :aria-label="$t('orgs.title')"
    >
      ← {{ $t('orgs.title') }}
    </NuxtLink>
    <GTSelect
      v-if="orgs && orgs.length"
      :model-value="activeOrg?.slug ?? ''"
      :options="orgs.map((o) => ({ value: o.slug, label: o.name }))"
      :placeholder="$t('orgs.title')"
      size="sm"
      @update:model-value="(slug) => navigateTo(`/orgs/${slug}`)"
    />
  </div>
</template>
