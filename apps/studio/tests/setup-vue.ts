// Global stubs for component tests. Nuxt auto-imports Vue's composition
// helpers (computed, ref, watch, etc.) so SFCs use them without an
// explicit import. Vitest doesn't run Nuxt's resolver, so we stub the
// relevant globals here. Loaded via vitest.config.ts → test.setupFiles.

import { vi } from 'vitest'
import {
  computed,
  ref,
  reactive,
  shallowRef,
  watch,
  watchEffect,
  onMounted,
  onBeforeUnmount,
  onBeforeMount,
  onUpdated,
  onUnmounted,
  defineProps,
  defineEmits,
  defineModel,
  useTemplateRef,
  nextTick,
  toRef,
  toRefs,
  unref,
  isRef,
} from 'vue'

const VUE_AUTO_IMPORTS = {
  computed,
  ref,
  reactive,
  shallowRef,
  watch,
  watchEffect,
  onMounted,
  onBeforeUnmount,
  onBeforeMount,
  onUpdated,
  onUnmounted,
  defineProps,
  defineEmits,
  defineModel,
  useTemplateRef,
  nextTick,
  toRef,
  toRefs,
  unref,
  isRef,
}

for (const [name, fn] of Object.entries(VUE_AUTO_IMPORTS)) {
  vi.stubGlobal(name, fn)
}

// Default useI18n stub — tests that want a richer i18n surface override
// per-file via their own vi.stubGlobal('useI18n', ...). Returns the key
// verbatim so test assertions stay stable.
vi.stubGlobal('useI18n', () => ({ t: (k: string) => k, d: (v: unknown) => String(v) }))
