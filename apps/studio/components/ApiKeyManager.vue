<script setup lang="ts">
  const props = defineProps<{ projectId: string; canManage: boolean }>()
  const { t } = useI18n()

  interface ApiKeyRow {
    id: string
    keyPrefix: string
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
  const DEFAULT_RATE_LIMIT = String(DEFAULT_INT_RATE_LIMIT)

  const showCreate = ref(false)
  const newEnv = ref<'live' | 'test'>('live')
  const newOrigins = ref('')
  // GTInput's model is string-typed even for type="number". Store as string,
  // parse to int at submit time. Default '1000' matches the DB-level default
  // so a no-change user gets the same plan as before this field was editable.
  const newRateLimit = ref<string>(DEFAULT_RATE_LIMIT)
  const creating = ref(false)
  const createError = ref<string | null>(null)
  const createdPlaintext = ref<string | null>(null)
  const copyState = ref<'idle' | 'copied'>('idle')

  async function createKey() {
    creating.value = true
    createError.value = null
    try {
      const res = await $fetch<{ plaintext: string; keyPrefix: string }>(
        `/api/projects/${props.projectId}/api-keys`,
        {
          method: 'POST',
          body: {
            environment: newEnv.value,
            allowedOrigins: newOrigins.value
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean),
            // Server clamps to [1, 1_000_000] and defaults to 1000 if
            // omitted; we pass through whatever the user entered.
            rateLimit: Math.max(1, parseInt(newRateLimit.value, 10) || DEFAULT_INT_RATE_LIMIT),
          },
        },
      )
      createdPlaintext.value = res.plaintext
      newOrigins.value = ''
      newEnv.value = 'live'
      newRateLimit.value = DEFAULT_RATE_LIMIT
      await refresh()
    } catch (err) {
      createError.value = (err as Error).message
    } finally {
      creating.value = false
    }
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

  async function revoke(keyId: string) {
    if (!confirm(t('apiKeys.confirmRevoke'))) return
    await $fetch(`/api/projects/${props.projectId}/api-keys/${keyId}`, { method: 'DELETE' })
    await refresh()
  }

  const activeKeys = computed(() => (keys.value ?? []).filter((k) => !k.revokedAt))
  const revokedKeys = computed(() => (keys.value ?? []).filter((k) => k.revokedAt))

  // First active key drives the install snippet UI. New plaintext shown once
  // takes precedence so the snippet matches what the user is about to copy.
  const snippetKey = computed(
    () => createdPlaintext.value ?? activeKeys.value[0]?.keyPrefix ?? null,
  )
</script>

<template>
  <div class="flex flex-col gap-6">
    <header class="flex justify-between items-center">
      <div class="flex items-center gap-2">
        <h2 class="m-0">{{ t('apiKeys.title') }}</h2>
        <GTTooltip :content="t('apiKeys.whatIsItTooltip')" position="bottom">
          <button type="button" class="text-tertiary" :aria-label="t('apiKeys.whatIsItLabel')">
            <GTIcon name="info" size="sm" />
          </button>
        </GTTooltip>
      </div>
      <GTButton v-if="canManage && !showCreate && !createdPlaintext" @click="showCreate = true">
        {{ t('apiKeys.create') }}
      </GTButton>
    </header>

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
        v-model="newEnv"
        :label="t('apiKeys.environment')"
        :options="[
          { value: 'live', label: t('apiKeys.envLive') },
          { value: 'test', label: t('apiKeys.envTest') },
        ]"
      />
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
          class="flex justify-between items-center p-4 bg-surface-raised border rounded-lg"
        >
          <div class="flex flex-col gap-1">
            <code class="font-mono text-sm">{{ k.keyPrefix }}…</code>
            <span class="text-tertiary text-sm">
              {{ t(`apiKeys.env${k.environment === 'live' ? 'Live' : 'Test'}`) }} ·
              {{ k.allowedOrigins.length ? k.allowedOrigins.join(', ') : t('apiKeys.anyOrigin') }} ·
              {{ t('apiKeys.rateLimitBadge', { n: k.rateLimit }) }}
            </span>
          </div>
          <GTButton v-if="canManage" variant="outlined" size="sm" @click="revoke(k.id)">
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
  </div>
</template>
