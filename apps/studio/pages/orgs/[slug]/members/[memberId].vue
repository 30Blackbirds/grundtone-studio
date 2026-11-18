<script setup lang="ts">
  import { organization } from '~~/lib/auth-client'
  import { orgWrites } from '~~/lib/org-writes'
  import {
    ASSIGNABLE_ORG_ROLES,
    canAssignRole,
    canManageMember,
    isOrgRole,
    type AssignableOrgRole,
    type OrgRole,
  } from '~~/composables/useOrgRoles'

  definePageMeta({ layout: 'app' })

  const { t, d } = useI18n()
  const route = useRoute()
  const router = useRouter()
  const slug = computed(() => route.params.slug as string)
  const memberId = computed(() => route.params.memberId as string)

  const { activeOrg, role: actorRole, refreshActiveMember } = useOrgContext()
  const authMode = useAuthMode()
  // oidc mode only: ownership lives in Studio, and an owner may hand it over.
  const canTransfer = computed(
    () =>
      authMode.value === 'oidc' &&
      actorRole.value === 'owner' &&
      !!currentRole.value &&
      currentRole.value !== 'owner',
  )

  const { data: members, refresh } = await useAsyncData(
    () => `member-detail-${memberId.value}`,
    async () => {
      if (!activeOrg.value?.id) return []
      const res = await organization.listMembers({
        query: { organizationId: activeOrg.value.id },
        fetchOptions: { headers: useRequestHeaders(['cookie']) as HeadersInit },
      })
      return res.data?.members ?? []
    },
    { default: () => [], watch: [activeOrg] },
  )

  const member = computed(() => members.value?.find((m) => m.id === memberId.value) ?? null)
  const currentRole = computed<OrgRole | null>(() =>
    isOrgRole(member.value?.role as string | undefined) ? (member.value?.role as OrgRole) : null,
  )

  interface ProjectRow {
    projectId: string
    projectName: string
    projectSlug: string
    role: string
  }

  const { data: projects } = await useAsyncData<ProjectRow[]>(
    () => `member-projects-${activeOrg.value?.id ?? 'none'}-${member.value?.userId ?? 'none'}`,
    async () => {
      if (!activeOrg.value?.id || !member.value?.userId) return []
      const fetcher = $fetch as (url: string, opts?: unknown) => Promise<ProjectRow[]>
      return await fetcher(
        `/api/orgs/${activeOrg.value.id}/members/${member.value.userId}/projects`,
        { headers: useRequestHeaders(['cookie']) },
      )
    },
    { default: () => [], watch: [member] },
  )

  // The picker only offers assignable roles (everything except owner). If the
  // member is already owner, we leave the selection empty so the dirty check
  // prevents a no-op save and the picker just acts as a read-only display.
  const selectedRole = ref<AssignableOrgRole | null>(null)
  watchEffect(() => {
    selectedRole.value =
      currentRole.value && currentRole.value !== 'owner' ? currentRole.value : null
  })

  const saving = ref(false)
  const saveError = ref<string | null>(null)
  const dirty = computed(
    () => selectedRole.value !== null && selectedRole.value !== currentRole.value,
  )

  const canManage = computed(() => {
    if (!actorRole.value || !currentRole.value) return false
    return canManageMember(actorRole.value, currentRole.value)
  })

  function roleAssignable(role: AssignableOrgRole): boolean {
    if (!actorRole.value) return false
    return canAssignRole(actorRole.value, role)
  }

  // Owner is excluded — Better Auth's updateMemberRole can't promote to owner,
  // it's a separate transfer flow. The picker reflects what the server can
  // actually accept.
  const ROLE_DEFS: Array<{ id: AssignableOrgRole; label: string; description: string }> =
    ASSIGNABLE_ORG_ROLES.map((r) => ({
      id: r,
      label: t(`members.roles.${r}`),
      description: t(`members.roleDescriptions.${r}`),
    }))

  // Sentry shows: "This user's organization role as an X has granted them a
  // minimum team-level role of Y." For us, owner+manager get project:admin on
  // every project automatically; member+admin get project:viewer; billing gets
  // nothing.
  const inheritedProjectRole = computed<'admin' | 'viewer' | null>(() => {
    if (currentRole.value === 'owner' || currentRole.value === 'manager') return 'admin'
    if (currentRole.value === 'admin' || currentRole.value === 'member') return 'viewer'
    return null
  })

  async function save() {
    if (!activeOrg.value?.id || !selectedRole.value || !dirty.value) return
    saving.value = true
    saveError.value = null
    // Through studio's route, which records the role in studio as well; it
    // applies the same rank rules as this page and auth checks the role too.
    const res = await orgWrites.updateMemberRole(
      activeOrg.value.id,
      memberId.value,
      selectedRole.value,
    )
    saving.value = false
    if (res.error) {
      saveError.value = res.error.message ?? t('memberDetail.saveError')
      return
    }
    await refresh()
  }

  const toast = useToast()
  const transferOpen = ref(false)
  const transferring = ref(false)
  const transferError = ref<string | null>(null)

  async function confirmTransfer() {
    if (!activeOrg.value?.id || !member.value?.userId) return
    transferring.value = true
    transferError.value = null
    try {
      const res = await orgWrites.transferOwnership(activeOrg.value.id, member.value.userId)
      if (res.error) {
        transferError.value = res.error.message ?? t('memberDetail.transferError')
        return
      }
      transferOpen.value = false
      toast.success(t('toasts.ownershipTransferred'))
      await Promise.all([refresh(), refreshActiveMember()])
    } finally {
      transferring.value = false
    }
  }

  const removeOpen = ref(false)
  const removingMember = ref(false)

  async function confirmRemove() {
    if (!activeOrg.value?.id) return
    removingMember.value = true
    try {
      const res = await orgWrites.removeMember(activeOrg.value.id, memberId.value)
      if (!res.error) {
        removeOpen.value = false
        toast.success(t('toasts.memberRemoved'))
        await router.push(`/orgs/${slug.value}/members`)
      }
    } finally {
      removingMember.value = false
    }
  }
</script>

<template>
  <section class="p-6 max-w-4xl mx-auto flex flex-col gap-4">
    <!-- Breadcrumb lives in the app-shell (layouts/app.vue) — no page-local trail. -->
    <h1 class="m-0 mb-4 font-heading">
      {{ member?.user?.name || member?.user?.email || t('memberDetail.loading') }}
    </h1>

    <template v-if="member">
      <!-- BASICS -->
      <section class="border rounded-lg overflow-hidden bg-surface-raised">
        <header
          class="px-4 py-3 bg-surface border-b text-tertiary text-xs uppercase tracking-wider font-medium"
        >
          {{ t('memberDetail.basics') }}
        </header>
        <div class="grid grid-cols-3 gap-6 p-4">
          <div>
            <p class="text-tertiary text-sm m-0 mb-1 font-medium">{{ t('auth.email') }}</p>
            <p class="m-0 text-primary">{{ member.user?.email }}</p>
          </div>
          <div>
            <p class="text-tertiary text-sm m-0 mb-1 font-medium">{{ t('memberDetail.status') }}</p>
            <p class="m-0">{{ t('memberDetail.statusActive') }}</p>
          </div>
          <div>
            <p class="text-tertiary text-sm m-0 mb-1 font-medium">{{ t('memberDetail.added') }}</p>
            <p class="m-0">
              {{
                member.createdAt ? d(new Date(member.createdAt as unknown as string), 'short') : '—'
              }}
            </p>
          </div>
        </div>
      </section>

      <!-- ORGANIZATION ROLE -->
      <section class="border rounded-lg overflow-hidden bg-surface-raised">
        <header
          class="px-4 py-3 bg-surface border-b text-tertiary text-xs uppercase tracking-wider font-medium"
        >
          {{ t('memberDetail.organizationRole') }}
        </header>
        <ul class="list-reset m-0">
          <li v-for="def in ROLE_DEFS" :key="def.id" class="border-b last:border-b-0">
            <label
              :class="[
                'flex gap-4 p-5 cursor-pointer transition-colors',
                {
                  'bg-surface': selectedRole === def.id,
                  'opacity-50 cursor-not-allowed':
                    !canManage || (!roleAssignable(def.id) && def.id !== currentRole),
                },
              ]"
              :for="`role-${def.id}`"
            >
              <input
                :id="`role-${def.id}`"
                v-model="selectedRole"
                type="radio"
                :value="def.id"
                :disabled="!canManage || (!roleAssignable(def.id) && def.id !== currentRole)"
                class="mt-1 shrink-0"
              />
              <div class="flex flex-col gap-1">
                <strong class="text-base">{{ def.label }}</strong>
                <span class="text-tertiary text-sm leading-relaxed">{{ def.description }}</span>
              </div>
            </label>
          </li>
        </ul>
      </section>

      <!-- PROJECTS (Sentry calls this section TEAM; we have projects instead) -->
      <section class="border rounded-lg overflow-hidden bg-surface-raised">
        <header
          class="px-4 py-3 bg-surface border-b text-tertiary text-xs uppercase tracking-wider font-medium grid grid-cols-[1fr_auto_auto] gap-4 items-center"
        >
          <span>{{ t('memberDetail.projectsHeading') }}</span>
          <span>{{ t('memberDetail.projectRole') }}</span>
          <NuxtLink
            :to="`/orgs/${slug}/projects`"
            class="text-primary no-underline normal-case tracking-normal font-normal text-sm"
          >
            {{ t('memberDetail.addToProject') }}
          </NuxtLink>
        </header>

        <div
          v-if="inheritedProjectRole"
          class="flex items-center gap-3 px-4 py-3 bg-info-subtle border-l-4 border-l-info text-sm"
        >
          <GTIcon name="info-circle" size="sm" />
          <span>
            {{
              t('memberDetail.inheritedNotice', {
                role: t(`members.roles.${currentRole}`),
                projectRole: t(`projectMembers.roles.${inheritedProjectRole}`),
              })
            }}
          </span>
        </div>

        <ul v-if="projects?.length" class="list-reset m-0">
          <li
            v-for="p in projects"
            :key="p.projectId"
            class="grid grid-cols-[1fr_auto_auto] gap-4 items-center px-4 py-3 border-t"
          >
            <NuxtLink :to="`/orgs/${slug}/projects/${p.projectSlug}`" class="text-primary">
              #{{ p.projectSlug }}
            </NuxtLink>
            <span class="text-sm">{{ t(`projectMembers.roles.${p.role}`) }}</span>
            <span class="text-tertiary text-sm">{{ t('memberDetail.direct') }}</span>
          </li>
        </ul>
        <p
          v-else-if="!inheritedProjectRole"
          class="px-4 py-6 text-tertiary text-sm text-center m-0"
        >
          {{ t('memberDetail.noProjects') }}
        </p>
      </section>

      <!-- Footer: save + remove -->
      <footer class="flex justify-between items-center gap-4 pt-4">
        <GTButton
          v-if="canManage && currentRole !== 'owner'"
          variant="negative"
          @click="removeOpen = true"
        >
          {{ t('memberDetail.removeAction') }}
        </GTButton>
        <span v-else />
        <div class="flex items-center gap-3">
          <GTButton v-if="canTransfer" variant="outlined" @click="transferOpen = true">
            {{ t('memberDetail.transferAction') }}
          </GTButton>
          <span v-if="!canManage" class="text-tertiary text-sm">
            {{ t('memberDetail.cannotManageHierarchy') }}
          </span>
          <GTButton
            :disabled="!canManage || !dirty || !selectedRole"
            :loading="saving"
            @click="save"
          >
            {{ t('memberDetail.save') }}
          </GTButton>
        </div>
      </footer>
      <GTAlert v-if="saveError" variant="error" :heading="saveError" />
      <GTAlert v-if="transferError" variant="error" :heading="transferError" />

      <ConfirmDialog
        v-model:open="transferOpen"
        :title="t('memberDetail.transferAction')"
        :message="t('memberDetail.confirmTransfer')"
        :confirm-label="t('memberDetail.transferAction')"
        :loading="transferring"
        @confirm="confirmTransfer"
      />

      <ConfirmDialog
        v-model:open="removeOpen"
        :title="t('memberDetail.removeAction')"
        :message="t('memberDetail.confirmRemove')"
        :confirm-label="t('memberDetail.removeAction')"
        destructive
        :loading="removingMember"
        @confirm="confirmRemove"
      />
    </template>
  </section>
</template>
