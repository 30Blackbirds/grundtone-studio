<script setup lang="ts">
  import { diffTokens, isColorPath } from '~~/utils/token-diff'

  const props = defineProps<{ projectId: string; canManage: boolean }>()
  const emit = defineEmits<{ activated: [] }>()
  const { t } = useI18n()

  interface VersionRow {
    id: string
    version: number
    status: 'draft' | 'published'
    publishedAt: string | null
    createdAt: string
    tokensJson: Record<string, unknown>
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

  const toast = useToast()
  const activatingId = ref<string | null>(null)
  const pendingActivateId = ref<string | null>(null)

  async function confirmActivate() {
    const versionId = pendingActivateId.value
    if (!versionId) return
    activatingId.value = versionId
    try {
      await $fetch(`/api/projects/${props.projectId}/activate`, {
        method: 'POST',
        body: { versionId },
      })
      await refresh()
      pendingActivateId.value = null
      toast.success(t('toasts.versionActivated'))
      emit('activated')
    } catch (err) {
      // Active-brand cap (riff bfxmm7xktk6xkfanh5eennva): shown as a plan limit.
      // Every other failure is rethrown, so its handling is unchanged.
      const data = (err as { data?: { data?: { code?: string; limit?: number } } }).data?.data
      if (data?.code !== 'brand_quota_exceeded') throw err
      pendingActivateId.value = null
      toast.info(t('quota.brandBody', { limit: data.limit ?? 0 }))
    } finally {
      activatingId.value = null
    }
  }

  const published = computed(
    () => data.value?.versions.filter((v) => v.status === 'published') ?? [],
  )
  const draft = computed(() => data.value?.versions.find((v) => v.status === 'draft') ?? null)

  // Token-level diff vs the PREVIOUS published version (UX-audit finding #9).
  // `published` is version-descending, so the predecessor sits at index+1;
  // the oldest version diffs against {} and reads as "everything added".
  function changesFor(index: number) {
    const current = published.value[index]
    const previous = published.value[index + 1]
    return diffTokens(previous?.tokensJson ?? {}, current.tokensJson ?? {})
  }
  const changesByIndex = computed(() => published.value.map((_, i) => changesFor(i)))
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
          v-for="(v, index) in published"
          :key="v.id"
          class="p-4 bg-surface-raised border rounded-lg"
        >
          <div class="flex justify-between items-center">
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
                @click="pendingActivateId = v.id"
              >
                {{ t('versions.activate') }}
              </GTButton>
            </div>
          </div>

          <GTDetails
            v-if="changesByIndex[index].length"
            class="mt-3"
            :summary="
              index === published.length - 1
                ? t('versions.diffFirst', { n: changesByIndex[index].length })
                : t('versions.diffSummary', { n: changesByIndex[index].length })
            "
          >
            <ul class="list-reset flex flex-col gap-1 mt-2">
              <li
                v-for="c in changesByIndex[index]"
                :key="c.path"
                class="flex items-center gap-2 text-sm font-mono"
              >
                <GTBadge :variant="c.kind === 'removed' ? 'warning' : 'neutral'">
                  {{ t(`versions.diff.${c.kind}`) }}
                </GTBadge>
                <span>{{ c.path }}</span>
                <span v-if="c.from" class="flex items-center gap-1 text-tertiary">
                  <!-- Swatches show the versions' own stored color values — data,
                       not theming (same precedent as the dashboard grid). -->
                  <span
                    v-if="isColorPath(c.path)"
                    class="dash-swatch"
                    :style="{ background: c.from }"
                    aria-hidden="true"
                  />
                  {{ c.from }}
                </span>
                <span v-if="c.from && c.to" class="text-tertiary" aria-hidden="true">→</span>
                <span v-if="c.to" class="flex items-center gap-1">
                  <span
                    v-if="isColorPath(c.path)"
                    class="dash-swatch"
                    :style="{ background: c.to }"
                    aria-hidden="true"
                  />
                  {{ c.to }}
                </span>
              </li>
            </ul>
          </GTDetails>
        </li>
      </ul>
      <p v-else class="text-tertiary">{{ t('versions.empty') }}</p>
    </section>

    <ConfirmDialog
      :open="pendingActivateId !== null"
      :title="t('versions.activate')"
      :message="t('versions.confirmActivate')"
      :confirm-label="t('versions.activate')"
      :loading="activatingId !== null"
      @confirm="confirmActivate"
      @update:open="(v: boolean) => !v && (pendingActivateId = null)"
    />
  </div>
</template>
