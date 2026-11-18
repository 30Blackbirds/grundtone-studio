<script setup lang="ts">
  import { authClient } from '~~/lib/auth-client'

  const { t } = useI18n()
  const identity = useAccountIdentity()

  const email = computed(() => identity.value.email)
  // Nothing is shown until the source has answered; an unknown is not "unverified".
  const show = computed(() => identity.value.loaded && !identity.value.emailVerified)

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
    <p v-if="identity.managedByIdp" class="text-sm mt-2 mb-0">
      {{ t('account.verification.idp') }}
    </p>
    <GTButton
      v-else
      variant="secondary"
      size="sm"
      :loading="resending"
      class="mt-2"
      @click="resend"
    >
      {{ t('account.verification.resend') }}
    </GTButton>
    <p v-if="resent" class="text-sm mt-2 mb-0">{{ t('account.verification.resent') }}</p>
    <p v-if="error" class="text-sm mt-2 mb-0">{{ error }}</p>
  </GTAlert>
</template>
