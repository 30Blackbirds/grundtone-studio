<script setup lang="ts">
  import { deleteUser, signOut, useSession } from '~~/lib/auth-client'
  import { checkAccountDeletionGuards } from '~~/composables/useAccountDeletionGuards'

  const { t } = useI18n()
  const session = useSession()

  const showConfirm = ref(false)
  const password = ref('')
  const pending = ref(false)
  const error = ref<string | null>(null)

  const { data: guard } = await useAsyncData('account-delete-guard', () =>
    checkAccountDeletionGuards(session.data.value?.user?.id),
  )

  async function submit() {
    if (guard.value?.blocked) return
    pending.value = true
    error.value = null
    const res = await deleteUser({ password: password.value })
    pending.value = false
    if (res.error) {
      error.value = res.error.message ?? t('account.delete.error')
      return
    }
    await signOut()
    await navigateTo('/login')
  }
</script>

<template>
  <GTCard class="border-error">
    <h3 class="mt-0">{{ t('account.delete.title') }}</h3>
    <p class="text-tertiary">{{ t('account.delete.body') }}</p>

    <template v-if="guard?.blocked">
      <GTAlert variant="warning" :heading="t('account.delete.blocked')">
        <ul class="pl-6 mb-0">
          <li v-for="org in guard.soleOwnerOrgs" :key="org.orgId">
            {{ t('account.delete.soleOwner', { org: org.orgName }) }}
            —
            <NuxtLink :to="`/orgs/${org.orgSlug}/settings`">{{
              t('account.organizations.settings')
            }}</NuxtLink>
          </li>
        </ul>
      </GTAlert>
    </template>

    <template v-else>
      <GTButton v-if="!showConfirm" variant="outlined" @click="showConfirm = true">
        {{ t('account.delete.submit') }}
      </GTButton>

      <form v-else class="flex flex-col gap-4 mt-4" @submit.prevent="submit">
        <GTPasswordInput
          v-model="password"
          :label="t('account.delete.password')"
          required
          autocomplete="current-password"
        />
        <GTAlert v-if="error" variant="error" :heading="error" />
        <div class="flex gap-3 justify-end">
          <GTButton type="button" variant="secondary" @click="showConfirm = false">
            {{ t('app.cancel') }}
          </GTButton>
          <GTButton type="submit" variant="primary" :loading="pending">
            {{ t('account.delete.confirm') }}
          </GTButton>
        </div>
      </form>
    </template>
  </GTCard>
</template>
