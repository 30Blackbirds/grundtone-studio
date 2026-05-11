<script setup lang="ts">
  import { organization } from '~~/lib/auth-client'

  definePageMeta({ layout: 'app' })

  const { t } = useI18n()
  const route = useRoute()
  const slug = computed(() => route.params.slug as string)

  const { activeOrg, isAdmin } = useOrgContext()

  const { data: members, refresh: refreshMembers } = await useAsyncData(
    () => `members-${slug.value}`,
    async () => {
      if (!activeOrg.value?.id) return []
      const res = await organization.listMembers({
        query: { organizationId: activeOrg.value.id },
        fetchOptions: { headers: useRequestHeaders(['cookie']) as HeadersInit },
      })
      return res.data?.members ?? []
    },
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
  )

  const showInvite = ref(false)
  const inviteEmail = ref('')
  const inviteRole = ref<'admin' | 'member'>('member')
  const inviting = ref(false)
  const inviteError = ref<string | null>(null)

  async function sendInvite() {
    if (!activeOrg.value?.id) return
    inviting.value = true
    inviteError.value = null
    const res = await organization.inviteMember({
      email: inviteEmail.value,
      role: inviteRole.value,
      organizationId: activeOrg.value.id,
    })
    inviting.value = false
    if (res.error) {
      inviteError.value = res.error.message ?? t('members.inviteError')
      return
    }
    showInvite.value = false
    inviteEmail.value = ''
    inviteRole.value = 'member'
    await refreshInvitations()
  }

  async function cancelInvite(invitationId: string) {
    await organization.cancelInvitation({ invitationId })
    await refreshInvitations()
  }

  async function removeMember(memberId: string) {
    if (!activeOrg.value?.id) return
    await organization.removeMember({
      memberIdOrEmail: memberId,
      organizationId: activeOrg.value.id,
    })
    await refreshMembers()
  }
</script>

<template>
  <section class="p-6">
    <nav class="flex gap-2 text-tertiary text-sm mb-4">
      <NuxtLink to="/dashboard">{{ t('orgs.title') }}</NuxtLink>
      <span>/</span>
      <NuxtLink :to="`/orgs/${slug}`">{{ activeOrg?.name ?? slug }}</NuxtLink>
      <span>/</span>
      <span>{{ t('members.title') }}</span>
    </nav>

    <header class="flex justify-between items-center mb-6">
      <h1 class="m-0">{{ t('members.title') }}</h1>
      <GTButton v-if="isAdmin && !showInvite" @click="showInvite = true">
        {{ t('members.invite') }}
      </GTButton>
    </header>

    <form
      v-if="showInvite"
      class="flex flex-col gap-4 p-4 mb-6 bg-surface-raised border rounded-lg"
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
          :label="t('members.role')"
          :options="[
            { value: 'member', label: t('members.roles.member') },
            { value: 'admin', label: t('members.roles.admin') },
          ]"
        />
      </div>
      <GTAlert v-if="inviteError" variant="error" :heading="inviteError" />
      <div class="flex gap-3 justify-end">
        <GTButton type="button" variant="secondary" @click="showInvite = false">
          {{ t('app.cancel') }}
        </GTButton>
        <GTButton type="submit" :loading="inviting">{{ t('members.sendInvite') }}</GTButton>
      </div>
    </form>

    <h2 class="text-lg mt-6 mb-3">{{ t('members.active') }}</h2>
    <ul class="list-reset grid gap-2">
      <li
        v-for="m in members"
        :key="m.id"
        class="flex justify-between items-center p-4 bg-surface-raised border rounded-lg"
      >
        <div class="flex flex-col gap-1">
          <strong>{{ m.user?.name ?? m.user?.email }}</strong>
          <span class="text-tertiary text-sm">{{ m.user?.email }}</span>
        </div>
        <div class="flex items-center gap-3">
          <GTBadge :variant="m.role === 'owner' ? 'info' : 'neutral'">
            {{ t(`members.roles.${m.role}`) }}
          </GTBadge>
          <GTButton
            v-if="isAdmin && m.role !== 'owner'"
            variant="outlined"
            size="sm"
            @click="removeMember(m.id)"
          >
            {{ t('members.remove') }}
          </GTButton>
        </div>
      </li>
    </ul>

    <template v-if="pendingInvitations && pendingInvitations.length">
      <h2 class="text-lg mt-8 mb-3">{{ t('members.pending') }}</h2>
      <ul class="list-reset grid gap-2">
        <li
          v-for="inv in pendingInvitations"
          :key="inv.id"
          class="flex justify-between items-center p-4 bg-surface-raised border rounded-lg"
        >
          <div class="flex flex-col gap-1">
            <strong>{{ inv.email }}</strong>
            <span class="text-tertiary text-sm">
              {{ t(`members.roles.${inv.role}`) }}
            </span>
          </div>
          <GTButton v-if="isAdmin" variant="outlined" size="sm" @click="cancelInvite(inv.id)">
            {{ t('members.cancelInvite') }}
          </GTButton>
        </li>
      </ul>
    </template>
  </section>
</template>
