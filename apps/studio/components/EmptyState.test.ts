// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'

import EmptyState from './EmptyState.vue'

// 🔴 WHY A MOUNT TEST AND NOT A BROWSER MEASUREMENT. The empty state is, by
// definition, what a list looks like when it has nothing — and the seeded
// design-review fixture has a project, so /dashboard and /orgs/<slug> never
// render it. Rather than claim a browser check I did not make, or fake the
// fixture into an empty state it cannot otherwise reach, this pins the
// contract: the icon is decorative, the title is text, and a caller's action
// survives into the markup.
//
// It does NOT measure layout — happy-dom does no layout — so the centring and
// spacing are unverified on screen. Stated here rather than implied.

const GTIcon = defineComponent({
  name: 'GTIcon',
  props: ['name', 'size'],
  setup: (p) => () => h('svg', { 'data-icon': p.name }),
})

function mountEmpty(slots?: { default: string }) {
  return mount(EmptyState, {
    props: { icon: 'folder', title: 'No projects yet', body: 'Create one to get started.' },
    slots,
    global: { components: { GTIcon } },
  })
}

describe('EmptyState', () => {
  it('renders the icon, the title and the body', () => {
    const w = mountEmpty()
    expect(w.find('[data-icon="folder"]').exists()).toBe(true)
    expect(w.text()).toContain('No projects yet')
    expect(w.text()).toContain('Create one to get started.')
  })

  it('hides the icon from assistive tech, because the title carries the meaning', () => {
    const w = mountEmpty()
    expect(w.find('.empty-state__icon').attributes('aria-hidden')).toBe('true')
  })

  it('renders a caller action, and omits the wrapper when there is none', () => {
    const withAction = mountEmpty({ default: '<button>Create project</button>' })
    expect(withAction.find('.empty-state__action button').text()).toBe('Create project')

    const without = mountEmpty()
    expect(
      without.find('.empty-state__action').exists(),
      'an empty action wrapper would add stray spacing under the text',
    ).toBe(false)
  })

  it('omits the body paragraph when the caller gives none', () => {
    const w = mount(EmptyState, {
      props: { icon: 'folder', title: 'Nothing here' },
      global: { components: { GTIcon } },
    })
    expect(w.find('.empty-state__body').exists()).toBe(false)
  })
})
