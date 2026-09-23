/**
 * OpenTelemetry, started before anything else exists.
 *
 * **Loaded with `--require`, never imported.** Auto-instrumentation works by patching
 * modules as they are required — `http`, `express`, `pg`, `ioredis`, the AWS SDK — so
 * it has to run before the first `require` of any of them. Imported from `main.ts` it
 * would load after Nest has already pulled half the dependency tree in, the patches
 * would attach to nothing, and the result is the worst kind of failure: a process that
 * starts cleanly, reports itself instrumented, and produces no spans.
 *
 * That is also why this is the one file allowed to read `process.env` directly. It runs
 * before `ConfigModule` has validated anything, so there is no validated configuration
 * to read yet — everything else in the application goes through the namespaces.
 */
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { metrics, NodeSDK } from '@opentelemetry/sdk-node';
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

if (process.env['OTEL_ENABLED'] === 'true') {
  /**
   * The SDK's own diagnostics, off the application's log level on purpose.
   *
   * Tying it to `LOG_LEVEL=debug` — which is the default locally — buried every real
   * line under a running commentary of the HTTP instrumentation patching sockets. It
   * is the same failure as leaving `fs` instrumentation on, one layer up.
   *
   * `OTEL_LOG_LEVEL` is OpenTelemetry's own variable, so raising it is the thing
   * somebody debugging an exporter would already try. Quiet at ERROR otherwise —
   * which still says something, because a silent exporter and a silent application
   * look identical from the outside.
   */
  const diagLevel = (process.env['OTEL_LOG_LEVEL'] ?? 'error').toUpperCase();
  diag.setLogger(
    new DiagConsoleLogger(),
    DiagLogLevel[diagLevel as keyof typeof DiagLogLevel] ?? DiagLogLevel.ERROR,
  );

  const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4318';

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env['OTEL_SERVICE_NAME'] ?? 'saas-template-api',
      [ATTR_SERVICE_VERSION]: process.env['APP_VERSION'] ?? '0.0.0',
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env['NODE_ENV'] ?? 'development',
    }),

    /**
     * One endpoint for everything, and it is Alloy — not Tempo, not Prometheus.
     *
     * The applications speak OTLP to a collector and to nothing else, so which backend
     * stores the result is a change to Alloy's configuration instead of a redeploy of
     * every service. See infra/observability.
     */
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),

    metricReader: new metrics.PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
      /**
       * A minute. These are counters and histograms over minutes of traffic; exporting
       * every few seconds multiplies the number of points stored for a resolution
       * nobody reads off a dashboard.
       */
      exportIntervalMillis: 60_000,
    }),

    /**
     * No log pipeline, and that is a decision rather than an omission.
     *
     * The SDK ships logs over OTLP by default, and `instrumentation-pino` feeds it
     * every line this application writes. But the logs already reach Loki the other
     * way — the existing stack collects container stdout through the docker socket —
     * so leaving it on puts every line in Loki twice, under two different labels, and
     * the second copy is the one nobody knows about until a query returns doubles.
     *
     * stdout stays the transport for logs; OTLP carries traces and metrics. The pino
     * instrumentation is still worth having: it is what injects `trace_id` into the
     * lines that go to stdout.
     */
    logRecordProcessors: [],

    instrumentations: [
      getNodeAutoInstrumentations({
        /**
         * Off, and not negotiable: `fs` instrumentation emits a span per file read,
         * which on a Node process is thousands during startup alone. It buries the
         * spans that matter and costs more to export than everything else combined.
         */
        '@opentelemetry/instrumentation-fs': { enabled: false },

        '@opentelemetry/instrumentation-http': {
          /**
           * The health probes are hit every few seconds by the orchestrator for the
           * whole life of the container. They are the highest-volume route in the
           * system and the least informative: kept, they are most of the trace bill.
           */
          ignoreIncomingRequestHook: (request) => (request.url ?? '').startsWith('/health'),
        },
      }),
    ],
  });

  sdk.start();

  /**
   * Flush on the way out.
   *
   * A container being replaced has up to a minute of metrics and a few seconds of
   * spans buffered, and they describe exactly the window somebody will ask about — the
   * one just before the restart. `shutdown` drains them before the process goes.
   */
  const stop = (): void => {
    void sdk
      .shutdown()
      .catch((error: unknown) => console.error('otel shutdown failed', error))
      .finally(() => process.exit(0));
  };

  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
