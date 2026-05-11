<script setup lang="ts">
  import { authClient } from '~~/lib/auth-client'

  definePageMeta({ layout: 'auth' })

  const { t } = useI18n()
  const route = useRoute()
  const invitationId = computed(() => route.params.id as string)

  const session = await authClient.getSession()
  const isAuthed = computed(() => Boolean(session.data?.session))

  interface InvitationPreview {
    id: string
    email: string
    role: 'viewer' | 'editor' | 'admin'
    status: string
    expiresAt: string
    expired: boolean
    projectId: string
    projectName: string
    organizationName: string
  }

  const { data: invitation, error: loadError } = await useAsyncData(
    () => `project-invitation-${invitationId.value}`,
    () =>
      $fetch<InvitationPreview>(`/api/invitations/project/${invitationId.value}`, {
        headers: useRequestHeaders(['cookie']),
      }).catch(() => null),
  )

  const accepting = ref(false)
  const acceptError = ref<string | null>(null)

  async function accept() {
    accepting.value = true
    acceptError.value = null
    try {
      await $fetch(`/api/invitations/project/${invitationId.value}/accept`, { method: 'POST' })
      if (invitation.value?.projectId) {
        await navigateTo('/dashboard')
      }
    } catch (err) {
      acceptError.value = (err as Error).message ?? t('invitation.acceptError')
    } finally {
      accepting.value = false
    }
  }
</script>

<template>
  <div class="max-w-md mx-auto my-10 p-6 bg-surface-raised border rounded-lg">
    <h1 class="mt-0">{{ t('projectInvitation.title') }}</h1>

    <GTAlert
      v-if="loadError || !invitation"
      variant="error"
      :heading="t('invitation.notFound')"
      class="mb-4"
    />

    <template v-else>
      <p>
        {{
          t('projectInvitation.body', {
            email: invitation.email,
            project: invitation.projectName,
            org: invitation.organizationName,
            role: t(`projectMembers.roles.${invitation.role}`),
          })
        }}
      </p>

      <GTAlert
        v-if="invitation.expired"
        variant="error"
        :heading="t('projectInvitation.expired')"
        class="my-4"
      />

      <GTAlert
        v-else-if="!isAuthed"
        variant="info"
        :heading="t('invitation.signInRequired')"
        class="my-4"
      >
        <NuxtLink :to="`/login?redirect=/invitations/project/${invitationId}`">
          {{ t('auth.login.submit') }}
        </NuxtLink>
      </GTAlert>

      <GTAlert v-if="acceptError" variant="error" :heading="acceptError" class="my-4" />

      <div v-if="isAuthed && !invitation.expired" class="flex justify-end mt-6">
        <GTButton :loading="accepting" @click="accept">
          {{ t('invitation.accept') }}
        </GTButton>
      </div>
    </template>
  </div>
</template>
