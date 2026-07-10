<script setup lang="ts">
  import { updateUser, useSession } from '~~/lib/auth-client'

  const { t } = useI18n()
  const session = useSession()

  const name = ref(session.data.value?.user?.name ?? '')
  const pending = ref(false)
  const saved = ref(false)
  const error = ref<string | null>(null)

  watch(
    () => session.data.value?.user?.name,
    (v) => {
      if (v !== undefined) name.value = v ?? ''
    },
  )

  async function submit() {
    pending.value = true
    saved.value = false
    error.value = null
    const res = await updateUser({ name: name.value })
    pending.value = false
    if (res.error) {
      error.value = res.error.message ?? t('account.profile.error')
      return
    }
    saved.value = true
  }
</script>

<template>
  <form class="flex flex-col gap-4" @submit.prevent="submit">
    <GTInput v-model="name" :label="t('account.profile.nameLabel')" required autocomplete="name" />
    <GTAlert v-if="saved" variant="success" :heading="t('account.profile.saved')" />
    <GTAlert v-if="error" variant="error" :heading="error" />
    <div class="flex justify-end">
      <GTButton type="submit" :loading="pending">{{ t('app.save') }}</GTButton>
    </div>
  </form>
</template>
