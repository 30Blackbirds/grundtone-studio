<script setup lang="ts">
  import { authClient } from '~~/lib/auth-client'

  definePageMeta({ layout: 'auth' })

  const { t } = useI18n()
  const route = useRoute()
  const emailParam = computed(() => (route.query.email as string | undefined) ?? null)

  const resending = ref(false)
  const resent = ref(false)
  const resendError = ref<string | null>(null)

  // Better Auth's verify endpoint redirects to callbackURL after success;
  // we point it at /dashboard so the freshly-verified user lands inside
  // the onboarding wizard the same way an email/password sign-in would.
  const callbackURL = '/dashboard'

  async function resend() {
    if (!emailParam.value) return
    resending.value = true
    resendError.value = null
    const res = await authClient.sendVerificationEmail({
      email: emailParam.value,
      callbackURL,
    })
    resending.value = false
    if (res.error) {
      resendError.value = res.error.message ?? t('verifyEmail.resendError')
      return
    }
    resent.value = true
  }
</script>

<template>
  <div class="max-w-md mx-auto my-10 p-6 bg-surface-raised border rounded-lg">
    <h1 class="mt-0">{{ t('verifyEmail.title') }}</h1>
    <p>
      <template v-if="emailParam">
        {{ t('verifyEmail.bodyWithEmail', { email: emailParam }) }}
      </template>
      <template v-else>
        {{ t('verifyEmail.bodyGeneric') }}
      </template>
    </p>
    <p class="text-tertiary text-sm">
      {{ t('verifyEmail.didntArriveHint') }}
    </p>

    <div v-if="emailParam" class="flex flex-col gap-3">
      <GTAlert v-if="resent" variant="success" :heading="t('verifyEmail.resentHeading')">
        {{ t('verifyEmail.resentBody', { email: emailParam }) }}
      </GTAlert>
      <GTAlert v-if="resendError" variant="error" :heading="resendError" />
      <GTButton variant="secondary" :loading="resending" :disabled="resent" @click="resend">
        {{ t('verifyEmail.resend') }}
      </GTButton>
    </div>

    <hr class="my-6" />
    <p class="text-tertiary">
      <NuxtLink to="/login">{{ t('verifyEmail.backToLogin') }}</NuxtLink>
    </p>
  </div>
</template>
