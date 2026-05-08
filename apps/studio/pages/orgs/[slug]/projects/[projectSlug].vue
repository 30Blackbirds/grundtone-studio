<script setup lang="ts">
  definePageMeta({ layout: 'app' })

  const { t } = useI18n()
  const route = useRoute()
  const slug = computed(() => route.params.slug as string)
  const projectSlug = computed(() => route.params.projectSlug as string)

  const { data: project } = await useAsyncData(
    () => `project-${slug.value}-${projectSlug.value}`,
    async () => {
      const projects = (await $fetch('/api/projects', {
        headers: useRequestHeaders(['cookie']),
        query: { organizationSlug: slug.value },
      })) as { id: string; slug: string; name: string }[]
      return projects.find((p) => p.slug === projectSlug.value) ?? null
    },
  )
</script>

<template>
  <section class="p-6">
    <nav class="flex gap-2 text-tertiary text-sm mb-4">
      <NuxtLink to="/dashboard">{{ t('orgs.title') }}</NuxtLink>
      <span>/</span>
      <NuxtLink :to="`/orgs/${slug}`">{{ t('projects.title') }}</NuxtLink>
      <span>/</span>
      <span>{{ project?.name ?? projectSlug }}</span>
    </nav>

    <header class="mb-6">
      <h1 class="m-0">{{ project?.name ?? projectSlug }}</h1>
      <p class="text-tertiary mt-2">{{ t('project.placeholder') }}</p>
    </header>

    <GTAlert variant="info" :heading="t('project.comingSoon')">
      {{ t('project.comingSoonBody') }}
    </GTAlert>
  </section>
</template>
