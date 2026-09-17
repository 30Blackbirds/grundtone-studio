<script setup lang="ts">
  const { t } = useI18n()
  const route = useRoute()
  const { activeOrg, activeSlug, activeProjectSlug, projects } = useOrgContext()

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

  // ── Breadcrumb: org › (Projekter › project | section), as in the redesign
  // prototypes. Driven by the same org context the sidebar uses, so labels
  // are real names, not slugs.
  const breadcrumbItems = computed(() =>
    buildBreadcrumb({
      path: route.path,
      orgSlug: activeSlug.value,
      orgName: activeOrg.value?.name,
      projectSlug: activeProjectSlug.value,
      projectName: projects.value?.find((p) => p.slug === activeProjectSlug.value)?.name,
      t,
    }),
  )
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
        <NuxtLink to="/dashboard" class="brand-link flex items-center gap-2">
          <!-- Officielt grundtone-mærke, SELV-HOSTET (vendoret fra
               @grundtone/core assets, grundtone#140) — jura-consent-notatet:
               ingen tredjeparts-CDN-loads i appen (IP-deling ved sidevisning);
               vendoring erstatter jsDelivr-pinningen fra forlæggets §5.
               🔴 Vendoring FRYSER filen: indtil 2026-08-19 var dette den blå
               placeholder fra core@2.22.0, byte-identisk (sha 2b7c23b2) —
               ingen core-release retter den af sig selv. Kilde-PR + sha pr.
               fil + ét-kalds-kontrol: public/brand/VENDORED.md. -->
          <img src="/brand/logo-32x32.png" width="22" height="22" alt="" class="brand-logo" />
          {{ t('app.name') }}
        </NuxtLink>
        <OrgSwitcher class="app-shell__org-switcher" />
      </div>
      <!-- Account/lang/sign-out moved to the sidebar's user anchor
           (Allan-request 2026-07-29, matches the prototype's su__user). -->
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
          <span class="brand-link flex items-center gap-2">
            <img src="/brand/logo-32x32.png" width="22" height="22" alt="" class="brand-logo" />
            {{ t('app.name') }}
          </span>
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
