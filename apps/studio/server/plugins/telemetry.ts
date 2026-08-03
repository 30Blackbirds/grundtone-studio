import { count, gt, and, isNotNull, eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { activeVersion, orgSuspension, project } from '~~/server/db/schema'
import { registerBillingMetrics } from '~~/server/lib/metrics'

// Metrics-only OTel bootstrap (ADR-0002 §I: metrics-først; ingen trace-SDK
// eller auto-instrumentation — det er billing-emitteren, ikke fuld APM).
//
// v0.2.11-INCIDENT (2026-08-03): statiske top-level imports af exporter-kæden
// væltede BOOT i prod — Nitros externals-tracing fik ikke hele den transitive
// OTel-CJS-graf med i imagets .output/server/node_modules (MODULE_NOT_FOUND
// før env-guarden overhovedet kørte; lokalt maskeret af fuld node_modules).
// Derfor: ALLE SDK-imports er dynamiske, bag env-guarden, i try/catch —
// telemetri er best-effort by design og må ALDRIG kunne vælte boot (samme
// princip som spec-regel 4 og resonans' "tom DSN = off"). Bundlingen fixes
// separat via nitro.externals.traceInclude i nuxt.config, men denne plugin
// overlever også hvis dét fix regredierer.
export default defineNitroPlugin(async () => {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  if (!endpoint) return

  try {
    const [{ metrics }, { OTLPMetricExporter }, { resourceFromAttributes }, sdkMetrics, semconv] =
      await Promise.all([
        import('@opentelemetry/api'),
        import('@opentelemetry/exporter-metrics-otlp-proto'),
        import('@opentelemetry/resources'),
        import('@opentelemetry/sdk-metrics'),
        import('@opentelemetry/semantic-conventions'),
      ])

    const provider = new sdkMetrics.MeterProvider({
      resource: resourceFromAttributes({
        [semconv.ATTR_SERVICE_NAME]: 'grundtone-studio',
        [semconv.ATTR_SERVICE_VERSION]:
          process.env.SERVICE_VERSION ?? process.env.IMAGE_TAG ?? 'dev',
        'deployment.environment.name': process.env.SENTRY_ENVIRONMENT ?? 'production',
      }),
      readers: [
        new sdkMetrics.PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
        }),
      ],
    })
    metrics.setGlobalMeterProvider(provider)

    // serving_brands = published brands (project w/ active version) whose org
    // is inside an open CDN-grace window. Runs on the exporter schedule only.
    registerBillingMetrics(async () => {
      const [row] = await db
        .select({ n: count() })
        .from(project)
        .innerJoin(orgSuspension, eq(orgSuspension.organizationId, project.organizationId))
        .innerJoin(activeVersion, eq(activeVersion.projectId, project.id))
        .where(
          and(isNotNull(orgSuspension.suspendedAt), gt(orgSuspension.cdnGraceUntil, new Date())),
        )
      return row?.n ?? 0
    })
  } catch (err) {
    console.warn('[telemetry] OTel init failed — running without metrics (best-effort):', err)
  }
})
