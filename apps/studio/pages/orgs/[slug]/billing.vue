<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { PLAN_CATALOG, type PlanDef } from '~~/lib/plan-catalog'
  import type { BillingInvoice, BillingSubscription } from '~~/server/lib/billing-read'
  import type { DashboardPayload } from '~~/server/lib/dashboard'

  definePageMeta({ layout: 'app' })

  // Client-rendered like the rest of /orgs/** (routeRules ssr:false).
  // Pixel-forlæg: billing-plan-management.html v2 + _wireframe-nav-ia.html §3.
  const { t, te, d } = useI18n()
  const route = useRoute()
  const slug = computed(() => route.params.slug as string)
  const { activeOrg, canManageBilling } = useOrgContext()

  interface Overview {
    available: boolean
    subscription: BillingSubscription | null
    invoices: BillingInvoice[]
    memberCount: number
  }

  const { data: overview } = await useAsyncData<Overview>(
    () => `billing-${slug.value}`,
    () =>
      $fetch<Overview>('/api/billing/overview', {
        query: { organizationSlug: slug.value },
        headers: useRequestHeaders(['cookie']),
      }),
    { default: () => ({ available: false, subscription: null, invoices: [], memberCount: 0 }) },
  )

  const { data: dash } = await useAsyncData<DashboardPayload>(
    () => `billing-usage-${slug.value}`,
    () => $fetch<DashboardPayload>('/api/dashboard', { headers: useRequestHeaders(['cookie']) }),
    { default: () => ({ orgs: [], projects: [], activity: [] }) },
  )

  // "Aktivt brand" = publiceret projekt (kontrakt-§0: countet er vores DB).
  const activeBrands = computed(
    () =>
      dash.value.projects.filter((p) => p.orgSlug === slug.value && p.status === 'published')
        .length,
  )

  const subscription = computed(() => overview.value.subscription)
  const plan = computed<PlanDef | null>(
    () => PLAN_CATALOG.find((p) => p.key === subscription.value?.planKey) ?? null,
  )
  const planName = computed(() =>
    plan.value ? t(`plans.names.${plan.value.key}`) : (subscription.value?.planKey ?? ''),
  )

  const brandsIncluded = computed(() => plan.value?.brandsIncluded ?? null)
  const extraBrands = computed(() =>
    brandsIncluded.value !== null ? Math.max(0, activeBrands.value - brandsIncluded.value) : 0,
  )
  const overageEur = computed(() =>
    plan.value?.overageEurPerBrand != null ? extraBrands.value * plan.value.overageEurPerBrand : 0,
  )
  const atHardCap = computed(
    () =>
      Boolean(plan.value?.hardCap) &&
      brandsIncluded.value !== null &&
      activeBrands.value >= brandsIncluded.value,
  )
  const meterPct = computed(() => {
    if (brandsIncluded.value === null) return 8
    return Math.min(100, Math.round((activeBrands.value / brandsIncluded.value) * 100))
  })

  // Næste faktura beregnes lokalt: base fra §7-spejlet + overage fra egen
  // count × katalog-sats (kontrakten leverer bevidst ikke et estimat-felt).
  const nextInvoiceEur = computed(() => {
    if (!subscription.value) return null
    return subscription.value.priceMinor / 100 + overageEur.value
  })

  const upgradeTarget = computed(() => {
    const order = PLAN_CATALOG.filter((p) => p.purchasable).map((p) => p.key)
    const idx = plan.value ? order.indexOf(plan.value.key) : -1
    return idx >= 0 && idx < order.length - 1 ? order[idx + 1]! : null
  })

  function formatMinor(amountMinor: number, currency: string) {
    return new Intl.NumberFormat('da-DK', { style: 'currency', currency }).format(amountMinor / 100)
  }

  function invoiceStatusLabel(status: string) {
    return te(`billing.invoiceStatus.${status}`) ? t(`billing.invoiceStatus.${status}`) : status
  }

  const portalPending = ref(false)
  async function openStripePortal() {
    portalPending.value = true
    try {
      const { portalUrl } = await $fetch<{ portalUrl: string }>('/api/billing/portal-session', {
        method: 'POST',
        body: { organizationSlug: slug.value },
      })
      window.location.href = portalUrl
    } catch {
      portalPending.value = false
    }
  }
</script>

<template>
  <section class="p-6">
    <header class="mb-6">
      <h1 class="m-0">{{ t('billing.title') }}</h1>
      <p class="text-tertiary mt-1 text-sm m-0">{{ activeOrg?.name ?? slug }}</p>
    </header>

    <GTAlert v-if="!canManageBilling" variant="error" :heading="t('billing.forbidden')" />

    <template v-else>
      <GTAlert
        v-if="!overview.available"
        variant="info"
        :heading="t('billing.unavailable')"
        class="mb-4"
      >
        {{ t('billing.unavailableBody') }}
      </GTAlert>

      <div class="billing-grid mb-6">
        <!-- Plan + forbrug -->
        <div class="p-4 bg-surface-raised border rounded-lg">
          <div class="flex items-center gap-2 mb-1">
            <strong class="text-lg">{{ planName || t('billing.noPlan') }}</strong>
            <GTBadge v-if="subscription" variant="info">{{
              t(`billing.state.${subscription.planState}`)
            }}</GTBadge>
          </div>
          <p v-if="subscription" class="text-tertiary text-sm mt-0 mb-4">
            {{ formatMinor(subscription.priceMinor, subscription.currency) }}/{{
              t('plans.confirm.monthly').toLowerCase()
            }}
            <template v-if="subscription.renewsAt">
              · {{ t('billing.renews', { date: d(new Date(subscription.renewsAt), 'short') }) }}
            </template>
            <template v-if="subscription.cancelAtPeriodEnd">
              · {{ t('billing.cancelsAtPeriodEnd') }}
            </template>
          </p>

          <!-- Brands-meter: tier-afhængigt (forlægget) — overage-planer viser
               synlig friktion, hård-grænse-planer viser "Grænse nået",
               grænseløse planer kun tallet. Interim meter-markup; swappes til
               GTMeter når next-prereleasen shipper. -->
          <div class="mb-4">
            <div class="flex justify-between text-sm mb-1">
              <span>{{ t('billing.activeBrands') }}</span>
              <strong v-if="brandsIncluded === null">
                {{ activeBrands }} · {{ t('billing.unlimited') }}
              </strong>
              <strong v-else-if="overageEur > 0">
                {{ t('billing.usageOf', { used: activeBrands, limit: brandsIncluded }) }} · +€{{
                  overageEur
                }}/{{ t('billing.perMonthShort') }}
              </strong>
              <strong v-else class="flex items-center gap-2">
                {{ t('billing.usageOf', { used: activeBrands, limit: brandsIncluded }) }}
                <GTBadge v-if="atHardCap" variant="warning" size="sm">
                  {{ t('billing.capReached') }}
                </GTBadge>
              </strong>
            </div>
            <div class="billing-meter" :class="{ 'billing-meter--warn': overageEur > 0 }">
              <i :style="{ width: `${meterPct}%` }" />
            </div>
            <p v-if="overageEur > 0" class="text-tertiary text-xs mt-1 mb-0">
              {{
                t('billing.overageNote', {
                  n: extraBrands,
                  rate: plan?.overageEurPerBrand,
                  total: overageEur,
                })
              }}
            </p>
          </div>

          <div class="mb-4">
            <div class="flex justify-between text-sm mb-1">
              <span>{{ t('billing.members') }}</span>
              <strong>{{ overview.memberCount }} · {{ t('billing.unlimited') }}</strong>
            </div>
            <div class="billing-meter billing-meter--min"><i /></div>
          </div>

          <div class="flex gap-2">
            <GTButton v-if="upgradeTarget" size="sm" @click="navigateTo(`/plans?org=${slug}`)">
              {{ t('billing.upgradeTo', { plan: t(`plans.names.${upgradeTarget}`) }) }}
            </GTButton>
            <GTButton variant="secondary" size="sm" @click="navigateTo(`/plans?org=${slug}`)">
              {{ t('billing.seePlans') }}
            </GTButton>
          </div>
        </div>

        <!-- Side-kort: næste faktura + betalingsmetode (§7a) -->
        <div class="flex flex-col gap-3">
          <div class="p-4 bg-surface-raised border rounded-lg">
            <p class="text-xs uppercase text-tertiary tracking-wide m-0 mb-1">
              {{ t('billing.nextInvoice') }}
            </p>
            <template v-if="subscription && nextInvoiceEur !== null">
              <strong class="text-lg">€{{ nextInvoiceEur.toFixed(2) }}</strong>
              <p class="text-tertiary text-xs m-0">
                <template v-if="subscription.renewsAt">
                  {{ d(new Date(subscription.renewsAt), 'short') }} ·
                </template>
                {{
                  overageEur > 0
                    ? t('billing.nextInvoiceSplit', {
                        base: subscription.priceMinor / 100,
                        overage: overageEur,
                      })
                    : t('billing.nextInvoiceBase')
                }}
              </p>
            </template>
            <p v-else class="text-tertiary text-sm m-0">—</p>
          </div>
          <div class="p-4 bg-surface-raised border rounded-lg">
            <p class="text-xs uppercase text-tertiary tracking-wide m-0 mb-1">
              {{ t('billing.paymentMethod') }}
              <span class="billing-label-suffix"> — {{ t('billing.lastRegistered') }}</span>
            </p>
            <template v-if="subscription?.paymentMethod">
              <strong class="billing-brand">
                {{ subscription.paymentMethod.brand }} •••• {{ subscription.paymentMethod.last4 }}
              </strong>
              <p class="text-tertiary text-xs m-0 mt-1">
                <GTButton
                  variant="unstyled"
                  size="sm"
                  :loading="portalPending"
                  @click="openStripePortal"
                >
                  {{ t('billing.updateViaStripe') }}
                </GTButton>
                · {{ t('billing.updatesNextInvoice') }}
              </p>
            </template>
            <p v-else class="text-tertiary text-sm m-0">—</p>
          </div>
        </div>
      </div>

      <!-- Fakturahistorik -->
      <h2 class="text-xs uppercase text-tertiary tracking-wide mb-2">
        {{ t('billing.invoiceHistory') }}
      </h2>
      <div
        v-if="overview.invoices.length"
        class="bg-surface-raised border rounded-lg overflow-x-auto"
      >
        <table class="billing-tbl">
          <thead>
            <tr>
              <th>{{ t('billing.colDate') }}</th>
              <th>{{ t('billing.colDescription') }}</th>
              <th>{{ t('billing.colAmount') }}</th>
              <th>{{ t('billing.colStatus') }}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="inv in overview.invoices" :key="inv.invoiceRef">
              <td>{{ d(new Date(inv.issuedAt), 'short') }}</td>
              <td class="font-mono text-sm">{{ inv.invoiceRef }}</td>
              <td class="font-mono text-sm">{{ formatMinor(inv.amountMinor, inv.currency) }}</td>
              <td>
                <GTBadge :variant="inv.status === 'paid' ? 'success' : 'neutral'">
                  {{ invoiceStatusLabel(inv.status) }}
                </GTBadge>
              </td>
              <td>
                <a v-if="inv.hostedUrl" :href="inv.hostedUrl" target="_blank" rel="noopener">
                  {{ t('billing.receipt') }}
                </a>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="text-tertiary text-sm">{{ t('billing.noInvoices') }}</p>
    </template>
  </section>
</template>
