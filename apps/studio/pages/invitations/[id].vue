<script setup lang="ts">
  import { authClient, organization } from '~~/lib/auth-client'
  import { orgWrites } from '~~/lib/org-writes'

  definePageMeta({ layout: 'auth' })

  const { t } = useI18n()
  const authMode = await useAuthMode()
  const isOidc = authMode.value === 'oidc'
  const route = useRoute()
  const invitationId = computed(() => route.params.id as string)

  const session = await authClient.getSession()
  const isAuthed = computed(() => Boolean(session.data?.session))

  // In oidc mode the link carries a one-use token and there is no preview of
  // who invited whom: only the signed-in, invited address can accept it.
  const { data: invitation, error: loadError } = await useAsyncData(
    `invitation-${invitationId.value}`,
    async () => {
      if (isOidc) return { organizationName: '', email: '' }
      const res = await organization.getInvitation({
        query: { id: invitationId.value },
        fetchOptions: { headers: useRequestHeaders(['cookie']) as HeadersInit },
      })
      return res.data
    },
  )

  const accepting = ref(false)
  const acceptError = ref<string | null>(null)

  async function accept() {
    accepting.value = true
    acceptError.value = null
    const res = await orgWrites.acceptInvitation(invitationId.value)
    accepting.value = false
    if (res.error) {
      acceptError.value = res.error.message ?? t('invitation.acceptError')
      return
    }
    const acceptedOrgId = res.data?.invitation?.organizationId
    if (acceptedOrgId && !isOidc) {
      await organization.setActive({ organizationId: acceptedOrgId })
    }
    await navigateTo('/dashboard')
  }

  async function reject() {
    if (!isOidc) await organization.rejectInvitation({ invitationId: invitationId.value })
    await navigateTo('/dashboard')
  }
</script>

<template>
  <AuthCard :title="t('invitation.title')">
    <GTAlert v-if="loadError" variant="error" :heading="t('invitation.notFound')" class="mb-4" />

    <template v-else-if="invitation">
      <p v-if="isOidc">{{ t('invitation.bodyGeneric') }}</p>
      <p v-else>
        {{
          t('invitation.body', {
            org: invitation.organizationName,
            email: invitation.email,
          })
        }}
      </p>

      <GTAlert
        v-if="!isAuthed"
        variant="info"
        :heading="t('invitation.signInRequired')"
        class="my-4"
      >
        <NuxtLink :to="`/login?redirect=/invitations/${invitationId}`">
          {{ t('auth.login.submit') }}
        </NuxtLink>
      </GTAlert>

      <GTAlert v-if="acceptError" variant="error" :heading="acceptError" class="my-4" />

      <div v-if="isAuthed" class="flex gap-3 justify-end mt-6">
        <GTButton variant="secondary" :disabled="accepting" @click="reject">
          {{ t('invitation.reject') }}
        </GTButton>
        <GTButton :loading="accepting" @click="accept">
          {{ t('invitation.accept') }}
        </GTButton>
      </div>
    </template>
  </AuthCard>
</template>
