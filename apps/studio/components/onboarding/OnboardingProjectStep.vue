<script setup lang="ts">
  const { t } = useI18n()
  const { state, next, back } = useOnboardingState()

  const name = ref(state.value.projectName ?? 'Main')
  const slug = ref(state.value.projectSlug ?? 'main')
  const slugTouched = ref(Boolean(state.value.projectSlug))
  const submitting = ref(false)
  const error = ref<string | null>(null)

  watch(name, (v) => {
    if (!slugTouched.value) slug.value = slugify(v)
  })

  async function submit() {
    if (!state.value.orgSlug) {
      error.value = t('onboarding.project.noOrg')
      return
    }
    submitting.value = true
    error.value = null
    try {
      const project = await ($fetch as (url: string, opts?: unknown) => Promise<{ id: string }>)(
        '/api/projects',
        {
          method: 'POST',
          body: {
            name: name.value,
            slug: slug.value,
            organizationSlug: state.value.orgSlug,
          },
        },
      )
      state.value.projectId = project.id
      state.value.projectName = name.value
      state.value.projectSlug = slug.value
      next()
    } catch (err) {
      error.value = (err as Error).message ?? t('onboarding.project.error')
    } finally {
      submitting.value = false
    }
  }
</script>

<template>
  <form class="flex flex-col gap-6" @submit.prevent="submit">
    <header class="flex flex-col gap-2">
      <h1 class="m-0">{{ t('onboarding.project.title') }}</h1>
      <p class="text-tertiary m-0">
        {{ t('onboarding.project.subtitle', { org: state.orgName }) }}
      </p>
    </header>

    <div class="flex flex-col gap-4">
      <GTInput
        v-model="name"
        :label="t('onboarding.project.nameLabel')"
        :help-text="t('onboarding.project.nameHelp')"
        required
        autofocus
      />
      <GTInput
        v-model="slug"
        :label="t('onboarding.project.slugLabel')"
        :help-text="t('onboarding.project.slugHelp')"
        pattern="[a-z0-9-]+"
        required
        @input="slugTouched = true"
      />
    </div>

    <GTAlert v-if="error" variant="error" :heading="error" />

    <div class="flex justify-between">
      <GTButton type="button" variant="secondary" :disabled="submitting" @click="back">
        {{ t('onboarding.back') }}
      </GTButton>
      <GTButton type="submit" :loading="submitting" :disabled="!name || !slug">
        {{ t('onboarding.continue') }}
      </GTButton>
    </div>
  </form>
</template>
