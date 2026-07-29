<script setup lang="ts">
  import { signOut, useSession } from '~~/lib/auth-client'

  const { orgs, activeOrg, activeSlug, activeProjectSlug, projects, canManageOrgMembers } =
    useOrgContext()
  const route = useRoute()
  const session = useSession()

  const userName = computed(
    () => session.value?.data?.user?.name || session.value?.data?.user?.email || '',
  )
  const userEmail = computed(() => session.value?.data?.user?.email ?? '')
  const initials = computed(() =>
    userName.value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join(''),
  )

  const menuOpen = ref(false)
  const acctRef = ref<HTMLElement | null>(null)

  function closeOnOutside(e: MouseEvent) {
    if (acctRef.value && !acctRef.value.contains(e.target as Node)) menuOpen.value = false
  }
  function closeOnEscape(e: KeyboardEvent) {
    if (e.key === 'Escape') menuOpen.value = false
  }
  watch(menuOpen, (open) => {
    if (open) {
      document.addEventListener('click', closeOnOutside)
      document.addEventListener('keydown', closeOnEscape)
    } else {
      document.removeEventListener('click', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  })
  onUnmounted(() => {
    document.removeEventListener('click', closeOnOutside)
    document.removeEventListener('keydown', closeOnEscape)
  })

  async function handleSignOut() {
    menuOpen.value = false
    await signOut()
    await navigateTo('/login')
  }

  const isDashboardActive = computed(() => route.path === '/dashboard')
  const isMembersActive = computed(() => route.path.startsWith(`/orgs/${activeSlug.value}/members`))
  const isAuditActive = computed(() => route.path === `/orgs/${activeSlug.value}/audit`)
  const isSettingsActive = computed(() => route.path === `/orgs/${activeSlug.value}/settings`)

  const linkClass = 'block p-2 rounded text-sm no-underline text-inherit hover:bg-surface-raised'
  const activeClass = 'bg-surface-raised font-bold'
</script>

<template>
  <aside
    class="app-sidebar app-sidebar--column border-r bg-surface p-4"
    :aria-label="$t('nav.menu')"
  >
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

    <!-- User anchor pinned to the bottom (Allan-request 2026-07-29:
         account/lang/sign-out live here, not in the header). Structure
         mirrors Resonans' rail-bottom anchor ([designer] #152-review):
         name first, actions behind the chevron. -->
    <footer ref="acctRef" class="app-sidebar__user border-t pt-3">
      <button
        type="button"
        class="app-sidebar__acct flex items-center gap-2 p-2 rounded border-0 bg-transparent cursor-pointer hover:bg-surface-raised"
        :aria-expanded="menuOpen"
        aria-controls="sidebar-account-menu"
        @click="menuOpen = !menuOpen"
      >
        <span class="app-sidebar__avatar bg-surface-raised border" aria-hidden="true">
          {{ initials }}
        </span>
        <span class="app-sidebar__acct-text">
          <span class="block text-sm font-bold truncate">{{ userName }}</span>
          <span class="block text-xs text-tertiary truncate">{{ userEmail }}</span>
        </span>
        <span aria-hidden="true" class="text-tertiary text-xs">{{ menuOpen ? '▴' : '▾' }}</span>
      </button>
      <div
        v-if="menuOpen"
        id="sidebar-account-menu"
        class="app-sidebar__menu bg-surface border rounded-lg p-2 flex flex-col gap-1"
      >
        <NuxtLink to="/account" :class="linkClass" @click="menuOpen = false">
          {{ $t('account.nav') }}
        </NuxtLink>
        <div class="p-2"><LanguageSwitch /></div>
        <hr class="m-0" />
        <GTButton variant="outlined" size="sm" block @click="handleSignOut">
          {{ $t('app.signOut') }}
        </GTButton>
      </div>
    </footer>
  </aside>
</template>
