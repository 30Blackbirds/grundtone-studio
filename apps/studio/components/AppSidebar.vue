<script setup lang="ts">
  const { activeOrg, activeSlug, activeProjectSlug, projects, canManageOrgMembers } =
    useOrgContext()
  const route = useRoute()

  const isMembersActive = computed(() => route.path.startsWith(`/orgs/${activeSlug.value}/members`))
  const isAuditActive = computed(() => route.path === `/orgs/${activeSlug.value}/audit`)
  const isSettingsActive = computed(() => route.path === `/orgs/${activeSlug.value}/settings`)
</script>

<template>
  <aside v-if="activeSlug" class="app-sidebar border-r bg-surface p-4">
    <header class="mb-4">
      <p class="text-xs uppercase text-tertiary tracking-wide m-0">
        {{ activeOrg?.name ?? activeSlug }}
      </p>
      <h2 class="text-sm m-0">{{ $t('projects.title') }}</h2>
    </header>

    <nav v-if="projects && projects.length" class="mb-6">
      <ul class="list-reset flex flex-col gap-1">
        <li v-for="p in projects" :key="p.id">
          <NuxtLink
            :to="`/orgs/${activeSlug}/projects/${p.slug}`"
            class="block p-2 rounded text-sm no-underline text-inherit hover:bg-surface-raised"
            :class="{ 'bg-surface-raised font-bold': activeProjectSlug === p.slug }"
          >
            {{ p.name }}
          </NuxtLink>
        </li>
      </ul>
    </nav>
    <p v-else class="text-tertiary text-sm mb-6">{{ $t('projects.empty') }}</p>

    <hr class="my-4" />
    <nav>
      <ul class="list-reset flex flex-col gap-1">
        <li>
          <NuxtLink
            :to="`/orgs/${activeSlug}/members`"
            class="block p-2 rounded text-sm no-underline text-inherit hover:bg-surface-raised"
            :class="{ 'bg-surface-raised font-bold': isMembersActive }"
          >
            {{ $t('members.title') }}
          </NuxtLink>
        </li>
        <li v-if="canManageOrgMembers">
          <NuxtLink
            :to="`/orgs/${activeSlug}/settings`"
            class="block p-2 rounded text-sm no-underline text-inherit hover:bg-surface-raised"
            :class="{ 'bg-surface-raised font-bold': isSettingsActive }"
          >
            {{ $t('orgSettings.title') }}
          </NuxtLink>
        </li>
        <li v-if="canManageOrgMembers">
          <NuxtLink
            :to="`/orgs/${activeSlug}/audit`"
            class="block p-2 rounded text-sm no-underline text-inherit hover:bg-surface-raised"
            :class="{ 'bg-surface-raised font-bold': isAuditActive }"
          >
            {{ $t('audit.title') }}
          </NuxtLink>
        </li>
        <li>
          <NuxtLink
            to="/components"
            class="block p-2 rounded text-sm no-underline text-inherit hover:bg-surface-raised"
          >
            {{ $t('componentLibrary.nav') }}
          </NuxtLink>
        </li>
      </ul>
    </nav>
  </aside>
</template>
