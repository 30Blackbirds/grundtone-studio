import withNuxt from './.nuxt/eslint.config.mjs'

import tsParser from '@typescript-eslint/parser'

// withNuxt 1.15.2 + eslint 10 sætter vue-eslint-parser men delegerer ikke
// <script lang="ts">-blokke til en TS-parser, så type-aliases o.l. får
// "Unexpected token"-fejl. Vi sætter parserOptions.parser eksplicit på
// nuxt/vue/rules-blokken (og dropper '@typescript-eslint/no-explicit-any'
// rule-ref'en der peger på et plugin der ikke er loadet).
export default withNuxt({
  // 🔴 The committed SDK contract versions are PUBLISHED ARTEFACTS, not source
  // (KH-991). They are served byte for byte and pinned by customers with SRI,
  // so an autofix here would change a hash someone depends on. They are built
  // output in any case — minified UMD/ESM bundles, which is why eslint reports
  // `define is not defined` and an exported `var`. Ignored rather than fixed.
  ignores: ['sdk-contract/**'],
})
  .append({
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
