<script setup lang="ts">
  import { authClient, useSession } from '~~/lib/auth-client'

  const { t } = useI18n()
  const session = useSession()

  const email = computed(() => session.value.data?.user?.email ?? '')
  const show = computed(() => session.value.data?.user?.emailVerified !== true)

  const resending = ref(false)
  const resent = ref(false)
  const error = ref<string | null>(null)

  async function resend() {
    if (!email.value) return
    resending.value = true
    resent.value = false
    error.value = null
    const res = await authClient.sendVerificationEmail({
      email: email.value,
      callbackURL: '/dashboard',
    })
    resending.value = false
    if (res.error) {
      error.value = res.error.message ?? t('account.verification.error')
      return
    }
    resent.value = true
  }
</script>

<template>
  <GTAlert v-if="show" variant="warning" :heading="t('account.verification.banner')">
    <GTButton variant="secondary" size="sm" :loading="resending" class="mt-2" @click="resend">
      {{ t('account.verification.resend') }}
    </GTButton>
    <p v-if="resent" class="text-sm mt-2 mb-0">{{ t('account.verification.resent') }}</p>
    <p v-if="error" class="text-sm mt-2 mb-0">{{ error }}</p>
  </GTAlert>
</template>
