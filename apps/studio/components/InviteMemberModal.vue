<script setup lang="ts">
  // ONE invite pattern for org AND project scope (redesign R5,
  // redesign-r5-members-invite.html — UX-audit finding #11: the two flows had
  // drifted apart). The caller parameterises via `roles` and handles the
  // actual API call; the selected role's description renders inline under the
  // select (always visible, not a tooltip — designer's call).
  export interface InviteRoleOption {
    value: string
    label: string
    description: string
  }

  const props = defineProps<{
    open: boolean
    title: string
    roles: InviteRoleOption[]
    defaultRole: string
    loading?: boolean
    error?: string | null
  }>()

  const emit = defineEmits<{
    'update:open': [value: boolean]
    submit: [payload: { email: string; role: string }]
  }>()

  const { t } = useI18n()

  const email = ref('')
  const role = ref(props.defaultRole)

  // Reset per open so a cancelled invite doesn't leak into the next one.
  watch(
    () => props.open,
    (open) => {
      if (open) {
        email.value = ''
        role.value = props.defaultRole
      }
    },
  )

  const selectedDescription = computed(
    () => props.roles.find((r) => r.value === role.value)?.description ?? '',
  )

  function close() {
    if (props.loading) return
    emit('update:open', false)
  }
</script>

<template>
  <GTModal :open="open" :title="title" :persistent="loading" @update:open="close" @close="close">
    <form
      id="invite-member-form"
      class="flex flex-col gap-4"
      @submit.prevent="emit('submit', { email, role })"
    >
      <GTInput
        v-model="email"
        type="email"
        :label="t('auth.email')"
        required
        autocomplete="email"
      />
      <GTSelect
        v-model="role"
        :label="t('invite.role')"
        :options="roles.map((r) => ({ value: r.value, label: r.label }))"
      />
      <p class="text-tertiary text-sm m-0">{{ selectedDescription }}</p>
      <GTAlert v-if="error" variant="error" :heading="error" />
    </form>
    <template #footer>
      <div class="flex gap-3 justify-end">
        <GTButton type="button" variant="secondary" :disabled="loading" @click="close">
          {{ t('app.cancel') }}
        </GTButton>
        <GTButton type="submit" form="invite-member-form" :loading="loading">
          {{ t('invite.send') }}
        </GTButton>
      </div>
    </template>
  </GTModal>
</template>
