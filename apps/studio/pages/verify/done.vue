<script setup lang="ts">
  import { authClient } from '~~/lib/auth-client'
  import { readVerifyStash, verifyApiUrl, verifyDoneState } from '~~/lib/verify-flow'

  definePageMeta({ layout: 'auth' })

  const { t } = useI18n()
  const route = useRoute()

  // Forlæg: redesign-verify-done.html — 5 states mod auths låste enum.
  // "Allerede bekræftet" ER succes (endpointet gennemfører igen uden error-
  // param), så den har ingen egen state.
  const state = computed(() => verifyDoneState(route.query.error))

  const stash = ref<ReturnType<typeof readVerifyStash>>({})
  onMounted(() => {
    stash.value = readVerifyStash(sessionStorage)
  })

  const continueTarget = computed(() => stash.value.next ?? '/dashboard')

  const resending = ref(false)
  const resent = ref(false)
  const resendError = ref<string | null>(null)

  async function resend() {
    const email = stash.value.email
    if (!email) return
    resending.value = true
    resendError.value = null
    const res = await authClient.sendVerificationEmail({ email, callbackURL: '/dashboard' })
    resending.value = false
    if (res.error) {
      resendError.value = res.error.message ?? t('verifyEmail.resendError')
      return
    }
    resent.value = true
  }

  // INVALID_USER-kanten (change-email åbnet i en anden brugers session):
  // log ud og — når tokenet stadig ligger i stashen — genkør verifikationen
  // direkte, så brugeren slipper for at finde mailen frem igen.
  const signingOut = ref(false)

  async function signOutAndRetry() {
    signingOut.value = true
    await authClient.signOut()
    const token = stash.value.token
    if (token) {
      window.location.href = verifyApiUrl(token)
      return
    }
    signingOut.value = false
    navigateTo('/login')
  }
</script>

<template>
  <AuthCard v-if="state === 'success'" :title="t('verifyDone.successTitle')">
    <div class="verify-icon verify-icon--ok" aria-hidden="true">✓</div>
    <p class="text-tertiary">{{ t('verifyDone.successBody') }}</p>
    <GTButton block @click="navigateTo(continueTarget)">
      {{ t('verifyDone.continue') }}
    </GTButton>
  </AuthCard>

  <AuthCard v-else-if="state === 'expired'" :title="t('verifyDone.expiredTitle')">
    <div class="verify-icon verify-icon--warn" aria-hidden="true">⏱</div>
    <p class="text-tertiary">{{ t('verifyDone.expiredBody') }}</p>
    <div class="flex flex-col gap-3">
      <GTAlert v-if="resent" variant="success" :heading="t('verifyEmail.resentHeading')" />
      <GTAlert v-if="resendError" variant="error" :heading="resendError" />
      <GTButton v-if="stash.email" :loading="resending" :disabled="resent" block @click="resend">
        {{ t('verifyDone.resend') }}
      </GTButton>
      <GTButton v-else block @click="navigateTo('/login')">
        {{ t('verifyDone.logIn') }}
      </GTButton>
    </div>
  </AuthCard>

  <AuthCard v-else-if="state === 'userGone'" :title="t('verifyDone.userGoneTitle')">
    <div class="verify-icon verify-icon--neutral" aria-hidden="true">⚠</div>
    <p class="text-tertiary">{{ t('verifyDone.userGoneBody') }}</p>
    <GTButton block @click="navigateTo('/signup')">
      {{ t('verifyDone.signUp') }}
    </GTButton>
  </AuthCard>

  <AuthCard v-else-if="state === 'wrongUser'" :title="t('verifyDone.wrongUserTitle')">
    <div class="verify-icon verify-icon--neutral" aria-hidden="true">⚠</div>
    <p class="text-tertiary">{{ t('verifyDone.wrongUserBody') }}</p>
    <GTButton block :loading="signingOut" @click="signOutAndRetry">
      {{ t('verifyDone.signOutRetry') }}
    </GTButton>
  </AuthCard>

  <AuthCard v-else :title="t('verifyDone.invalidTitle')">
    <div class="verify-icon verify-icon--neutral" aria-hidden="true">⚠</div>
    <p class="text-tertiary">{{ t('verifyDone.invalidBody') }}</p>
    <div class="flex flex-col gap-3">
      <GTAlert v-if="resent" variant="success" :heading="t('verifyEmail.resentHeading')" />
      <GTAlert v-if="resendError" variant="error" :heading="resendError" />
      <GTButton block @click="navigateTo('/login')">
        {{ t('verifyDone.logIn') }}
      </GTButton>
      <GTButton
        v-if="stash.email"
        variant="secondary"
        :loading="resending"
        :disabled="resent"
        block
        @click="resend"
      >
        {{ t('verifyDone.resend') }}
      </GTButton>
    </div>
  </AuthCard>
</template>
