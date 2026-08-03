<script setup lang="ts">
  import {
    isSafeRelativePath,
    verifyApiUrl,
    VERIFY_STASH_KEY,
    type VerifyStash,
  } from '~~/lib/verify-flow'

  definePageMeta({ layout: 'auth' })

  const { t } = useI18n()
  const route = useRoute()

  // Mail-linket lander HER (tillids-flowet: brugeren ser studio-domænet og
  // branded UI, og mail-scanneres GET af selve siden forbruger ikke tokenet).
  // Verifikationen sker via en FULD browser-navigation til BFF'ens verify-
  // endpoint — fetch duer ikke: Set-Cookie + redirect skal ske nativt.
  onMounted(() => {
    const token = typeof route.query.token === 'string' ? route.query.token : null
    if (!token) {
      navigateTo('/verify/done?error=INVALID_TOKEN', { replace: true })
      return
    }

    const stash: VerifyStash = {
      token,
      email: typeof route.query.email === 'string' ? route.query.email : undefined,
      next: isSafeRelativePath(route.query.callbackURL) ? route.query.callbackURL : undefined,
    }
    try {
      sessionStorage.setItem(VERIFY_STASH_KEY, JSON.stringify(stash))
    } catch {
      // Privat browsing uden storage: flowet virker stadig, kun retry/resend-
      // genvejene på /verify/done mister deres data.
    }

    window.location.href = verifyApiUrl(token)
  })
</script>

<template>
  <AuthCard :title="t('verify.title')">
    <div class="verify-spinner" aria-hidden="true" />
    <p class="text-tertiary">{{ t('verify.body') }}</p>
  </AuthCard>
</template>
