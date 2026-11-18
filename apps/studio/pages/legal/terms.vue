<script setup lang="ts">
  // Juras abonnementsvilkaar, version studio-tos-1.0 (Allan-godkendt 2026-08-04).
  // Kilden er docs/legal/studio-abonnementsvilkaar.md i 30Blackbirds/docs — denne
  // side er KUN rendering. Aendringer i teksten skal gaa gennem juras dokument
  // foerst; i18n-noeglerne er udledt af kilden, ikke skrevet af.
  //
  // DANSK-KUN, med vilje ([jura] 2026-08-05, dokumentets 1b): dansk er det
  // aftalte aftalesprog. Naar `en` er aktivt, vises en ENGELSK note om netop
  // det — en dansk note om at teksten er dansk er ubrugelig for den laeser, den
  // er skrevet til. Engelsk version skal foreligge foer foerste ikke-dansk-
  // talende kunde tegner abonnement; det er en gate, ikke en dato.
  //
  // Advokat-gaten staar IKKE paa siden. Den er intern: det, der venter paa
  // advokaten, er ikrafttraeden over for betalende kunder, ikke om siden maa
  // vaere laesbar. En note til kunden om at vores egne vilkaar afventer advokat
  // ville skabe praecis den usikkerhed, vilkaarene findes for at fjerne.
  definePageMeta({ layout: 'auth' })
  const { t } = useI18n()

  // Afsnits-noegler pr. paragraf. Understykker (a-d i §6.3) haenger under deres
  // afsnit, saa raekkefoelgen i kilden bevares.
  // Afsnit som objekter frem for en opslags-map: understykker (a-d i §6.3)
  // haenger paa deres eget afsnit, saa raekkefoelgen i kilden bevares og
  // typen ikke kraever et indeks-opslag der ikke kan bevises.
  const SECTIONS = [
    { n: 1, bullets: [], paras: [{ p: '1' }, { p: '2' }, { p: '3' }] },
    { n: 2, bullets: ['1', '2', '3', '4'], paras: [] },
    { n: 3, bullets: [], paras: [{ p: '1' }, { p: '2' }, { p: '3' }] },
    { n: 4, bullets: [], paras: [{ p: '1' }, { p: '2' }, { p: '3' }, { p: '4' }] },
    { n: 5, bullets: [], paras: [{ p: '1' }, { p: '2' }, { p: '3' }, { p: '4' }, { p: '5' }] },
    {
      n: 6,
      bullets: [],
      paras: [{ p: '1' }, { p: '2' }, { p: '3', subs: ['a', 'b', 'c', 'd'] }, { p: '4' }],
    },
    { n: 7, bullets: [], paras: [{ p: '1' }, { p: '2' }, { p: '3' }, { p: '4' }] },
    { n: 8, bullets: [], paras: [{ p: '1' }, { p: '2' }] },
    { n: 9, bullets: [], paras: [{ p: '1' }, { p: '2' }] },
    { n: 10, bullets: [], paras: [{ p: '1' }, { p: '2' }, { p: '3' }, { p: '4' }] },
    { n: 11, bullets: [], paras: [{ p: '1' }, { p: '2' }, { p: '3' }] },
    { n: 12, bullets: [], paras: [{ p: '1' }, { p: '2' }, { p: '3' }, { p: '4' }] },
    { n: 13, bullets: [], paras: [{ p: '1' }, { p: '2' }, { p: '3' }, { p: '4' }, { p: '5' }] },
    { n: 14, bullets: [], paras: [{ p: '1' }, { p: '2' }, { p: '3' }] },
    { n: 15, bullets: [], paras: [{ p: '1' }, { p: '2' }, { p: '3' }] },
    { n: 16, bullets: [], paras: [{ p: '1' }] },
  ] as { n: number; bullets: string[]; paras: { p: string; subs?: string[] }[] }[]

  const langNotice = computed(() => t('terms.langNotice'))
</script>

<template>
  <article class="container-prose mx-auto p-6 flex flex-col gap-4">
    <header>
      <h1 class="font-heading text-3xl mt-0 mb-2">{{ t('terms.title') }}</h1>
      <p class="text-tertiary m-0">{{ t('terms.versionLine') }}</p>
    </header>

    <!-- Vises kun paa engelsk: dansk er aftalesproget, saa den danske laeser
         har ingen note at faa. Mail-adressen ligger i templaten, ikke i
         i18n-strengen — raa @ i en vue-i18n-message er linked-message-syntaks
         og knaekker builden. -->
    <GTAlert v-if="langNotice" variant="info" class="my-2">
      {{ langNotice }}
      <a href="mailto:privacy@klanghaus.dk" class="text-primary">privacy@klanghaus.dk</a>.
    </GTAlert>

    <section v-for="s in SECTIONS" :key="s.n" class="flex flex-col gap-2">
      <h2 class="font-heading text-2xl mt-6 mb-1">{{ s.n }}. {{ t(`terms.s${s.n}h`) }}</h2>

      <ul v-if="s.bullets.length" class="pl-6 flex flex-col gap-1">
        <li v-for="b in s.bullets" :key="b">
          <LegalText :text="t(`terms.s${s.n}b${b}`)" />
        </li>
      </ul>

      <template v-for="para in s.paras" :key="para.p">
        <p class="m-0">
          <span class="text-tertiary">{{ s.n }}.{{ para.p }}.</span>
          <LegalText :text="t(`terms.s${s.n}p${para.p}`)" />
          <!-- §12.4 henviser til databehandleraftalen; kildens repo-sti er
               erstattet af et link til den publicerede side. -->
          <template v-if="s.n === 12 && para.p === '4'">
            Se <NuxtLink to="/dpa" class="text-primary">{{ t('terms.dpaLinkText') }}</NuxtLink
            >.
          </template>
        </p>
        <ul v-if="para.subs" class="pl-6 flex flex-col gap-1">
          <li v-for="sub in para.subs" :key="sub">
            <span class="text-tertiary">{{ sub }})</span>
            <LegalText :text="t(`terms.s${s.n}p${para.p}${sub}`)" />
          </li>
        </ul>
      </template>
    </section>
  </article>
</template>
