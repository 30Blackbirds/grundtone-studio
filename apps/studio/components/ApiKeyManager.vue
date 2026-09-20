<script setup lang="ts">
  const props = defineProps<{ projectId: string; canManage: boolean }>()
  const { t, d } = useI18n()

  interface ApiKeyRow {
    id: string
    keyPrefix: string
    keyType: 'publishable' | 'secret'
    environment: 'live' | 'test'
    allowedOrigins: string[]
    rateLimit: number
    lastUsedAt: string | null
    revokedAt: string | null
    createdAt: string
  }

  const { data: keys, refresh } = await useAsyncData<ApiKeyRow[]>(
    () => `api-keys-${props.projectId}`,
    () =>
      $fetch<ApiKeyRow[]>(`/api/projects/${props.projectId}/api-keys`, {
        headers: useRequestHeaders(['cookie']),
      }),
    { default: () => [] },
  )

  const DEFAULT_INT_RATE_LIMIT = 1000
  const MAX_RATE_LIMIT = 1_000_000
  const DEFAULT_RATE_LIMIT = String(DEFAULT_INT_RATE_LIMIT)

  // Coerce the user's input safely. parseInt('1e6') returns 1 (it stops at
  // the 'e'), and the number input legitimately emits scientific notation
  // for large values — so Number() handles that. NaN / Infinity fall back
  // to the default. Result is clamped to [1, MAX] so out-of-range values
  // never reach the server (which 400s on min/max violations).
  function coerceRateLimit(v: string): number {
    const n = Number(v)
    if (!Number.isFinite(n)) return DEFAULT_INT_RATE_LIMIT
    return Math.max(1, Math.min(MAX_RATE_LIMIT, Math.floor(n)))
  }

  const showCreate = ref(false)
  const newEnv = ref<'live' | 'test'>('live')
  const newKeyType = ref<'publishable' | 'secret'>('publishable')
  const newOrigins = ref('')
  // GTInput's model is string-typed even for type="number". Store as string,
  // coerce + clamp at submit time. Default '1000' matches the DB-level default
  // so a no-change user gets the same plan as before this field was editable.
  const newRateLimit = ref<string>(DEFAULT_RATE_LIMIT)
  const creating = ref(false)
  const createError = ref<string | null>(null)
  const createdPlaintext = ref<string | null>(null)
  // Carried alongside the plaintext so the install snippet (CDN-only) never
  // renders a secret key, which is a server/CLI credential, not a URL token.
  const createdKeyType = ref<'publishable' | 'secret'>('publishable')
  const copyState = ref<'idle' | 'copied'>('idle')
  const idCopyState = ref<'idle' | 'copied'>('idle')

  async function createKey() {
    creating.value = true
    createError.value = null
    try {
      const res = await $fetch<{ plaintext: string; keyPrefix: string; keyType: string }>(
        `/api/projects/${props.projectId}/api-keys`,
        {
          method: 'POST',
          body: {
            environment: newEnv.value,
            keyType: newKeyType.value,
            allowedOrigins: newOrigins.value
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean),
            // Server validates [1, 1_000_000] and 400s on violation; we
            // coerce + clamp client-side so out-of-range values never round-
            // trip. Also handles scientific notation from the number input.
            rateLimit: coerceRateLimit(newRateLimit.value),
          },
        },
      )
      createdPlaintext.value = res.plaintext
      createdKeyType.value = newKeyType.value
      newOrigins.value = ''
      newEnv.value = 'live'
      newKeyType.value = 'publishable'
      newRateLimit.value = DEFAULT_RATE_LIMIT
      await refresh()
    } catch (err) {
      createError.value = (err as Error).message
    } finally {
      creating.value = false
    }
  }

  async function copyProjectId() {
    await navigator.clipboard.writeText(props.projectId)
    idCopyState.value = 'copied'
    setTimeout(() => (idCopyState.value = 'idle'), 2000)
  }

  async function copyPlaintext() {
    if (!createdPlaintext.value) return
    await navigator.clipboard.writeText(createdPlaintext.value)
    copyState.value = 'copied'
    setTimeout(() => (copyState.value = 'idle'), 2000)
  }

  function dismissPlaintext() {
    createdPlaintext.value = null
    showCreate.value = false
  }

  const toast = useToast()
  const pendingRevokeId = ref<string | null>(null)
  const revoking = ref(false)

  async function confirmRevoke() {
    if (!pendingRevokeId.value) return
    revoking.value = true
    try {
      await $fetch(`/api/projects/${props.projectId}/api-keys/${pendingRevokeId.value}`, {
        method: 'DELETE',
      })
      await refresh()
      pendingRevokeId.value = null
      toast.success(t('toasts.keyRevoked'))
    } finally {
      revoking.value = false
    }
  }

  const activeKeys = computed(() => (keys.value ?? []).filter((k) => !k.revokedAt))
  const revokedKeys = computed(() => (keys.value ?? []).filter((k) => k.revokedAt))

  // First active publishable key drives the install snippet UI (the CDN
  // /k route is publishable-only). A freshly created publishable key takes
  // precedence so the snippet matches what the user is about to copy; secret
  // keys are server/CLI credentials and never belong in the CDN snippet.
  const snippetKey = computed(() => {
    if (createdPlaintext.value && createdKeyType.value !== 'secret') return createdPlaintext.value
    return activeKeys.value.find((k) => k.keyType !== 'secret')?.keyPrefix ?? null
  })
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex justify-between items-center">
      <div class="flex items-center gap-2">
        <h2 class="m-0">{{ t('apiKeys.title') }}</h2>
        <GTTooltip :content="t('apiKeys.whatIsItTooltip')" position="bottom">
          <button type="button" class="text-tertiary" :aria-label="t('apiKeys.whatIsItLabel')">
            <GTIcon name="info-circle" size="sm" />
          </button>
        </GTTooltip>
      </div>
      <GTButton v-if="canManage && !showCreate && !createdPlaintext" @click="showCreate = true">
        {{ t('apiKeys.create') }}
      </GTButton>
    </header>

    <!-- In-app-hjælp v1 (launch-krav): pk/sk-forvekslingen er support-driver
         #2 — den foldbare forklaring bor over tabellen hvor nøglerne vælges. -->
    <GTDetails :summary="t('help.keysHelp.summary')" variant="subtle">
      <ul class="m-0 pl-4 text-sm flex flex-col gap-2">
        <li>{{ t('help.keysHelp.pk') }}</li>
        <li>{{ t('help.keysHelp.sk') }}</li>
      </ul>
    </GTDetails>

    <div class="flex justify-between items-center gap-4 p-4 bg-surface-raised border rounded-lg">
      <div class="flex flex-col gap-1 min-w-0">
        <span class="text-sm uppercase text-tertiary tracking-wide">
          {{ t('apiKeys.projectId') }}
        </span>
        <code class="font-mono text-sm break-all">{{ projectId }}</code>
        <span class="text-tertiary text-sm">{{ t('apiKeys.projectIdHelp') }}</span>
      </div>
      <GTButton variant="outlined" size="sm" @click="copyProjectId">
        {{ idCopyState === 'copied' ? t('apiKeys.idCopied') : t('apiKeys.copyId') }}
      </GTButton>
    </div>

    <GTAlert v-if="createdPlaintext" variant="warning" :heading="t('apiKeys.shownOnce')">
      <p class="mt-0">{{ t('apiKeys.shownOnceBody') }}</p>
      <code class="block p-3 bg-surface border rounded font-mono text-sm break-all">
        {{ createdPlaintext }}
      </code>
      <div class="flex gap-3 mt-4">
        <GTButton variant="primary" size="sm" @click="copyPlaintext">
          {{ copyState === 'copied' ? t('apiKeys.copied') : t('apiKeys.copy') }}
        </GTButton>
        <GTButton variant="secondary" size="sm" @click="dismissPlaintext">
          {{ t('apiKeys.dismiss') }}
        </GTButton>
      </div>
    </GTAlert>

    <form
      v-if="showCreate && !createdPlaintext"
      class="flex flex-col gap-4 p-4 bg-surface-raised border rounded-lg"
      @submit.prevent="createKey"
    >
      <GTSelect
        v-model="newKeyType"
        :label="t('apiKeys.keyType')"
        :help-text="t('apiKeys.keyTypeHelp')"
        :options="[
          { value: 'publishable', label: t('apiKeys.typePublishable') },
          { value: 'secret', label: t('apiKeys.typeSecret') },
        ]"
      />
      <GTSelect
        v-model="newEnv"
        :label="t('apiKeys.environment')"
        :options="[
          { value: 'live', label: t('apiKeys.envLive') },
          { value: 'test', label: t('apiKeys.envTest') },
        ]"
      />
      <!-- Origins + rate limit are CDN concerns; secret keys are server/CLI
           credentials that never hit the CDN /k route, so we hide them. -->
      <template v-if="newKeyType !== 'secret'">
        <GTTextarea
          v-model="newOrigins"
          :label="t('apiKeys.allowedOrigins')"
          :help-text="t('apiKeys.allowedOriginsHelp')"
          placeholder="acme.com&#10;*.acme.com"
          :rows="3"
        />
        <GTInput
          v-model="newRateLimit"
          type="number"
          :label="t('apiKeys.rateLimit')"
          :help-text="t('apiKeys.rateLimitHelp')"
          :min="1"
          :max="1_000_000"
          :step="100"
        />
      </template>
      <GTAlert v-if="createError" variant="error" :heading="createError" />
      <div class="flex gap-3 justify-end">
        <GTButton type="button" variant="secondary" @click="showCreate = false">
          {{ t('app.cancel') }}
        </GTButton>
        <GTButton type="submit" :loading="creating">{{ t('apiKeys.generate') }}</GTButton>
      </div>
    </form>

    <section>
      <h3 class="text-sm uppercase text-tertiary tracking-wide mb-3">
        {{ t('apiKeys.active') }}
      </h3>
      <ul v-if="activeKeys.length" class="list-reset grid gap-2">
        <li
          v-for="k in activeKeys"
          :key="k.id"
          class="flex justify-between items-center gap-3 p-4 bg-surface-raised border rounded-lg"
        >
          <div class="flex flex-col gap-1 min-w-0">
            <span class="flex flex-wrap items-center gap-2 min-w-0">
              <code class="api-key__prefix font-mono text-sm">{{ k.keyPrefix }}…</code>
              <GTBadge v-if="k.keyType === 'secret'" variant="warning">
                {{ t('apiKeys.secretBadge') }}
              </GTBadge>
              <!-- Environment badge + explainer tooltip (UX-audit #14: the
                   live/test distinction was shown but never explained). -->
              <GTTooltip :content="t('apiKeys.envTooltip')" position="bottom">
                <GTBadge :variant="k.environment === 'live' ? 'success' : 'neutral'">
                  {{ t(`apiKeys.env${k.environment === 'live' ? 'Live' : 'Test'}`) }}
                </GTBadge>
              </GTTooltip>
            </span>
            <span class="text-tertiary text-sm">
              <template v-if="k.keyType !== 'secret'">
                {{ k.allowedOrigins.length ? k.allowedOrigins.join(', ') : t('apiKeys.anyOrigin') }}
                · {{ t('apiKeys.rateLimitBadge', { n: k.rateLimit }) }} ·
              </template>
              {{
                k.lastUsedAt
                  ? t('apiKeys.lastUsed', { date: d(new Date(k.lastUsedAt), 'short') })
                  : t('apiKeys.neverUsed')
              }}
            </span>
          </div>
          <GTButton v-if="canManage" variant="outlined" size="sm" @click="pendingRevokeId = k.id">
            {{ t('apiKeys.revoke') }}
          </GTButton>
        </li>
      </ul>
      <p v-else class="text-tertiary">{{ t('apiKeys.empty') }}</p>
    </section>

    <section v-if="revokedKeys.length">
      <h3 class="text-sm uppercase text-tertiary tracking-wide mb-3">
        {{ t('apiKeys.revoked') }}
      </h3>
      <ul class="list-reset grid gap-2">
        <li
          v-for="k in revokedKeys"
          :key="k.id"
          class="flex items-center p-4 bg-surface border rounded-lg opacity-60"
        >
          <code class="font-mono text-sm">{{ k.keyPrefix }}…</code>
        </li>
      </ul>
    </section>

    <hr />
    <InstallSnippet :api-key="snippetKey" />

    <ConfirmDialog
      :open="pendingRevokeId !== null"
      :title="t('apiKeys.revoke')"
      :message="t('apiKeys.confirmRevoke')"
      :confirm-label="t('apiKeys.revoke')"
      destructive
      :loading="revoking"
      @confirm="confirmRevoke"
      @update:open="(v: boolean) => !v && (pendingRevokeId = null)"
    />
  </div>
</template>
