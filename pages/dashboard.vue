<script setup lang="ts">
  import { organization } from '~~/lib/auth-client'

  definePageMeta({ layout: 'app' })

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
    const res = await organization.create({
      name: orgName.value,
      slug: orgSlug.value,
    })
    creating.value = false
    if (res.error) {
      error.value = res.error.message ?? 'Failed to create organization'
      return
    }
    showCreate.value = false
    orgName.value = ''
    orgSlug.value = ''
    await refresh()
  }
</script>

<template>
  <section>
    <header class="page-header">
      <h1>Organizations</h1>
      <button v-if="!showCreate" @click="showCreate = true">New organization</button>
    </header>

    <form v-if="showCreate" class="inline-form" @submit.prevent="create">
      <label>
        Name
        <input v-model="orgName" type="text" required />
      </label>
      <label>
        Slug
        <input v-model="orgSlug" type="text" required pattern="[a-z0-9-]+" />
      </label>
      <button type="submit" :disabled="creating">{{ creating ? 'Creating…' : 'Create' }}</button>
      <button type="button" @click="showCreate = false">Cancel</button>
      <p v-if="error" class="error">{{ error }}</p>
    </form>

    <ul v-if="orgs && orgs.length" class="org-list">
      <li v-for="org in orgs" :key="org.id">
        <NuxtLink :to="`/orgs/${org.slug}`">
          <strong>{{ org.name }}</strong>
          <span class="muted">{{ org.slug }}</span>
        </NuxtLink>
      </li>
    </ul>
    <p v-else class="muted">No organizations yet.</p>
  </section>
</template>
