// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'

import ConfirmDialog from './ConfirmDialog.vue'

const global = {
  components: {
    GTModal: defineComponent({
      name: 'GTModal',
      props: ['open', 'title', 'persistent'],
      emits: ['update:open', 'close'],
      setup(props, { slots }) {
        return () =>
          props.open
            ? h('div', { 'data-test': 'gt-modal', 'data-title': props.title }, [
                slots.default?.(),
                slots.footer?.(),
              ])
            : null
      },
    }),
    GTButton: defineComponent({
      name: 'GTButton',
      props: ['variant', 'loading', 'disabled'],
      emits: ['click'],
      setup(props, { slots, emit }) {
        return () =>
          h(
            'button',
            {
              'data-test': 'gt-button',
              'data-variant': props.variant,
              disabled: props.disabled || undefined,
              onClick: () => emit('click'),
            },
            slots.default?.(),
          )
      },
    }),
  },
  mocks: { $t: (k: string) => k },
}

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(ConfirmDialog, {
    props: { open: true, title: 'Remove member?', ...props },
    global,
  })
}

describe('ConfirmDialog', () => {
  it('renders title and message when open', () => {
    const w = mountDialog({ message: 'This cannot be undone.' })
    expect(w.get('[data-test="gt-modal"]').attributes('data-title')).toBe('Remove member?')
    expect(w.text()).toContain('This cannot be undone.')
  })

  it('renders nothing when closed', () => {
    const w = mountDialog({ open: false })
    expect(w.find('[data-test="gt-modal"]').exists()).toBe(false)
  })

  it('emits confirm WITHOUT closing — caller closes on success', async () => {
    const w = mountDialog()
    const [, confirmBtn] = w.findAll('[data-test="gt-button"]')
    await confirmBtn.trigger('click')
    expect(w.emitted('confirm')).toHaveLength(1)
    expect(w.emitted('update:open')).toBeUndefined()
  })

  it('cancel emits cancel + update:open(false)', async () => {
    const w = mountDialog()
    const [cancelBtn] = w.findAll('[data-test="gt-button"]')
    await cancelBtn.trigger('click')
    expect(w.emitted('cancel')).toHaveLength(1)
    expect(w.emitted('update:open')).toEqual([[false]])
  })

  it('destructive renders a negative confirm button', () => {
    const w = mountDialog({ destructive: true })
    const [, confirmBtn] = w.findAll('[data-test="gt-button"]')
    expect(confirmBtn.attributes('data-variant')).toBe('negative')
  })

  it('cancel is blocked while loading', async () => {
    const w = mountDialog({ loading: true })
    const [cancelBtn] = w.findAll('[data-test="gt-button"]')
    await cancelBtn.trigger('click')
    expect(w.emitted('cancel')).toBeUndefined()
    expect(w.emitted('update:open')).toBeUndefined()
  })
})
