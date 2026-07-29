<script setup lang="ts">
  import { ref, computed } from 'vue'
  import { PLAN_CATALOG, SHOW_PRICE_LOCK_LINE, getPlan, type PlanKey } from '~~/lib/plan-catalog'
  import type { DashboardPayload } from '~~/server/lib/dashboard'

  definePageMeta({ layout: 'app' })
  const { t } = useI18n()
  const route = useRoute()

  const { data: dash } = await useAsyncData<DashboardPayload>(
    'plans-orgs',
    () => $fetch<DashboardPayload>('/api/dashboard', { headers: useRequestHeaders(['cookie']) }),
    { default: () => ({ orgs: [], projects: [], activity: [] }) },
  )
  const orgOptions = computed(() => dash.value.orgs.map((o) => ({ value: o.slug, label: o.name })))
  const selectedOrg = ref(
    typeof route.query.org === 'string' ? route.query.org : (dash.value.orgs[0]?.slug ?? ''),
  )

  // Stage 2→3 (designer's upgrade-flow v2): choosing a paid plan opens the
  // pre-checkout summary; "continue" relays through our checkout endpoint and
  // redirects to Stripe's hosted page. Free → dashboard, Enterprise → mail.
  const confirmPlan = ref<PlanKey | null>(null)
  const confirmDef = computed(() => (confirmPlan.value ? getPlan(confirmPlan.value) : null))
  const submitting = ref(false)
  const checkoutError = ref<'billing_unavailable' | 'checkout_failed' | null>(null)

  function choose(key: PlanKey) {
    checkoutError.value = null
    confirmPlan.value = key
  }

  async function continueToCheckout() {
    if (!confirmPlan.value || !selectedOrg.value) return
    submitting.value = true
    checkoutError.value = null
    try {
      const { checkoutUrl } = await $fetch<{ checkoutUrl: string }>(
        '/api/billing/checkout-session',
        {
          method: 'POST',
          body: { organizationSlug: selectedOrg.value, planKey: confirmPlan.value },
        },
      )
      window.location.href = checkoutUrl
    } catch (err) {
      const code = (err as { data?: { data?: { code?: string } } }).data?.data?.code
      checkoutError.value =
        code === 'billing_unavailable' ? 'billing_unavailable' : 'checkout_failed'
    } finally {
      submitting.value = false
    }
  }
</script>

<template>
  <section class="p-6">
    <header class="text-center mb-6">
      <GTBadge variant="warning">{{ t('plans.introBadge') }}</GTBadge>
      <h1 class="mt-3 mb-2">{{ t('plans.title') }}</h1>
      <p class="text-tertiary m-0">{{ t('plans.lead') }}</p>
      <p v-if="SHOW_PRICE_LOCK_LINE" class="text-tertiary text-sm mt-2 mb-0">
        {{ t('plans.priceLock') }}
      </p>
      <div v-if="orgOptions.length > 1" class="plans-org-select mt-4">
        <GTSelect
          v-model="selectedOrg"
          :label="t('plans.orgSelect')"
          :options="orgOptions"
          size="sm"
        />
      </div>
    </header>

    <div class="plans-grid">
      <article
        v-for="plan in PLAN_CATALOG"
        :key="plan.key"
        class="plan-card bg-surface-raised border rounded-lg p-4 flex flex-col"
        :class="{ 'plan-card--rec': plan.highlighted }"
      >
        <span v-if="plan.highlighted" class="plan-card__flag">{{ t('plans.popular') }}</span>
        <h2 class="text-sm m-0 mb-1 flex items-center gap-2">
          {{ t(`plans.names.${plan.key}`) }}
          <GTBadge v-if="plan.isNew" variant="warning" size="sm">{{ t('plans.new') }}</GTBadge>
        </h2>
        <p class="plan-card__price m-0">
          <template v-if="plan.priceEur === 0">€0</template>
          <template v-else-if="plan.priceEur !== null">
            €{{ plan.priceEur }}<span class="text-tertiary text-sm">{{ t('plans.perMonth') }}</span>
          </template>
          <template v-else>{{ t('plans.custom') }}</template>
        </p>
        <div class="bg-surface rounded p-2 my-3 text-sm">
          <template v-if="plan.key === 'studio_free'">
            <strong>{{ t('plans.freeBrands', { n: plan.brandsIncluded }) }}</strong>
            <p class="m-0 text-tertiary text-xs">{{ t('plans.freeSub') }}</p>
          </template>
          <template v-else-if="plan.brandsIncluded !== null">
            <strong>{{ t('plans.brandsIncluded', { n: plan.brandsIncluded }) }}</strong>
            <p v-if="plan.overageEurPerBrand !== null" class="m-0 text-tertiary text-xs">
              {{ t('plans.overage', { n: plan.overageEurPerBrand }) }}
            </p>
            <p v-else-if="plan.hardCap" class="m-0 mt-1">
              <GTBadge variant="warning" size="sm">{{ t('plans.hardCap') }}</GTBadge>
            </p>
          </template>
          <template v-else>
            <strong>{{ t('plans.custom') }}</strong>
            <p class="m-0 text-tertiary text-xs">{{ t('plans.noBrandCap') }}</p>
          </template>
        </div>

        <template v-if="plan.key === 'studio_free'">
          <GTButton variant="secondary" size="sm" block @click="navigateTo('/dashboard')">
            {{ t('plans.ctaFree') }}
          </GTButton>
        </template>
        <template v-else-if="plan.purchasable">
          <GTButton
            :variant="plan.highlighted ? 'primary' : 'secondary'"
            size="sm"
            block
            @click="choose(plan.key)"
          >
            {{ t('plans.ctaChoose', { plan: t(`plans.names.${plan.key}`) }) }}
          </GTButton>
        </template>
        <template v-else>
          <GTButton
            variant="secondary"
            size="sm"
            block
            @click="navigateTo('mailto:hello@grundtone.com', { external: true })"
          >
            {{ t('plans.ctaContact') }}
          </GTButton>
        </template>

        <ul class="list-reset mt-4 text-sm flex flex-col gap-1">
          <li
            v-for="feature in plan.features"
            :key="feature.labelKey"
            :class="feature.included ? 'plan-feat--yes' : 'plan-feat--no text-tertiary'"
          >
            {{ t(`plans.features.${feature.labelKey}`) }}
          </li>
        </ul>
        <p
          v-if="plan.key === 'studio_enterprise'"
          class="text-tertiary text-xs bg-surface rounded p-2 mt-3 mb-0"
        >
          {{ t('plans.ssoNote') }}
        </p>
      </article>
    </div>

    <footer class="text-center bg-surface rounded-lg p-4 mt-6">
      <strong>{{ t('plans.memberCta') }}</strong>
      <p class="text-tertiary text-sm m-0 mt-1">{{ t('plans.memberCtaSub') }}</p>
    </footer>

    <!-- In-app-hjælp v1 (launch-krav): kvote-/plan-spørgsmålene er support-
         driver #3 — svarene bor på siden hvor plan-beslutningen tages. -->
    <section class="plans-faq mt-6">
      <h2 class="text-sm uppercase text-tertiary tracking-wide">{{ t('help.plansFaq.title') }}</h2>
      <GTDetails :summary="t('help.plansFaq.brandQ')" variant="subtle">
        <p class="m-0 text-sm">{{ t('help.plansFaq.brandA') }}</p>
      </GTDetails>
      <GTDetails :summary="t('help.plansFaq.switchQ')" variant="subtle">
        <p class="m-0 text-sm">{{ t('help.plansFaq.switchA') }}</p>
      </GTDetails>
      <GTDetails :summary="t('help.plansFaq.limitQ')" variant="subtle">
        <p class="m-0 text-sm">{{ t('help.plansFaq.limitA') }}</p>
      </GTDetails>
    </section>

    <!-- Stage 3: pre-checkout summary (last step before Stripe's hosted page) -->
    <GTModal
      :open="confirmPlan !== null"
      :title="t('plans.confirm.title')"
      @update:open="(v: boolean) => (confirmPlan = v ? confirmPlan : null)"
    >
      <template v-if="confirmDef">
        <p class="text-tertiary text-sm mt-0">
          {{
            t('plans.confirm.sub', {
              org: orgOptions.find((o) => o.value === selectedOrg)?.label ?? selectedOrg,
              plan: t(`plans.names.${confirmDef.key}`),
            })
          }}
        </p>
        <dl class="plan-confirm m-0">
          <div class="plan-confirm__line">
            <dt>{{ t('plans.confirm.plan') }}</dt>
            <dd>{{ t(`plans.names.${confirmDef.key}`) }}</dd>
          </div>
          <div class="plan-confirm__line">
            <dt>{{ t('plans.confirm.billing') }}</dt>
            <dd>{{ t('plans.confirm.monthly') }}</dd>
          </div>
          <div class="plan-confirm__line">
            <dt>{{ t('plans.confirm.brands') }}</dt>
            <dd>
              {{
                confirmDef.hardCap
                  ? t('plans.confirm.brandsHard', { n: confirmDef.brandsIncluded })
                  : confirmDef.brandsIncluded
              }}
            </dd>
          </div>
          <div class="plan-confirm__line plan-confirm__line--total">
            <dt>{{ t('plans.confirm.today') }}</dt>
            <dd>€{{ confirmDef.priceEur?.toFixed(2) }}</dd>
          </div>
        </dl>
        <p class="text-tertiary text-xs bg-surface rounded p-2">
          🔒 {{ t('plans.confirm.stripeNote') }}
        </p>
        <GTAlert
          v-if="checkoutError"
          variant="info"
          :heading="t(`plans.confirm.${checkoutError}`)"
        />
      </template>
      <template #footer>
        <div class="flex flex-col gap-2 w-full">
          <GTButton block :loading="submitting" @click="continueToCheckout">
            {{ t('plans.confirm.continue') }}
          </GTButton>
          <GTButton variant="unstyled" size="sm" block @click="confirmPlan = null">
            {{ t('plans.confirm.back') }}
          </GTButton>
        </div>
      </template>
    </GTModal>
  </section>
</template>
