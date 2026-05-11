<script setup lang="ts">
  const props = defineProps<{ projectId: string; canManage: boolean }>()
  const emit = defineEmits<{ activated: [] }>()
  const { t } = useI18n()

  interface VersionRow {
    id: string
    version: number
    status: 'draft' | 'published'
    publishedAt: string | null
    createdAt: string
  }

  interface VersionsResponse {
    versions: VersionRow[]
    activeVersionId: string | null
  }

  const { data, refresh } = await useAsyncData<VersionsResponse>(
    () => `versions-${props.projectId}`,
    () =>
      $fetch<VersionsResponse>(`/api/projects/${props.projectId}/versions`, {
        headers: useRequestHeaders(['cookie']),
      }),
    { default: () => ({ versions: [], activeVersionId: null }) },
  )

  const activatingId = ref<string | null>(null)

  async function activate(versionId: string) {
    if (!confirm(t('versions.confirmActivate'))) return
    activatingId.value = versionId
    try {
      await $fetch(`/api/projects/${props.projectId}/activate`, {
        method: 'POST',
        body: { versionId },
      })
      await refresh()
      emit('activated')
    } finally {
      activatingId.value = null
    }
  }

  const published = computed(
    () => data.value?.versions.filter((v) => v.status === 'published') ?? [],
  )
  const draft = computed(() => data.value?.versions.find((v) => v.status === 'draft') ?? null)
</script>

<template>
  <div class="flex flex-col gap-6">
    <h2 class="m-0">{{ t('versions.title') }}</h2>

    <section v-if="draft">
      <h3 class="text-sm uppercase text-tertiary tracking-wide mb-3">{{ t('versions.draft') }}</h3>
      <div class="p-4 bg-surface-raised border rounded-lg">
        <p class="m-0">
          <strong>{{ t('versions.draftLabel') }}</strong>
          <span class="text-tertiary text-sm ml-2">
            {{ t('versions.editedOn', { date: new Date(draft.createdAt).toLocaleString() }) }}
          </span>
        </p>
      </div>
    </section>

    <section>
      <h3 class="text-sm uppercase text-tertiary tracking-wide mb-3">
        {{ t('versions.published') }}
      </h3>
      <ul v-if="published.length" class="list-reset grid gap-2">
        <li
          v-for="v in published"
          :key="v.id"
          class="flex justify-between items-center p-4 bg-surface-raised border rounded-lg"
        >
          <div class="flex flex-col gap-1">
            <strong>v{{ v.version }}</strong>
            <span class="text-tertiary text-sm">
              {{ t('versions.publishedOn', { date: new Date(v.publishedAt!).toLocaleString() }) }}
            </span>
          </div>
          <div class="flex items-center gap-3">
            <GTBadge v-if="data?.activeVersionId === v.id" variant="success">
              {{ t('versions.active') }}
            </GTBadge>
            <GTButton
              v-else-if="canManage"
              variant="secondary"
              size="sm"
              :loading="activatingId === v.id"
              @click="activate(v.id)"
            >
              {{ t('versions.activate') }}
            </GTButton>
          </div>
        </li>
      </ul>
      <p v-else class="text-tertiary">{{ t('versions.empty') }}</p>
    </section>
  </div>
</template>
