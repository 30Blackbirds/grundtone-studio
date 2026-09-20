<script setup lang="ts">
  import { organization } from '~~/lib/auth-client'
  import { daysUntil } from '~~/utils/invite-expiry'

  definePageMeta({ layout: 'app' })

  const { t } = useI18n()
  const route = useRoute()
  const slug = computed(() => route.params.slug as string)

  const { activeOrg, canManageOrgMembers } = useOrgContext()

  type OrgRole = 'billing' | 'member' | 'admin' | 'manager' | 'owner'
  const ROLE_OPTIONS: Array<{ value: OrgRole; label: string; description: string }> = [
    {
      value: 'billing',
      label: t('members.roles.billing'),
      description: t('members.roleDescriptions.billing'),
    },
    {
      value: 'member',
      label: t('members.roles.member'),
      description: t('members.roleDescriptions.member'),
    },
    {
      value: 'admin',
      label: t('members.roles.admin'),
      description: t('members.roleDescriptions.admin'),
    },
    {
      value: 'manager',
      label: t('members.roles.manager'),
      description: t('members.roleDescriptions.manager'),
    },
    {
      value: 'owner',
      label: t('members.roles.owner'),
      description: t('members.roleDescriptions.owner'),
    },
  ]
  // The role-edit dropdown excludes 'owner' because Better Auth's
  // updateMemberRole doesn't promote to owner — there's a separate transfer
  // flow. Inviting as owner is also blocked by default for the same reason.
  const ASSIGNABLE_ROLES = ROLE_OPTIONS.filter((r) => r.value !== 'owner')

  const { data: members } = await useAsyncData(
    () => `members-${slug.value}`,
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

  const { data: pendingInvitations, refresh: refreshInvitations } = await useAsyncData(
    () => `invitations-${slug.value}`,
    async () => {
      if (!activeOrg.value?.id) return []
      const res = await organization.listInvitations({
        query: { organizationId: activeOrg.value.id },
        fetchOptions: { headers: useRequestHeaders(['cookie']) as HeadersInit },
      })
      return (res.data ?? []).filter((i) => i.status === 'pending')
    },
    { default: () => [], watch: [activeOrg] },
  )

  const toast = useToast()
  const showInvite = ref(false)
  const inviting = ref(false)
  const inviteError = ref<string | null>(null)

  async function sendInvite(payload: { email: string; role: string }) {
    if (!activeOrg.value?.id) return
    inviting.value = true
    inviteError.value = null
    const res = await organization.inviteMember({
      email: payload.email,
      // Better Auth's client types narrow this to 'admin' | 'member' but the
      // server-side ac config accepts our custom roles too.
      role: payload.role as 'admin' | 'member',
      organizationId: activeOrg.value.id,
    })
    inviting.value = false
    if (res.error) {
      inviteError.value = res.error.message ?? t('members.inviteError')
      return
    }
    showInvite.value = false
    toast.success(t('toasts.inviteSent'))
    await refreshInvitations()
  }

  const resendingId = ref<string | null>(null)

  // Better Auth re-sends an existing pending invitation when `resend` is set
  // (same email+org) instead of erroring on the duplicate.
  async function resendInvite(inv: { id: string; email: string; role: string }) {
    if (!activeOrg.value?.id) return
    resendingId.value = inv.id
    try {
      const res = await organization.inviteMember({
        email: inv.email,
        role: inv.role as 'admin' | 'member',
        organizationId: activeOrg.value.id,
        resend: true,
      })
      if (!res.error) toast.success(t('toasts.inviteResent'))
      await refreshInvitations()
    } finally {
      resendingId.value = null
    }
  }

  async function cancelInvite(invitationId: string) {
    await organization.cancelInvitation({ invitationId })
    await refreshInvitations()
    toast.success(t('toasts.inviteCancelled'))
  }

  function roleBadgeVariant(role: string): 'info' | 'warning' | 'neutral' {
    if (role === 'owner') return 'info'
    if (role === 'manager' || role === 'admin') return 'warning'
    return 'neutral'
  }
</script>

<template>
  <section class="p-6">
    <!-- Breadcrumb lives in the app-shell (layouts/app.vue) — no page-local trail. -->
    <header class="flex justify-between items-center mb-6">
      <h1 class="m-0">{{ t('members.title') }}</h1>
      <GTButton v-if="canManageOrgMembers" @click="showInvite = true">
        {{ t('members.invite') }}
      </GTButton>
    </header>

    <InviteMemberModal
      v-model:open="showInvite"
      :title="t('members.invite')"
      :roles="ASSIGNABLE_ROLES"
      default-role="member"
      :loading="inviting"
      :error="inviteError"
      @submit="sendInvite"
    />

    <h2 class="text-lg mt-6 mb-3">{{ t('members.active') }}</h2>
    <ul class="list-reset grid gap-2">
      <li
        v-for="m in members"
        :key="m.id"
        class="card-row flex justify-between items-center p-4 bg-surface-raised border rounded-lg"
      >
        <div class="flex flex-col gap-1">
          <strong>{{ m.user?.name || m.user?.email }}</strong>
          <span class="text-tertiary text-sm">{{ m.user?.email }}</span>
        </div>
        <div class="flex items-center gap-3">
          <GTBadge :variant="roleBadgeVariant(m.role)">
            {{ t(`members.roles.${m.role}`) }}
          </GTBadge>
          <NuxtLink
            v-if="canManageOrgMembers"
            :to="`/orgs/${slug}/members/${m.id}`"
            class="text-primary text-sm"
          >
            {{ t('members.manage') }}
          </NuxtLink>
        </div>
      </li>
    </ul>

    <template v-if="pendingInvitations && pendingInvitations.length">
      <h2 class="text-lg mt-8 mb-3">{{ t('members.pending') }}</h2>
      <ul class="list-reset grid gap-2">
        <li
          v-for="inv in pendingInvitations"
          :key="inv.id"
          class="card-row flex justify-between items-center p-4 bg-surface-raised border rounded-lg"
        >
          <div class="flex flex-col gap-1">
            <strong>{{ inv.email }}</strong>
            <span class="text-tertiary text-sm">
              {{ t(`members.roles.${inv.role}`) }}
              <template v-if="inv.expiresAt">
                ·
                <span :class="{ 'text-warning': daysUntil(inv.expiresAt) < 2 }">
                  {{
                    daysUntil(inv.expiresAt) < 0
                      ? t('invite.expired')
                      : t('invite.expiresIn', { n: daysUntil(inv.expiresAt) })
                  }}
                </span>
              </template>
            </span>
          </div>
          <div v-if="canManageOrgMembers" class="flex gap-2">
            <GTButton
              variant="secondary"
              size="sm"
              :loading="resendingId === inv.id"
              @click="resendInvite(inv)"
            >
              {{ t('invite.resend') }}
            </GTButton>
            <GTButton variant="outlined" size="sm" @click="cancelInvite(inv.id)">
              {{ t('members.cancelInvite') }}
            </GTButton>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>
