<script setup lang="ts">
  import { organization } from '~~/lib/auth-client'

  definePageMeta({ layout: 'app' })

  const { t } = useI18n()

  const { data: orgs, refresh } = await useAsyncData('orgs', async () => {
    const res = await organization.list({
      fetchOptions: {
        headers: useRequestHeaders(['cookie']) as HeadersInit,
      },
    })
    return res.data ?? []
  })

  const showCreate = ref(false)
  const orgName = ref('')
  const orgSlug = ref('')
  const creating = ref(false)
  const error = ref<string | null>(null)

  async function create() {
    creating.value = true
    error.value = null
    const res = await organization.create({ name: orgName.value, slug: orgSlug.value })
    creating.value = false
    if (res.error) {
      error.value = res.error.message ?? t('orgs.createError')
      return
    }
    showCreate.value = false
    orgName.value = ''
    orgSlug.value = ''
    await refresh()
  }
</script>

<template>
  <section class="p-6">
    <header class="flex justify-between items-center mb-6">
      <h1 class="m-0">{{ t('orgs.title') }}</h1>
      <GTButton v-if="!showCreate" @click="showCreate = true">{{ t('orgs.new') }}</GTButton>
    </header>

    <form
      v-if="showCreate"
      class="flex flex-col gap-4 p-4 mb-6 bg-surface-raised border rounded-lg"
      @submit.prevent="create"
    >
      <div class="grid grid-cols-2 gap-3">
        <GTInput v-model="orgName" :label="t('orgs.nameLabel')" required />
        <GTInput v-model="orgSlug" :label="t('orgs.slugLabel')" required pattern="[a-z0-9-]+" />
      </div>
      <GTAlert v-if="error" variant="error" :heading="error" />
      <div class="flex gap-3 justify-end">
        <GTButton type="button" variant="secondary" @click="showCreate = false">
          {{ t('app.cancel') }}
        </GTButton>
        <GTButton type="submit" :loading="creating">{{ t('app.create') }}</GTButton>
      </div>
    </form>

    <ul v-if="orgs && orgs.length" class="list-reset grid gap-2">
      <li v-for="org in orgs" :key="org.id">
        <NuxtLink
          :to="`/orgs/${org.slug}`"
          class="flex items-baseline gap-3 p-4 bg-surface-raised border rounded-lg no-underline text-inherit"
        >
          <strong>{{ org.name }}</strong>
          <span class="text-tertiary text-sm">{{ org.slug }}</span>
        </NuxtLink>
      </li>
    </ul>
    <p v-else class="text-tertiary">{{ t('orgs.empty') }}</p>
  </section>
</template>
