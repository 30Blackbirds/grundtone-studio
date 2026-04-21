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

// Set as active org on load
watchEffect(async () => {
  if (org.value?.id) {
    await organization.setActive({ organizationId: org.value.id })
  }
})

const { data: projects, refresh } = await useAsyncData(
  `projects-${slug.value}`,
  async () => {
    return await $fetch('/api/projects', {
      headers: useRequestHeaders(['cookie']),
      query: { organizationSlug: slug.value },
    })
  },
)

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
    <nav class="crumbs">
      <NuxtLink to="/dashboard">Organizations</NuxtLink>
      <span>/</span>
      <span>{{ org?.name ?? slug }}</span>
    </nav>

    <header class="page-header">
      <h1>Projects</h1>
      <button v-if="!showCreate" @click="showCreate = true">New project</button>
    </header>

    <form v-if="showCreate" class="inline-form" @submit.prevent="create">
      <label>
        Name
        <input v-model="projName" type="text" required />
      </label>
      <label>
        Slug
        <input v-model="projSlug" type="text" required pattern="[a-z0-9-]+" />
      </label>
      <button type="submit" :disabled="creating">{{ creating ? 'Creating…' : 'Create' }}</button>
      <button type="button" @click="showCreate = false">Cancel</button>
      <p v-if="error" class="error">{{ error }}</p>
    </form>

    <ul v-if="projects && projects.length" class="org-list">
      <li v-for="p in projects" :key="p.id">
        <strong>{{ p.name }}</strong>
        <span class="muted">{{ p.slug }}</span>
      </li>
    </ul>
    <p v-else class="muted">No projects yet.</p>
  </section>
</template>
