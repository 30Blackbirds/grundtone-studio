import { metrics } from '@opentelemetry/api'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'
import { count, gt, and, isNotNull, eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { activeVersion, orgSuspension, project } from '~~/server/db/schema'
import { registerBillingMetrics } from '~~/server/lib/metrics'

// Metrics-only OTel bootstrap (ADR-0002 §I: metrics-først; ingen trace-SDK
// eller auto-instrumentation her — det er billing-emitteren, ikke fuld APM).
// Dormant uden OTEL_EXPORTER_OTLP_ENDPOINT, samme mønster som resten af
// billing-familien. Resource: service.name/version + deployment.environment;
// tenant.id sættes IKKE som resource — Studio er cross-tenant, og spec'ens
// regel 2 forbyder per-tenant-attrs på alle vores (aggregat-)serier.
export default defineNitroPlugin(() => {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  if (!endpoint) return

  const provider = new MeterProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'grundtone-studio',
      [ATTR_SERVICE_VERSION]: process.env.SERVICE_VERSION ?? process.env.IMAGE_TAG ?? 'dev',
      'deployment.environment.name': process.env.SENTRY_ENVIRONMENT ?? 'production',
    }),
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
      }),
    ],
  })
  metrics.setGlobalMeterProvider(provider)

  // serving_brands = published brands (project w/ active version) whose org is
  // inside an open CDN-grace window. Runs on the exporter schedule only.
  registerBillingMetrics(async () => {
    const [row] = await db
      .select({ n: count() })
      .from(project)
      .innerJoin(orgSuspension, eq(orgSuspension.organizationId, project.organizationId))
      .innerJoin(activeVersion, eq(activeVersion.projectId, project.id))
      .where(and(isNotNull(orgSuspension.suspendedAt), gt(orgSuspension.cdnGraceUntil, new Date())))
    return row?.n ?? 0
  })
})
