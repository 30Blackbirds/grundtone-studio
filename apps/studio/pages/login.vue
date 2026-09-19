<script setup lang="ts">
  import { signIn } from '~~/lib/auth-client'
  import { solveAltchaChallenge } from '~~/composables/useAltcha'

  definePageMeta({ layout: 'auth' })

  const { t } = useI18n()
  const route = useRoute()
  const email = ref('')
  const password = ref('')
  const error = ref<string | null>(null)
  const pending = ref(false)

  const redirect = computed(() => (route.query.redirect as string) || '/dashboard')
  const resetSuccess = computed(() => route.query.reset === 'success')

  // ── Magic-link (task #13, the R9 prototype's "eller"-path) ────────────────
  // Shares the email field with the password form. The auth service's
  // magic-link plugin is live (POST sign-in/magic-link, 5 min expiry). The
  // captcha header is sent defensively: the path isn't in ALTCHA's guard set
  // today, but if [auth] adds it (flagged), studio already complies.
  const magicPending = ref(false)
  const magicSent = ref(false)
  const magicError = ref<string | null>(null)

  async function sendMagicLink() {
    magicError.value = null
    if (!email.value) {
      magicError.value = t('auth.login.magicLink.emailRequired')
      return
    }
    magicPending.value = true
    try {
      const captchaToken = await solveAltchaChallenge()
      const headers: Record<string, string> = {}
      if (captchaToken) headers['x-captcha-response'] = captchaToken

      const res = await signIn.magicLink({
        email: email.value,
        callbackURL: redirect.value,
        fetchOptions: { headers },
      })
      if (res.error) {
        magicError.value = res.error.message ?? t('auth.login.magicLink.error')
        return
      }
      magicSent.value = true
    } catch {
      magicError.value = t('auth.captchaError')
    } finally {
      magicPending.value = false
    }
  }

  async function submit() {
    pending.value = true
    error.value = null
    try {
      const captchaToken = await solveAltchaChallenge()
      const headers: Record<string, string> = {}
      if (captchaToken) headers['x-captcha-response'] = captchaToken

      const res = await signIn.email({
        email: email.value,
        password: password.value,
        fetchOptions: { headers },
      })
      if (res.error) {
        const code = (res.error as { code?: string }).code
        if (code === 'EMAIL_NOT_VERIFIED') {
          await navigateTo(`/verify-email?email=${encodeURIComponent(email.value)}`)
          return
        }
        error.value = res.error.message ?? t('auth.login.error')
        return
      }
      await navigateTo(redirect.value)
    } catch {
      error.value = t('auth.captchaError')
    } finally {
      pending.value = false
    }
  }
</script>

<template>
  <AuthCard :title="t('auth.login.title')">
    <GTAlert
      v-if="resetSuccess"
      variant="success"
      :heading="t('auth.login.resetSuccess')"
      class="mb-4"
    />

    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <GTInput
        v-model="email"
        type="email"
        :label="t('auth.email')"
        required
        autocomplete="email"
      />
      <GTPasswordInput
        v-model="password"
        :label="t('auth.password')"
        required
        autocomplete="current-password"
      />
      <GTAlert v-if="error" variant="error" :heading="error" :aria-label="t('auth.login.error')" />
      <GTButton type="submit" :loading="pending" block>{{ t('auth.login.submit') }}</GTButton>
    </form>

    <!-- "eller"-separator + magic-link — the R9 prototype's secondary path. -->
    <div class="auth-separator text-tertiary text-sm" aria-hidden="true">
      {{ t('auth.login.or') }}
    </div>
    <GTAlert v-if="magicSent" variant="success" :heading="t('auth.login.magicLink.sentHeading')">
      {{ t('auth.login.magicLink.sentBody', { email }) }}
    </GTAlert>
    <template v-else>
      <GTAlert v-if="magicError" variant="error" :heading="magicError" />
      <GTButton variant="outlined" block :loading="magicPending" @click="sendMagicLink">
        {{ t('auth.login.magicLink.send') }}
      </GTButton>
    </template>

    <!-- Secondary paths gathered under the form, centred ([designer] 2026-09-17):
         login link above, then forgot password, then sign up. -->
    <div class="flex flex-col items-center gap-2 mt-4 text-sm">
      <NuxtLink to="/forgot-password" class="auth-card__standalone-link">
        {{ t('auth.login.forgotPassword') }}
      </NuxtLink>
      <p class="m-0 text-tertiary">
        {{ t('auth.login.noAccount') }}
        <NuxtLink to="/signup">{{ t('auth.login.createAccount') }}</NuxtLink>
      </p>
    </div>
  </AuthCard>
</template>
