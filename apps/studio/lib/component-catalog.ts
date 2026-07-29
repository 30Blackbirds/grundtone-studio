// Registry for the /components workbench (Storybook-style): which published
// @grundtone/vue components are showable, their controllable props (knobs)
// and how to build a copy-paste snippet from the current control state.
// Pure data + pure functions — unit-tested in component-catalog.test.ts.
// Develop-only components (GTAppShell/GTDrawer/GTConfirmDialog/GTCodeBlock/
// GTMeter/GTRichText) join once the `next` prerelease channel ships.

export interface ControlDef {
  prop: string
  type: 'select' | 'boolean' | 'text'
  options?: string[]
  default: string | boolean
}

export interface CatalogEntry {
  name: string
  group: 'Atoms' | 'Molekyler'
  controls: ControlDef[]
  /** Editable default-slot text; omitted = component takes no default slot. */
  slotText?: string
  /** Fixed props required to render (not knob-controlled), e.g. select options. */
  fixedProps?: Record<string, unknown>
  /** Component uses v-model (modelValue) — the workbench binds live state. */
  hasModel?: boolean
}

const VARIANT = (options: string[], def = options[0]!): ControlDef => ({
  prop: 'variant',
  type: 'select',
  options,
  default: def,
})
const SIZE = (options: string[], def = 'md'): ControlDef => ({
  prop: 'size',
  type: 'select',
  options,
  default: def,
})
const BOOL = (prop: string, def = false): ControlDef => ({ prop, type: 'boolean', default: def })
const TEXT = (prop: string, def: string): ControlDef => ({ prop, type: 'text', default: def })

export const COMPONENT_CATALOG: CatalogEntry[] = [
  {
    name: 'GTButton',
    group: 'Atoms',
    controls: [
      VARIANT(['primary', 'secondary', 'outlined', 'negative', 'unstyled']),
      SIZE(['sm', 'md', 'lg']),
      BOOL('loading'),
      BOOL('block'),
      BOOL('disabled'),
    ],
    slotText: 'Klik her',
  },
  {
    name: 'GTBadge',
    group: 'Atoms',
    controls: [
      VARIANT(['info', 'success', 'warning', 'error', 'neutral']),
      SIZE(['sm', 'md']),
      BOOL('dot'),
    ],
    slotText: 'Badge',
  },
  {
    name: 'GTTag',
    group: 'Atoms',
    controls: [TEXT('label', 'Tag'), SIZE(['sm', 'md']), BOOL('dismissible'), BOOL('disabled')],
  },
  {
    name: 'GTAlert',
    group: 'Molekyler',
    controls: [
      VARIANT(['info', 'success', 'warning', 'error']),
      TEXT('heading', 'Overskrift'),
      BOOL('dismissible'),
    ],
    slotText: 'Beskeden her — farverne kommer fra det valgte tema.',
  },
  {
    name: 'GTInput',
    group: 'Atoms',
    controls: [
      TEXT('label', 'Navn'),
      TEXT('placeholder', 'Skriv…'),
      SIZE(['sm', 'md', 'lg']),
      TEXT('helpText', ''),
      TEXT('errorText', ''),
      BOOL('disabled'),
      BOOL('required'),
    ],
    hasModel: true,
  },
  {
    name: 'GTSelect',
    group: 'Atoms',
    controls: [TEXT('label', 'Valg'), SIZE(['sm', 'md', 'lg']), BOOL('disabled')],
    fixedProps: {
      options: [
        { value: 'a', label: 'Første' },
        { value: 'b', label: 'Anden' },
        { value: 'c', label: 'Tredje' },
      ],
    },
    hasModel: true,
  },
  {
    name: 'GTToggle',
    group: 'Atoms',
    controls: [TEXT('label', 'Aktiveret'), SIZE(['sm', 'md']), BOOL('disabled')],
    hasModel: true,
  },
  {
    name: 'GTCheckbox',
    group: 'Atoms',
    controls: [TEXT('label', 'Accepter vilkår'), BOOL('disabled')],
    hasModel: true,
  },
  {
    name: 'GTCard',
    group: 'Molekyler',
    controls: [TEXT('title', 'Projekt-kort'), VARIANT(['raised', 'bordered', 'flat'], 'raised')],
    slotText: 'Et kort med temaets surface- og tekst-tokens.',
  },
  {
    name: 'GTDetails',
    group: 'Molekyler',
    controls: [
      TEXT('summary', 'Vis detaljer'),
      VARIANT(['default', 'subtle', 'card'], 'default'),
      BOOL('open', true),
    ],
    slotText: 'Indholdet der foldes ud.',
  },
  {
    name: 'GTTooltip',
    group: 'Molekyler',
    controls: [
      TEXT('content', 'Hjælpetekst her'),
      {
        prop: 'position',
        type: 'select',
        options: ['top', 'bottom', 'left', 'right'],
        default: 'bottom',
      },
    ],
    slotText: 'Hold musen her',
  },
  {
    name: 'GTBreadcrumb',
    group: 'Molekyler',
    controls: [TEXT('separator', '/')],
    fixedProps: {
      items: [
        { label: 'Dashboard', to: '#' },
        { label: 'Organisation', to: '#' },
        { label: 'Projekt' },
      ],
    },
  },
]

function kebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}

/**
 * Build a copy-paste template snippet from the current control state:
 * defaults are omitted, booleans render as bare attributes, non-default
 * strings as attributes, and slot text goes between the tags.
 */
export function buildSnippet(
  entry: CatalogEntry,
  state: Record<string, string | boolean>,
  slotText?: string,
): string {
  const parts: string[] = []
  for (const control of entry.controls) {
    const value = state[control.prop]
    if (value === undefined || value === control.default) continue
    if (control.type === 'boolean') {
      if (value === true) parts.push(kebab(control.prop))
    } else if (String(value).length > 0) {
      parts.push(`${kebab(control.prop)}="${value}"`)
    }
  }
  if (entry.hasModel) parts.unshift('v-model="value"')
  const attrs = parts.length ? ` ${parts.join(' ')}` : ''
  const slot = entry.slotText !== undefined ? (slotText ?? entry.slotText) : null
  return slot !== null && slot.length > 0
    ? `<${entry.name}${attrs}>${slot}</${entry.name}>`
    : `<${entry.name}${attrs} />`
}
