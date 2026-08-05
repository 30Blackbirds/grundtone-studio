<script setup lang="ts">
  // Minimal legal-oversigt: /legal er interim-target for font-licens-linket
  // (designer-krav 2026-08-04) og et naturligt indeks for de fire legal-
  // flader. Juras ToS-licenstekst får sin egen sektion/side når den lander
  // (spor hos projektleder) — indtil da henviser vi til vilkårene.
  definePageMeta({ layout: 'auth' })
  const { t } = useI18n()

  const pages = [
    { to: '/privacy', key: 'privacy' },
    { to: '/dpa', key: 'dpa' },
    { to: '/sub-processors', key: 'subProcessors' },
    { to: '/legal/cookies', key: 'cookies' },
  ] as const
</script>

<template>
  <article class="container-prose mx-auto p-6 flex flex-col gap-4">
    <header>
      <h1 class="font-heading text-3xl mt-0 mb-2">{{ t('legalIndex.title') }}</h1>
      <p class="text-tertiary m-0">{{ t('legalIndex.intro') }}</p>
    </header>

    <ul class="list-reset grid gap-3 mt-4">
      <li v-for="p in pages" :key="p.to" class="p-4 bg-surface-raised border rounded-lg">
        <NuxtLink :to="p.to" class="text-primary font-medium">
          {{ t(`legalIndex.pages.${p.key}`) }}
        </NuxtLink>
      </li>
    </ul>

    <!-- Ordret fra [jura]s §5b (docs/legal/checkout-forbrugerkrav.md, 72e02e2).
         Substansen er låst: webdistributionen SKAL nævnes eksplicit — en desktop-
         licens tillader netop det interimet bad kunden bekræfte, og udeladelsen
         betød at et sandfærdigt ja stadig kunne være licensbrud. Ret ikke her;
         ret i juras dokument. OFL-påstanden er verificeret mod alle seks
         @fontsource-pakkers license-felt (alle OFL-1.1, 2026-08-04). -->
    <h2 class="font-heading text-2xl mt-6 mb-3">{{ t('legalIndex.fontLicensesHeading') }}</h2>
    <p>{{ t('legalIndex.fontLicensesLibrary') }}</p>
    <p>{{ t('legalIndex.fontLicensesUpload') }}</p>
    <p>{{ t('legalIndex.fontLicensesWarranty') }}</p>
    <!-- Henvisningen blev fjernet, da /legal/terms ikke fandtes: en henvisning
         til en side der 404'er er vaerre end ingen. Den kommer tilbage i SAMME
         leverance som selve siden ([jura] 2026-08-05, punkt 3), saa vinduet
         aldrig opstaar igen. -->
    <p>
      {{ t('legalIndex.fontLicensesTermsRef') }}
      <NuxtLink to="/legal/terms" class="text-primary">{{
        t('legalIndex.fontLicensesTermsLink')
      }}</NuxtLink
      >.
    </p>
  </article>
</template>
