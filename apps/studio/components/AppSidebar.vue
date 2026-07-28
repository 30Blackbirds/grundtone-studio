<script setup lang="ts">
  const { orgs, activeOrg, activeSlug, activeProjectSlug, projects, canManageOrgMembers } =
    useOrgContext()
  const route = useRoute()

  const isDashboardActive = computed(() => route.path === '/dashboard')
  const isMembersActive = computed(() => route.path.startsWith(`/orgs/${activeSlug.value}/members`))
  const isAuditActive = computed(() => route.path === `/orgs/${activeSlug.value}/audit`)
  const isSettingsActive = computed(() => route.path === `/orgs/${activeSlug.value}/settings`)

  const linkClass = 'block p-2 rounded text-sm no-underline text-inherit hover:bg-surface-raised'
  const activeClass = 'bg-surface-raised font-bold'
</script>

<template>
  <aside class="app-sidebar border-r bg-surface p-4" :aria-label="$t('nav.menu')">
    <!-- Global section: the shell is identical on every signed-in screen
         (UX-audit finding #4) — the sidebar no longer disappears outside
         org context. -->
    <nav :aria-label="$t('nav.global')" class="mb-6">
      <ul class="list-reset flex flex-col gap-1">
        <li>
          <NuxtLink to="/dashboard" :class="[linkClass, { [activeClass]: isDashboardActive }]">
            {{ $t('nav.dashboard') }}
          </NuxtLink>
        </li>
        <li>
          <NuxtLink to="/components" :class="linkClass">
            {{ $t('componentLibrary.nav') }}
          </NuxtLink>
        </li>
      </ul>
    </nav>

    <!-- Org context: projects + org administration -->
    <template v-if="activeSlug">
      <header class="mb-2">
        <p class="text-xs uppercase text-tertiary tracking-wide m-0">
          {{ activeOrg?.name ?? activeSlug }}
        </p>
      </header>

      <nav v-if="projects && projects.length" :aria-label="$t('projects.title')" class="mb-4">
        <h2 class="text-sm m-0 mb-1">{{ $t('projects.title') }}</h2>
        <ul class="list-reset flex flex-col gap-1">
          <li v-for="p in projects" :key="p.id">
            <NuxtLink
              :to="`/orgs/${activeSlug}/projects/${p.slug}`"
              :class="[linkClass, { [activeClass]: activeProjectSlug === p.slug }]"
            >
              {{ p.name }}
            </NuxtLink>
          </li>
        </ul>
      </nav>
      <p v-else class="text-tertiary text-sm mb-4">{{ $t('projects.empty') }}</p>

      <hr class="my-4" />
      <nav :aria-label="$t('nav.orgAdmin')">
        <ul class="list-reset flex flex-col gap-1">
          <li>
            <NuxtLink
              :to="`/orgs/${activeSlug}/members`"
              :class="[linkClass, { [activeClass]: isMembersActive }]"
            >
              {{ $t('members.title') }}
            </NuxtLink>
          </li>
          <li v-if="canManageOrgMembers">
            <NuxtLink
              :to="`/orgs/${activeSlug}/settings`"
              :class="[linkClass, { [activeClass]: isSettingsActive }]"
            >
              {{ $t('orgSettings.title') }}
            </NuxtLink>
          </li>
          <li v-if="canManageOrgMembers">
            <NuxtLink
              :to="`/orgs/${activeSlug}/audit`"
              :class="[linkClass, { [activeClass]: isAuditActive }]"
            >
              {{ $t('audit.title') }}
            </NuxtLink>
          </li>
        </ul>
      </nav>
    </template>

    <!-- Outside org context: the user's organizations -->
    <nav v-else-if="orgs && orgs.length" :aria-label="$t('orgs.title')">
      <h2 class="text-sm m-0 mb-1">{{ $t('orgs.title') }}</h2>
      <ul class="list-reset flex flex-col gap-1">
        <li v-for="o in orgs" :key="o.id">
          <NuxtLink :to="`/orgs/${o.slug}`" :class="linkClass">
            {{ o.name }}
          </NuxtLink>
        </li>
      </ul>
    </nav>
  </aside>
</template>
