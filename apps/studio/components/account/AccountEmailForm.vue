<script setup lang="ts">
  import { changeEmail, useSession } from '~~/lib/auth-client'

  const { t } = useI18n()
  const session = useSession()
  const config = useRuntimeConfig()

  const newEmail = ref('')
  const pending = ref(false)
  const sent = ref(false)
  const error = ref<string | null>(null)

  const currentEmail = computed(() => session.value.data?.user?.email ?? '')
  const emailVerified = computed(() => session.value.data?.user?.emailVerified === true)

  async function submit() {
    pending.value = true
    sent.value = false
    error.value = null
    const callbackURL = `${config.public.appUrl || ''}/account`
    const res = await changeEmail({
      newEmail: newEmail.value,
      callbackURL,
    })
    pending.value = false
    if (res.error) {
      error.value = res.error.message ?? t('account.email.error')
      return
    }
    sent.value = true
    newEmail.value = ''
  }
</script>

<template>
  <div class="flex flex-col gap-4">
    <GTInput :model-value="currentEmail" :label="t('account.profile.emailLabel')" readonly />
    <p class="text-tertiary text-sm m-0">
      {{
        emailVerified ? t('account.profile.emailVerified') : t('account.profile.emailNotVerified')
      }}
    </p>

    <hr class="my-2" />

    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <GTInput
        v-model="newEmail"
        type="email"
        :label="t('account.email.newEmail')"
        required
        autocomplete="email"
      />
      <GTAlert v-if="sent" variant="success" :heading="t('account.email.pending')" />
      <GTAlert v-if="error" variant="error" :heading="error" />
      <div class="flex justify-end">
        <GTButton type="submit" :loading="pending">{{ t('account.email.submit') }}</GTButton>
      </div>
    </form>
  </div>
</template>
