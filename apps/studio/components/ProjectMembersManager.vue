<script setup lang="ts">
  import { daysUntil } from '~~/utils/invite-expiry'
  import type { ProjectRole } from '~~/composables/useProjectRole'

  const props = defineProps<{ projectId: string; canManage: boolean }>()
  const { t } = useI18n()

  interface OrgMember {
    id: string
    userId: string
    role: string
    name: string | null
    // Email/name come from the central auth org payload and may be absent if
    // the org API doesn't embed the user object; the UI falls back accordingly.
    email: string | null
  }
  interface DirectMember {
    id: string
    userId: string
    role: ProjectRole
    name: string | null
    email: string | null
    createdAt: string
  }
  interface PendingInvitation {
    id: string
    email: string
    role: ProjectRole
    status: string
    expiresAt: string
    createdAt: string
  }
  interface MembersResponse {
    orgMembers: OrgMember[]
    direct: DirectMember[]
    pending: PendingInvitation[]
  }

  const { data, refresh } = await useAsyncData<MembersResponse>(
    () => `project-members-${props.projectId}`,
    () =>
      $fetch<MembersResponse>(`/api/projects/${props.projectId}/members`, {
        headers: useRequestHeaders(['cookie']),
      }),
    { default: () => ({ orgMembers: [], direct: [], pending: [] }) },
  )

  const showInvite = ref(false)
  const inviting = ref(false)
  const inviteError = ref<string | null>(null)

  const INVITE_ROLES = computed(() =>
    (['viewer', 'editor', 'admin'] as const).map((r) => ({
      value: r,
      label: t(`projectMembers.roles.${r}`),
      description: t(`projectMembers.roleDescriptions.${r}`),
    })),
  )

  async function sendInvite(payload: { email: string; role: string }) {
    inviting.value = true
    inviteError.value = null
    try {
      await $fetch(`/api/projects/${props.projectId}/members`, {
        method: 'POST',
        body: { email: payload.email, role: payload.role },
      })
      showInvite.value = false
      await refresh()
      toast.success(t('toasts.inviteSent'))
    } catch (err) {
      inviteError.value = (err as Error).message
    } finally {
      inviting.value = false
    }
  }

  const resendingId = ref<string | null>(null)

  // The invite endpoint is idempotent: re-POSTing a pending invitee's
  // email+role refreshes the expiry and re-sends the mail — that IS resend.
  async function resendInvite(inv: { id: string; email: string; role: ProjectRole }) {
    resendingId.value = inv.id
    try {
      await $fetch(`/api/projects/${props.projectId}/members`, {
        method: 'POST',
        body: { email: inv.email, role: inv.role },
      })
      await refresh()
      toast.success(t('toasts.inviteResent'))
    } finally {
      resendingId.value = null
    }
  }

  async function cancelInvite(invitationId: string) {
    await $fetch(`/api/projects/${props.projectId}/invitations/${invitationId}`, {
      method: 'DELETE',
    })
    await refresh()
    toast.success(t('toasts.inviteCancelled'))
  }

  const toast = useToast()
  const pendingRemoveId = ref<string | null>(null)
  const removing = ref(false)

  async function confirmRemoveMember() {
    if (!pendingRemoveId.value) return
    removing.value = true
    try {
      await $fetch(`/api/projects/${props.projectId}/members/${pendingRemoveId.value}`, {
        method: 'DELETE',
      })
      await refresh()
      pendingRemoveId.value = null
      toast.success(t('toasts.memberRemoved'))
    } finally {
      removing.value = false
    }
  }

  function orgBadgeVariant(role: string): 'info' | 'warning' | 'neutral' {
    if (role === 'owner') return 'info'
    if (role === 'manager' || role === 'admin') return 'warning'
    return 'neutral'
  }
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex justify-between items-center">
      <h2 class="m-0">{{ t('projectMembers.title') }}</h2>
      <GTButton v-if="canManage && !showInvite" @click="showInvite = true">
        {{ t('projectMembers.invite') }}
      </GTButton>
    </header>

    <InviteMemberModal
      v-model:open="showInvite"
      :title="t('projectMembers.invite')"
      :roles="INVITE_ROLES"
      default-role="editor"
      :loading="inviting"
      :error="inviteError"
      @submit="sendInvite"
    />

    <section>
      <h3 class="text-sm uppercase text-tertiary tracking-wide mb-3">
        {{ t('projectMembers.direct') }}
      </h3>
      <ul v-if="data?.direct.length" class="list-reset grid gap-2">
        <li
          v-for="m in data.direct"
          :key="m.id"
          class="card-row flex justify-between items-center p-4 bg-surface-raised border rounded-lg"
        >
          <div class="flex flex-col gap-1">
            <strong>{{ m.name ?? m.email }}</strong>
            <span class="text-tertiary text-sm">{{ m.email }}</span>
          </div>
          <div class="flex items-center gap-3">
            <GTBadge variant="info">{{ t(`projectMembers.roles.${m.role}`) }}</GTBadge>
            <GTButton v-if="canManage" variant="outlined" size="sm" @click="pendingRemoveId = m.id">
              {{ t('projectMembers.remove') }}
            </GTButton>
          </div>
        </li>
      </ul>
      <p v-else class="text-tertiary">{{ t('projectMembers.directEmpty') }}</p>
    </section>

    <section>
      <h3 class="text-sm uppercase text-tertiary tracking-wide mb-3">
        {{ t('projectMembers.inherited') }}
      </h3>
      <p class="text-tertiary text-sm">{{ t('projectMembers.inheritedHelp') }}</p>
      <ul class="list-reset grid gap-2 mt-3">
        <li
          v-for="m in data?.orgMembers ?? []"
          :key="m.id"
          class="card-row flex justify-between items-center p-4 bg-surface border rounded-lg"
        >
          <div class="flex flex-col gap-1">
            <strong>{{ m.name ?? m.email }}</strong>
            <span class="text-tertiary text-sm">{{ m.email }}</span>
          </div>
          <GTBadge :variant="orgBadgeVariant(m.role)">
            {{ t(`projectMembers.orgRoles.${m.role}`) }}
          </GTBadge>
        </li>
      </ul>
    </section>

    <section v-if="(data?.pending?.length ?? 0) > 0">
      <h3 class="text-sm uppercase text-tertiary tracking-wide mb-3">
        {{ t('projectMembers.pending') }}
      </h3>
      <ul class="list-reset grid gap-2">
        <li
          v-for="inv in data!.pending"
          :key="inv.id"
          class="card-row flex justify-between items-center p-4 bg-surface-raised border rounded-lg"
        >
          <div class="flex flex-col gap-1">
            <strong>{{ inv.email }}</strong>
            <span class="text-tertiary text-sm">
              {{ t(`projectMembers.roles.${inv.role}`) }}
              ·
              <span :class="{ 'text-warning': daysUntil(inv.expiresAt) < 2 }">
                {{
                  daysUntil(inv.expiresAt) < 0
                    ? t('invite.expired')
                    : t('invite.expiresIn', { n: daysUntil(inv.expiresAt) })
                }}
              </span>
            </span>
          </div>
          <div v-if="canManage" class="flex gap-2">
            <GTButton
              variant="secondary"
              size="sm"
              :loading="resendingId === inv.id"
              @click="resendInvite(inv)"
            >
              {{ t('invite.resend') }}
            </GTButton>
            <GTButton variant="outlined" size="sm" @click="cancelInvite(inv.id)">
              {{ t('projectMembers.cancelInvite') }}
            </GTButton>
          </div>
        </li>
      </ul>
    </section>

    <ConfirmDialog
      :open="pendingRemoveId !== null"
      :title="t('projectMembers.remove')"
      :message="t('projectMembers.confirmRemove')"
      :confirm-label="t('projectMembers.remove')"
      destructive
      :loading="removing"
      @confirm="confirmRemoveMember"
      @update:open="(v: boolean) => !v && (pendingRemoveId = null)"
    />
  </div>
</template>
