<script setup lang="ts">
  import type { ProjectRole } from '~~/composables/useProjectRole'

  const props = defineProps<{ projectId: string; canManage: boolean }>()
  const { t } = useI18n()

  interface OrgMember {
    id: string
    userId: string
    role: string
    name: string | null
    email: string
  }
  interface DirectMember {
    id: string
    userId: string
    role: ProjectRole
    name: string | null
    email: string
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
  const inviteEmail = ref('')
  const inviteRole = ref<ProjectRole>('editor')
  const inviting = ref(false)
  const inviteError = ref<string | null>(null)

  async function sendInvite() {
    inviting.value = true
    inviteError.value = null
    try {
      await $fetch(`/api/projects/${props.projectId}/members`, {
        method: 'POST',
        body: { email: inviteEmail.value, role: inviteRole.value },
      })
      showInvite.value = false
      inviteEmail.value = ''
      inviteRole.value = 'editor'
      await refresh()
    } catch (err) {
      inviteError.value = (err as Error).message
    } finally {
      inviting.value = false
    }
  }

  async function cancelInvite(invitationId: string) {
    await $fetch(`/api/projects/${props.projectId}/invitations/${invitationId}`, {
      method: 'DELETE',
    })
    await refresh()
  }

  async function removeMember(memberId: string) {
    if (!confirm(t('projectMembers.confirmRemove'))) return
    await $fetch(`/api/projects/${props.projectId}/members/${memberId}`, { method: 'DELETE' })
    await refresh()
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

    <form
      v-if="showInvite"
      class="flex flex-col gap-4 p-4 bg-surface-raised border rounded-lg"
      @submit.prevent="sendInvite"
    >
      <div class="grid grid-cols-2 gap-3">
        <GTInput
          v-model="inviteEmail"
          type="email"
          :label="t('auth.email')"
          required
          autocomplete="email"
        />
        <GTSelect
          v-model="inviteRole"
          :label="t('projectMembers.role')"
          :options="[
            { value: 'viewer', label: t('projectMembers.roles.viewer') },
            { value: 'editor', label: t('projectMembers.roles.editor') },
            { value: 'admin', label: t('projectMembers.roles.admin') },
          ]"
        />
      </div>
      <GTAlert v-if="inviteError" variant="error" :heading="inviteError" />
      <div class="flex gap-3 justify-end">
        <GTButton type="button" variant="secondary" @click="showInvite = false">
          {{ t('app.cancel') }}
        </GTButton>
        <GTButton type="submit" :loading="inviting">{{ t('projectMembers.send') }}</GTButton>
      </div>
    </form>

    <section>
      <h3 class="text-sm uppercase text-tertiary tracking-wide mb-3">
        {{ t('projectMembers.direct') }}
      </h3>
      <ul v-if="data?.direct.length" class="list-reset grid gap-2">
        <li
          v-for="m in data.direct"
          :key="m.id"
          class="flex justify-between items-center p-4 bg-surface-raised border rounded-lg"
        >
          <div class="flex flex-col gap-1">
            <strong>{{ m.name ?? m.email }}</strong>
            <span class="text-tertiary text-sm">{{ m.email }}</span>
          </div>
          <div class="flex items-center gap-3">
            <GTBadge variant="info">{{ t(`projectMembers.roles.${m.role}`) }}</GTBadge>
            <GTButton v-if="canManage" variant="outlined" size="sm" @click="removeMember(m.id)">
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
          class="flex justify-between items-center p-4 bg-surface border rounded-lg"
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
          class="flex justify-between items-center p-4 bg-surface-raised border rounded-lg"
        >
          <div class="flex flex-col gap-1">
            <strong>{{ inv.email }}</strong>
            <span class="text-tertiary text-sm">
              {{ t(`projectMembers.roles.${inv.role}`) }}
            </span>
          </div>
          <GTButton v-if="canManage" variant="outlined" size="sm" @click="cancelInvite(inv.id)">
            {{ t('projectMembers.cancelInvite') }}
          </GTButton>
        </li>
      </ul>
    </section>
  </div>
</template>
