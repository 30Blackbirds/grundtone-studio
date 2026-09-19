<script setup lang="ts">
  import { organization, useSession } from '~~/lib/auth-client'

  const { t } = useI18n()
  const session = useSession()
  const userId = computed(() => session.value.data?.user?.id)

  const { data: orgs, refresh } = await useAsyncData('account-orgs', async () => {
    const res = await organization.list({
      fetchOptions: { headers: useRequestHeaders(['cookie']) as Record<string, string> },
    })
    return res.data ?? []
  })

  const { data: roleByOrg, refresh: refreshRoles } = await useAsyncData(
    'account-org-roles',
    async () => {
      const list = orgs.value ?? []
      const map = new Map<string, string>()
      for (const org of list) {
        const full = await organization.getFullOrganization({
          query: { organizationId: org.id },
          fetchOptions: { headers: useRequestHeaders(['cookie']) as Record<string, string> },
        })
        const member = full.data?.members?.find((m) => m.userId === userId.value)
        if (member?.role) map.set(org.id, member.role)
      }
      return map
    },
    { watch: [orgs, userId] },
  )

  const toast = useToast()
  const leaving = ref<string | null>(null)
  const error = ref<string | null>(null)
  const pendingLeave = ref<{ id: string; name: string } | null>(null)

  async function confirmLeaveOrg() {
    const org = pendingLeave.value
    if (!org) return
    const role = roleByOrg.value?.get(org.id)
    if (role === 'owner') {
      error.value = t('account.organizations.ownerBlocked')
      pendingLeave.value = null
      return
    }
    leaving.value = org.id
    error.value = null
    const res = await organization.leave({ organizationId: org.id })
    leaving.value = null
    if (res.error) {
      error.value = res.error.message ?? t('account.organizations.leaveError')
      pendingLeave.value = null
      return
    }
    pendingLeave.value = null
    toast.success(t('toasts.leftOrg'))
    await refresh()
    await refreshRoles()
  }
</script>

<template>
  <div class="flex flex-col gap-4">
    <GTAlert v-if="error" variant="error" :heading="error" />
    <p v-if="!orgs?.length" class="text-tertiary m-0">{{ t('account.organizations.empty') }}</p>
    <ul v-else class="list-reset flex flex-col gap-2">
      <li
        v-for="org in orgs"
        :key="org.id"
        class="flex items-center justify-between gap-4 p-4 bg-surface-raised border rounded-lg"
      >
        <div>
          <strong>{{ org.name }}</strong>
          <p class="text-tertiary text-sm m-0">
            {{
              t('account.organizations.role', {
                role: t(`members.roles.${roleByOrg?.get(org.id) ?? 'member'}`),
              })
            }}
          </p>
        </div>
        <div class="flex gap-2">
          <NuxtLink :to="`/orgs/${org.slug}/settings`">
            <GTButton variant="secondary" size="sm">{{
              t('account.organizations.settings')
            }}</GTButton>
          </NuxtLink>
          <GTButton
            v-if="roleByOrg?.get(org.id) !== 'owner'"
            variant="outlined"
            size="sm"
            :loading="leaving === org.id"
            @click="pendingLeave = { id: org.id, name: org.name }"
          >
            {{ t('account.organizations.leave') }}
          </GTButton>
        </div>
      </li>
    </ul>

    <ConfirmDialog
      :open="pendingLeave !== null"
      :title="t('account.organizations.leave')"
      :message="
        pendingLeave ? t('account.organizations.leaveConfirm', { org: pendingLeave.name }) : ''
      "
      :confirm-label="t('account.organizations.leave')"
      destructive
      :loading="leaving !== null"
      @confirm="confirmLeaveOrg"
      @update:open="(v: boolean) => !v && (pendingLeave = null)"
    />
  </div>
</template>
