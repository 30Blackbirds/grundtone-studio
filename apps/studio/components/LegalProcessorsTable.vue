<script setup lang="ts">
  // Databehandler-listen fra [jura]s privatlivspolitik §6 (docs/legal/
  // privatlivspolitik.{da,en}.md, infra-verificeret). Deles mellem /privacy
  // og /sub-processors så de to flader aldrig kan drifte fra hinanden —
  // juras prod-fund 2026-08-03 var netop to modstridende lister.
  const { t } = useI18n()

  const vendors = ['upcloud', 'bunny', 'stripe', 'postmark', 'sentry', 'proton'] as const
</script>

<template>
  <div class="legal-table-wrap">
    <table class="legal-table">
      <thead>
        <tr>
          <th>{{ t('processors.colVendor') }}</th>
          <th>{{ t('processors.colService') }}</th>
          <th>{{ t('processors.colEstablished') }}</th>
          <th>{{ t('processors.colLocation') }}</th>
          <th>{{ t('processors.colTransfer') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="v in vendors" :key="v">
          <td>{{ t(`processors.rows.${v}.name`) }}</td>
          <td>{{ t(`processors.rows.${v}.service`) }}</td>
          <td>{{ t(`processors.rows.${v}.established`) }}</td>
          <td>{{ t(`processors.rows.${v}.location`) }}</td>
          <td>{{ t(`processors.rows.${v}.transfer`) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
