<script setup lang="ts">
  import { organization } from '~~/lib/auth-client'
  import { daysUntil } from '~~/utils/invite-expiry'
  import { dayOnly } from '~~/utils/relative-time'

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

  // 🔴 EVERY ROLE PILL IS NEUTRAL GREY, and that is a measurement, not taste.
  // [designer] computed the old coloured variants against their own 14% tint
  // on the rendered page: Admin 1.51:1, Owner 1.76:1, Member 4.15:1 — all three
  // under 4.5:1 for small text, two of them far under. The R5 prototype uses
  // neutral grey pills (`background: var(--surface-alt); color: var(--t2)`), so
  // the redesign follows it and the colour is not carried over.
  // The library-side fix for tinted badges is KH-1121 ([quality]); this page
  // does not wait for it, because grey is what the prototype specifies anyway.
  const { locale } = useI18n()
  const dateOf = (value: unknown): string =>
    value ? dayOnly(new Date(value as string), locale.value) : '—'

  const activeCount = computed(() => members.value?.length ?? 0)
  const pendingCount = computed(() => pendingInvitations.value?.length ?? 0)

  // Rows for GTTable. The component takes plain records and renders a
  // `cell-<key>` slot per column, so the objects carry only what the cells read.
  const memberRows = computed(() =>
    (members.value ?? []).map((m) => ({
      id: m.id,
      name: m.user?.name || m.user?.email || '',
      email: m.user?.email ?? '',
      role: m.role,
      added: dateOf((m as { createdAt?: unknown }).createdAt),
    })),
  )

  const inviteRows = computed(() =>
    (pendingInvitations.value ?? []).map((inv) => ({
      id: inv.id,
      email: inv.email,
      role: inv.role,
      invited: dateOf((inv as { createdAt?: unknown }).createdAt),
      expiresAt: inv.expiresAt,
    })),
  )

  function initials(name: string): string {
    // Two letters at most, from the first two whitespace-separated parts. An
    // email falls back to its first character — `[...str]` rather than `str[0]`
    // so a non-BMP first character is not cut in half.
    const parts = name.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) return '?'
    if (parts.length === 1) return [...parts[0]!][0]!.toUpperCase()
    return ([...parts[0]!][0]! + [...parts[parts.length - 1]!][0]!).toUpperCase()
  }

  const cancelTarget = ref<{ id: string; email: string } | null>(null)
  const cancelling = ref(false)

  async function confirmCancel() {
    if (!cancelTarget.value) return
    cancelling.value = true
    try {
      await cancelInvite(cancelTarget.value.id)
      cancelTarget.value = null
    } finally {
      cancelling.value = false
    }
  }
</script>

<template>
  <section class="p-6">
    <!-- Breadcrumb lives in the app-shell (layouts/app.vue) — no page-local trail. -->
    <header class="flex justify-between items-center mb-1">
      <h1 class="m-0">{{ t('members.title') }}</h1>
      <GTButton v-if="canManageOrgMembers" @click="showInvite = true">
        {{ t('members.invite') }}
      </GTButton>
    </header>
    <p class="text-tertiary text-sm mt-0 mb-6">
      {{ activeOrg?.name }} · {{ t('members.subtitleActive', { n: activeCount }) }} ·
      {{ t('members.subtitlePending', { n: pendingCount }) }}
    </p>

    <InviteMemberModal
      v-model:open="showInvite"
      :title="t('members.invite')"
      :roles="ASSIGNABLE_ROLES"
      default-role="member"
      :loading="inviting"
      :error="inviteError"
      @submit="sendInvite"
    />

    <ConfirmDialog
      :open="cancelTarget !== null"
      :title="t('members.confirmCancelTitle')"
      :message="t('members.confirmCancelMessage', { email: cancelTarget?.email ?? '' })"
      :confirm-label="t('members.cancelInvite')"
      destructive
      :loading="cancelling"
      @confirm="confirmCancel"
      @cancel="cancelTarget = null"
      @update:open="
        (v: boolean) => {
          if (!v) cancelTarget = null
        }
      "
    />

    <h2 class="members-section-heading">{{ t('members.active') }}</h2>

    <!-- 🔴 TABLE ABOVE 920px, CARDS BELOW — two renderings, swapped by CSS.
         GTTable has a `responsive` mode of its own, but it stacks at
         `width <= 40rem` (640px, measured in @grundtone/vue 3.2.1's index.css).
         [designer] decided 920px for this screen (KH-1022, "tables on desktop,
         cards below 920px — measured breakpoint in R1/R5/R6"), so the library's
         mode would leave a table standing across 640–920px, against a named
         decision. Rather than restate the library's stacking rules in studio
         CSS — which would drift the moment the library changes them — the page
         renders both and `display: none` hides one. `display: none` removes a
         subtree from the accessibility tree too, so only one is ever announced. -->
    <div class="members-wide">
      <GTTable
        :caption="t('members.active')"
        :columns="[
          { key: 'name', label: t('members.colMember') },
          { key: 'role', label: t('members.colRole') },
          { key: 'status', label: t('members.colStatus') },
          { key: 'added', label: t('members.colAdded') },
          { key: 'actions', label: '' },
        ]"
        :rows="memberRows"
        :responsive="false"
      >
        <template #cell-name="{ row }">
          <span class="member-cell">
            <span class="member-avatar" aria-hidden="true">{{ initials(String(row.name)) }}</span>
            <span class="member-cell__text">
              <strong>{{ row.name }}</strong>
              <span class="text-tertiary text-sm">{{ row.email }}</span>
            </span>
          </span>
        </template>
        <template #cell-role="{ row }">
          <GTBadge variant="neutral">{{ t(`members.roles.${row.role}`) }}</GTBadge>
        </template>
        <template #cell-status>
          <span class="member-status">
            <span class="member-status__dot" aria-hidden="true" />
            {{ t('members.statusActive') }}
          </span>
        </template>
        <template #cell-actions="{ row }">
          <GTOverflowMenu
            v-if="canManageOrgMembers"
            align="right"
            :aria-label="t('members.rowActions', { name: row.name })"
            :items="[{ label: t('members.manage'), href: `/orgs/${slug}/members/${row.id}` }]"
          />
        </template>
      </GTTable>
    </div>

    <ul class="members-narrow list-reset">
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
          <GTBadge variant="neutral">{{ t(`members.roles.${m.role}`) }}</GTBadge>
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
      <h2 class="members-section-heading mt-8">{{ t('members.pending') }}</h2>

      <div class="members-wide">
        <GTTable
          :caption="t('members.pending')"
          :columns="[
            { key: 'email', label: t('members.colEmail') },
            { key: 'role', label: t('members.colRole') },
            { key: 'invited', label: t('members.colInvited') },
            { key: 'expires', label: t('members.colExpires') },
            { key: 'actions', label: '' },
          ]"
          :rows="inviteRows"
          :responsive="false"
        >
          <template #cell-role="{ row }">
            <GTBadge variant="neutral">{{ t(`members.roles.${row.role}`) }}</GTBadge>
          </template>
          <template #cell-expires="{ row }">
            <span :class="{ 'text-warning': daysUntil(row.expiresAt as string) < 2 }">
              {{
                daysUntil(row.expiresAt as string) < 0
                  ? t('invite.expired')
                  : t('invite.expiresIn', { n: daysUntil(row.expiresAt as string) })
              }}
            </span>
          </template>
          <template #cell-actions="{ row }">
            <span v-if="canManageOrgMembers" class="flex gap-2 justify-end">
              <GTButton
                variant="secondary"
                size="sm"
                :loading="resendingId === row.id"
                @click="
                  resendInvite({
                    id: String(row.id),
                    email: String(row.email),
                    role: String(row.role),
                  })
                "
              >
                {{ t('invite.resend') }}
              </GTButton>
              <GTButton
                variant="outlined"
                size="sm"
                @click="cancelTarget = { id: String(row.id), email: String(row.email) }"
              >
                {{ t('members.cancelInvite') }}
              </GTButton>
            </span>
          </template>
        </GTTable>
      </div>

      <ul class="members-narrow list-reset">
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
            <GTButton
              variant="outlined"
              size="sm"
              @click="cancelTarget = { id: inv.id, email: inv.email }"
            >
              {{ t('members.cancelInvite') }}
            </GTButton>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>
