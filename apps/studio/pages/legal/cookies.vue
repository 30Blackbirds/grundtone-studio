<script setup lang="ts">
  // Statisk cookie-oplysningsside (jura consent-cookie-notat §2) — bevidst
  // INGEN pop-up/banner: Studio sætter kun nødvendige cookies, så der er intet
  // samtykke at indhente. Tilføjes Matomo senere, deployes banner + Matomo som
  // ÉN leverance (notatets §3-spec).
  definePageMeta({ layout: 'auth' })
  const { t } = useI18n()
</script>

<template>
  <section class="auth-card p-6">
    <h1>{{ t('legalCookies.title') }}</h1>
    <p>{{ t('legalCookies.intro') }}</p>
    <table class="legal-table">
      <thead>
        <tr>
          <th>{{ t('legalCookies.colCookie') }}</th>
          <th>{{ t('legalCookies.colPurpose') }}</th>
          <th>{{ t('legalCookies.colLifetime') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>{{ t('legalCookies.sessionName') }}</td>
          <td>{{ t('legalCookies.sessionPurpose') }}</td>
          <td>{{ t('legalCookies.sessionLifetime') }}</td>
        </tr>
        <tr>
          <td><code>i18n_locale</code></td>
          <td>{{ t('legalCookies.localePurpose') }}</td>
          <td>{{ t('legalCookies.localeLifetime') }}</td>
        </tr>
      </tbody>
    </table>
    <p>{{ t('legalCookies.noConsentNote') }}</p>
    <p class="text-tertiary text-sm">{{ t('legalCookies.altchaNote') }}</p>
  </section>
</template>
