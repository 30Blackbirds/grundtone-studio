<script setup lang="ts">
  import { organization } from '~~/lib/auth-client'

  definePageMeta({ layout: 'app' })

  const { t } = useI18n()
  const route = useRoute()
  const router = useRouter()
  const slug = computed(() => route.params.slug as string)

  const { activeOrg, isOwner, canManageOrgMembers } = useOrgContext()

  const canAccess = computed(() => canManageOrgMembers.value)

  const orgName = ref(activeOrg.value?.name ?? '')
  const orgSlug = ref(slug.value)
  const saving = ref(false)
  const saveError = ref<string | null>(null)
  const saved = ref(false)

  const deleteConfirm = ref('')
  const deleting = ref(false)
  const deleteError = ref<string | null>(null)

  watchEffect(() => {
    orgName.value = activeOrg.value?.name ?? ''
    orgSlug.value = slug.value
  })

  async function save() {
    if (!activeOrg.value?.id || !canAccess.value) return
    saving.value = true
    saveError.value = null
    saved.value = false
    const res = await organization.update({
      organizationId: activeOrg.value.id,
      data: { name: orgName.value, slug: orgSlug.value },
    })
    saving.value = false
    if (res.error) {
      saveError.value = res.error.message ?? t('orgSettings.error')
      return
    }
    saved.value = true
    if (orgSlug.value !== slug.value) {
      await router.replace(`/orgs/${orgSlug.value}/settings`)
    }
  }

  async function deleteOrg() {
    if (!activeOrg.value?.id || !isOwner.value) return
    if (deleteConfirm.value !== slug.value) return
    deleting.value = true
    deleteError.value = null
    const res = await organization.delete({ organizationId: activeOrg.value.id })
    deleting.value = false
    if (res.error) {
      deleteError.value = res.error.message ?? t('orgSettings.deleteError')
      return
    }
    await navigateTo('/dashboard')
  }
</script>

<template>
  <section v-if="canAccess" class="p-6 max-w-2xl">
    <nav class="flex gap-2 text-tertiary text-sm mb-4">
      <NuxtLink to="/dashboard">{{ t('orgs.title') }}</NuxtLink>
      <span>/</span>
      <NuxtLink :to="`/orgs/${slug}`">{{ activeOrg?.name ?? slug }}</NuxtLink>
      <span>/</span>
      <span>{{ t('orgSettings.title') }}</span>
    </nav>

    <h1 class="m-0 mb-6">{{ t('orgSettings.title') }}</h1>

    <GTCard :title="t('orgSettings.title')" class="mb-6">
      <form class="flex flex-col gap-4" @submit.prevent="save">
        <GTInput v-model="orgName" :label="t('orgSettings.nameLabel')" required />
        <GTInput
          v-model="orgSlug"
          :label="t('orgSettings.slugLabel')"
          required
          pattern="[a-z0-9-]+"
        />
        <GTAlert v-if="saved" variant="success" :heading="t('orgSettings.saved')" />
        <GTAlert v-if="saveError" variant="error" :heading="saveError" />
        <div class="flex justify-end">
          <GTButton type="submit" :loading="saving">{{ t('app.save') }}</GTButton>
        </div>
      </form>
    </GTCard>

    <GTCard v-if="isOwner" :title="t('orgSettings.deleteTitle')" class="border-error">
      <p class="text-tertiary">{{ t('orgSettings.deleteBody') }}</p>
      <form class="flex flex-col gap-4 mt-4" @submit.prevent="deleteOrg">
        <GTInput
          v-model="deleteConfirm"
          :label="t('orgSettings.deleteConfirm', { slug })"
          required
        />
        <GTAlert v-if="deleteError" variant="error" :heading="deleteError" />
        <GTButton
          type="submit"
          variant="outlined"
          :loading="deleting"
          :disabled="deleteConfirm !== slug"
        >
          {{ t('orgSettings.deleteSubmit') }}
        </GTButton>
      </form>
    </GTCard>
  </section>
  <section v-else class="p-6">
    <GTAlert variant="error" :heading="t('orgSettings.error')" />
  </section>
</template>
