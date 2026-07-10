<script setup lang="ts">
  import { changePassword } from '~~/lib/auth-client'

  const { t } = useI18n()

  const currentPassword = ref('')
  const newPassword = ref('')
  const confirmPassword = ref('')
  const pending = ref(false)
  const saved = ref(false)
  const error = ref<string | null>(null)

  async function submit() {
    if (newPassword.value !== confirmPassword.value) {
      error.value = t('account.security.mismatch')
      return
    }
    pending.value = true
    saved.value = false
    error.value = null
    const res = await changePassword({
      currentPassword: currentPassword.value,
      newPassword: newPassword.value,
    })
    pending.value = false
    if (res.error) {
      error.value = res.error.message ?? t('account.security.error')
      return
    }
    saved.value = true
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
  }
</script>

<template>
  <form class="flex flex-col gap-4" @submit.prevent="submit">
    <GTPasswordInput
      v-model="currentPassword"
      :label="t('account.security.currentPassword')"
      required
      autocomplete="current-password"
    />
    <GTPasswordInput
      v-model="newPassword"
      :label="t('account.security.newPassword')"
      required
      autocomplete="new-password"
    />
    <GTPasswordInput
      v-model="confirmPassword"
      :label="t('account.security.confirmPassword')"
      required
      autocomplete="new-password"
    />
    <GTAlert v-if="saved" variant="success" :heading="t('account.security.saved')" />
    <GTAlert v-if="error" variant="error" :heading="error" />
    <div class="flex justify-end">
      <GTButton type="submit" :loading="pending">{{ t('account.security.submit') }}</GTButton>
    </div>
  </form>
</template>
