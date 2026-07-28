<script setup lang="ts">
  // Interim mirror of GTConfirmDialog (@grundtone/vue develop, unreleased).
  // Same props/emits contract, so the swap to the real component is a rename
  // once the `next` prerelease channel ships. Wraps the published GTModal.
  const props = withDefaults(
    defineProps<{
      open: boolean
      title: string
      message?: string
      confirmLabel?: string
      cancelLabel?: string
      destructive?: boolean
      loading?: boolean
    }>(),
    {
      message: undefined,
      confirmLabel: undefined,
      cancelLabel: undefined,
      destructive: false,
      loading: false,
    },
  )

  const emit = defineEmits<{
    'update:open': [value: boolean]
    confirm: []
    cancel: []
  }>()

  const { t } = useI18n()

  function onCancel() {
    if (props.loading) return
    emit('cancel')
    emit('update:open', false)
  }

  // Confirm deliberately does NOT auto-close: the caller closes on success so
  // the dialog can show a loading state and stay open on failure.
  function onConfirm() {
    emit('confirm')
  }
</script>

<template>
  <GTModal
    :open="open"
    :title="title"
    :persistent="loading"
    @update:open="(v: boolean) => (v ? emit('update:open', true) : onCancel())"
    @close="onCancel"
  >
    <p v-if="message" class="m-0">{{ message }}</p>
    <slot />
    <template #footer>
      <div class="flex gap-2 justify-end">
        <GTButton variant="outlined" :disabled="loading" @click="onCancel">
          {{ cancelLabel ?? t('confirm.cancel') }}
        </GTButton>
        <GTButton
          :variant="destructive ? 'negative' : 'primary'"
          :loading="loading"
          @click="onConfirm"
        >
          {{ confirmLabel ?? t('confirm.confirm') }}
        </GTButton>
      </div>
    </template>
  </GTModal>
</template>
