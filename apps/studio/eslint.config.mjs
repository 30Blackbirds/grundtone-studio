import withNuxt from './.nuxt/eslint.config.mjs'

import tsParser from '@typescript-eslint/parser'

// withNuxt 1.15.2 + eslint 10 sætter vue-eslint-parser men delegerer ikke
// <script lang="ts">-blokke til en TS-parser, så type-aliases o.l. får
// "Unexpected token"-fejl. Vi sætter parserOptions.parser eksplicit på
// nuxt/vue/rules-blokken (og dropper '@typescript-eslint/no-explicit-any'
// rule-ref'en der peger på et plugin der ikke er loadet).
export default withNuxt({
  rules: {
    'vue/multi-word-component-names': 'off',
  },
}).override('nuxt/vue/rules', {
  languageOptions: {
    parserOptions: {
      parser: tsParser,
    },
  },
  rules: {
    'vue/html-self-closing': [
      'error',
      {
        html: { void: 'always', normal: 'always', component: 'always' },
      },
    ],
  },
})
