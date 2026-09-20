<script setup lang="ts">
  import { organization } from '~~/lib/auth-client'

  const { t } = useI18n()
  const { state, next } = useOnboardingState()

  const name = ref(state.value.orgName ?? '')
  const slug = ref(state.value.orgSlug ?? '')
  const slugTouched = ref(Boolean(state.value.orgSlug))
  const submitting = ref(false)
  const error = ref<string | null>(null)

  watch(name, (v) => {
    if (!slugTouched.value) slug.value = slugify(v)
  })

  async function submit() {
    submitting.value = true
    error.value = null
    const res = await organization.create({ name: name.value, slug: slug.value })
    submitting.value = false
    if (res.error) {
      error.value = res.error.message ?? t('onboarding.org.error')
      return
    }
    state.value.orgId = res.data?.id ?? null
    state.value.orgSlug = slug.value
    state.value.orgName = name.value
    if (state.value.orgId) {
      await organization.setActive({ organizationId: state.value.orgId })
    }
    // The sidebar/org-switcher read the shared org-context cache — refresh it
    // so the brand-new org is visible the moment onboarding finishes.
    await refreshNuxtData('org-context-orgs')
    next()
  }
</script>

<template>
  <form class="flex flex-col gap-6" @submit.prevent="submit">
    <OnboardingStepHeader
      icon="users"
      :title="t('onboarding.org.title')"
      :subtitle="t('onboarding.org.subtitle')"
    />

    <div class="flex flex-col gap-4">
      <GTInput
        v-model="name"
        :label="t('onboarding.org.nameLabel')"
        :help-text="t('onboarding.org.nameHelp')"
        required
        autofocus
      />
      <GTInput
        v-model="slug"
        :label="t('onboarding.org.slugLabel')"
        :help-text="t('onboarding.org.slugHelp')"
        pattern="[a-z0-9-]+"
        required
        @input="slugTouched = true"
      />
    </div>

    <GTAlert v-if="error" variant="error" :heading="error" />

    <div class="flex justify-end">
      <GTButton type="submit" :loading="submitting" :disabled="!name || !slug">
        {{ t('onboarding.continue') }}
      </GTButton>
    </div>
  </form>
</template>
