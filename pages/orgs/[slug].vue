<script setup lang="ts">
  import { organization } from '~~/lib/auth-client'

  definePageMeta({ layout: 'app' })

  const route = useRoute()
  const slug = computed(() => route.params.slug as string)

  const { data: org } = await useAsyncData(`org-${slug.value}`, async () => {
    const res = await organization.getFullOrganization({
      query: { organizationSlug: slug.value },
      fetchOptions: { headers: useRequestHeaders(['cookie']) as HeadersInit },
    })
    return res.data
  })

  watchEffect(async () => {
    if (org.value?.id) {
      await organization.setActive({ organizationId: org.value.id })
    }
  })

  const { data: projects, refresh } = await useAsyncData(`projects-${slug.value}`, async () => {
    return await $fetch('/api/projects', {
      headers: useRequestHeaders(['cookie']),
      query: { organizationSlug: slug.value },
    })
  })

  const showCreate = ref(false)
  const projName = ref('')
  const projSlug = ref('')
  const creating = ref(false)
  const error = ref<string | null>(null)

  async function create() {
    creating.value = true
    error.value = null
    try {
      await $fetch('/api/projects', {
        method: 'POST',
        body: { name: projName.value, slug: projSlug.value, organizationSlug: slug.value },
      })
      showCreate.value = false
      projName.value = ''
      projSlug.value = ''
      await refresh()
    } catch (err) {
      error.value = (err as Error).message
    } finally {
      creating.value = false
    }
  }
</script>

<template>
  <section>
    <nav class="flex gap-2 text-tertiary text-sm mb-4">
      <NuxtLink to="/dashboard">Organizations</NuxtLink>
      <span>/</span>
      <span>{{ org?.name ?? slug }}</span>
    </nav>

    <header class="flex justify-between items-center mb-6">
      <h1 class="m-0">Projects</h1>
      <GTButton v-if="!showCreate" @click="showCreate = true">New project</GTButton>
    </header>

    <form
      v-if="showCreate"
      class="flex flex-col gap-4 p-4 mb-6 bg-surface-raised border rounded-lg"
      @submit.prevent="create"
    >
      <div class="grid grid-cols-2 gap-3">
        <GTInput v-model="projName" label="Name" required />
        <GTInput v-model="projSlug" label="Slug" required pattern="[a-z0-9-]+" />
      </div>
      <GTAlert v-if="error" variant="error" :heading="error" />
      <div class="flex gap-3 justify-end">
        <GTButton type="button" variant="secondary" @click="showCreate = false">Cancel</GTButton>
        <GTButton type="submit" :loading="creating">Create</GTButton>
      </div>
    </form>

    <ul v-if="projects && projects.length" class="list-reset grid gap-2">
      <li
        v-for="p in projects"
        :key="p.id"
        class="flex items-baseline gap-3 p-4 bg-surface-raised border rounded-lg"
      >
        <strong>{{ p.name }}</strong>
        <span class="text-tertiary text-sm">{{ p.slug }}</span>
      </li>
    </ul>
    <p v-else class="text-tertiary">No projects yet.</p>
  </section>
</template>
