<script setup lang="ts">
  import { signOut, useSession } from '~~/lib/auth-client'

  const session = useSession()
  const { t } = useI18n()
  const route = useRoute()
  const { activeOrg, activeSlug, activeProjectSlug, projects } = useOrgContext()

  async function handleSignOut() {
    await signOut()
    await navigateTo('/login')
  }

  // ── Mobile drawer (interim until GTAppShell/GTDrawer ship on the `next`
  // channel — same interaction contract: scrim + Escape close, focus moves
  // into the panel on open and back to the trigger on close, route change
  // closes). The desktop sidebar and the drawer render the same <AppSidebar>.
  const drawerOpen = ref(false)
  const drawerPanel = ref<HTMLElement | null>(null)
  const burgerButton = ref<HTMLElement | null>(null)

  function openDrawer() {
    drawerOpen.value = true
    nextTick(() => drawerPanel.value?.focus())
  }
  function closeDrawer() {
    if (!drawerOpen.value) return
    drawerOpen.value = false
    burgerButton.value?.focus()
  }
  watch(() => route.fullPath, closeDrawer)

  function onDrawerKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') closeDrawer()
  }

  // ── Breadcrumb: Dashboard → org → (project | section). Driven by the same
  // org context the sidebar uses, so labels are real names, not slugs.
  const SECTION_LABELS: Record<string, string> = {
    members: 'members.title',
    audit: 'audit.title',
    settings: 'orgSettings.title',
  }
  const breadcrumbItems = computed(() => {
    if (!activeSlug.value) return []
    const items: { label: string; to?: string }[] = [
      { label: t('nav.dashboard'), to: '/dashboard' },
      { label: activeOrg.value?.name ?? activeSlug.value, to: `/orgs/${activeSlug.value}` },
    ]
    if (activeProjectSlug.value) {
      const project = projects.value?.find((p) => p.slug === activeProjectSlug.value)
      items.push({ label: project?.name ?? activeProjectSlug.value })
    } else {
      const section = String(route.path.split('/')[3] ?? '')
      if (SECTION_LABELS[section]) items.push({ label: t(SECTION_LABELS[section]) })
    }
    return items
  })
</script>

<template>
  <div class="app-shell">
    <GTSkipLink href="#main">{{ t('skip.toContent') }}</GTSkipLink>

    <header class="app-shell__header border-b bg-surface-raised">
      <div class="flex items-center gap-4">
        <button
          ref="burgerButton"
          type="button"
          class="app-shell__burger"
          :aria-label="t('nav.openMenu')"
          :aria-expanded="drawerOpen"
          @click="openDrawer"
        >
          <GTIcon name="menu" />
        </button>
        <NuxtLink to="/dashboard" class="brand-link">{{ t('app.name') }}</NuxtLink>
        <OrgSwitcher class="app-shell__org-switcher" />
      </div>
      <div class="flex items-center gap-4">
        <NuxtLink to="/account" class="text-tertiary text-sm no-underline">
          {{ t('account.nav') }}
        </NuxtLink>
        <LanguageSwitch />
        <span v-if="session.data?.user" class="app-shell__email text-tertiary text-sm">
          {{ session.data.user.email }}
        </span>
        <GTButton variant="outlined" size="sm" @click="handleSignOut">
          {{ t('app.signOut') }}
        </GTButton>
      </div>
    </header>

    <div v-if="breadcrumbItems.length" class="app-shell__breadcrumb border-b">
      <GTBreadcrumb :items="breadcrumbItems" :aria-label="t('nav.breadcrumb')" />
    </div>

    <div class="app-shell__body">
      <div class="app-shell__sidebar">
        <AppSidebar />
      </div>
      <main id="main" class="app-shell__main">
        <slot />
      </main>
    </div>

    <AppFooter />

    <!-- Mobile drawer: same nav as the desktop sidebar -->
    <div v-if="drawerOpen" class="app-drawer" @keydown="onDrawerKeydown">
      <div class="app-drawer__scrim" aria-hidden="true" @click="closeDrawer" />
      <div
        ref="drawerPanel"
        class="app-drawer__panel bg-surface"
        role="dialog"
        aria-modal="true"
        :aria-label="t('nav.menu')"
        tabindex="-1"
      >
        <div class="flex justify-between items-center p-4 border-b">
          <span class="brand-link">{{ t('app.name') }}</span>
          <button
            type="button"
            class="app-shell__burger"
            :aria-label="t('nav.closeMenu')"
            @click="closeDrawer"
          >
            <GTIcon name="close" />
          </button>
        </div>
        <AppSidebar />
      </div>
    </div>

    <GTToastContainer />
  </div>
</template>
