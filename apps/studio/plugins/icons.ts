import { iconRegistry } from '@grundtone/icons'
import { GT_ICON_REGISTRY_KEY } from '@grundtone/vue'

/**
 * Provides the icon registry every `<GTIcon name="…">` resolves against.
 *
 * Riff KH-1114. Without this, Icon.vue logs "[GTIcon] No icon registry
 * provided" on every page load and the icons fall back to nothing. It is a
 * documented consumer step (apps/docs/icons/vue.md, including this Nuxt
 * variant) that studio had simply never performed: `@grundtone/nuxt`
 * auto-imports the KEY but provides no registry, so the omission surfaced only
 * as a console warning — visible to whoever reads the console, invisible to
 * everyone else.
 */
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.provide(GT_ICON_REGISTRY_KEY, iconRegistry)
})
