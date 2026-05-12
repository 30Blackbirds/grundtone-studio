<script setup lang="ts">
  // Verification page — throws on click so we can confirm errors land in
  // Sentry. Remove once Sentry has caught at least one real bug from prod.
  definePageMeta({ layout: 'auth' })

  function triggerError() {
    throw new Error('Sentry verification — this should appear in Issues')
  }
</script>

<template>
  <section
    class="max-w-md mx-auto my-10 p-6 bg-surface-raised border rounded-lg flex flex-col gap-4"
  >
    <h1 class="m-0">Sentry verification</h1>
    <p class="text-tertiary m-0">
      Click the button. The thrown error should land in Sentry's Issues feed within ~30 seconds. If
      it doesn't:
    </p>
    <ol>
      <li>Verify <code>NUXT_PUBLIC_SENTRY_DSN</code> is set in the running env</li>
      <li>Check the browser console for Sentry init logs</li>
      <li>Check the DSN's project actually matches <code>grundtone-studio</code></li>
    </ol>
    <GTButton variant="primary" @click="triggerError">Trigger test error</GTButton>
  </section>
</template>
