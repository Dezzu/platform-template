import { metrics, type Attributes } from '@opentelemetry/api';

/**
 * The handful of numbers worth watching, recorded through the **global** OpenTelemetry
 * meter rather than through a Nest provider.
 *
 * That choice is deliberate and it is what makes these usable. The places worth
 * counting are not all inside the DI container: Better Auth's hooks live outside it,
 * `QueueWorkerHost` is an abstract base its subclasses construct, and the Stripe
 * webhook is a plugin callback. Threading an injected service into each of those would
 * mean either a constructor argument every processor has to remember to pass, or not
 * measuring the interesting half of the system.
 *
 * When telemetry is off, `getMeter` hands back a no-op implementation — so every
 * function here costs a property lookup and nothing else, and no call site needs a
 * guard.
 *
 * Naming follows the OpenTelemetry convention, not Prometheus': `_total` suffixes and
 * `_seconds` units are added by the Prometheus exporter on the way out, so adding them
 * here would produce `signups_total_total`.
 */
const meter = metrics.getMeter('saas-template-api');

/** Accounts created. The top of every funnel, and the first thing a launch moves. */
const signups = meter.createCounter('signups', {
  description: 'Accounts created',
});

/**
 * Outgoing email by template and outcome.
 *
 * Split by `status` because the useful question is never "how much mail did we send"
 * but "what share of the invitations failed" — and a single counter cannot answer it.
 */
const emails = meter.createCounter('emails_sent', {
  description: 'Emails handed to the transport, by template and outcome',
});

/**
 * How long jobs take, by queue and outcome.
 *
 * A histogram rather than a counter: the mean duration of a queue hides the case that
 * matters, which is the tail. Buckets are left to the backend — Tempo's metrics
 * generator and Prometheus both have sensible defaults for seconds.
 */
const jobDuration = meter.createHistogram('queue_job_duration', {
  description: 'Time from job start to completion',
  unit: 's',
});

/**
 * Stripe webhooks by type and result.
 *
 * `result` distinguishes a duplicate from a failure, which matters here more than
 * usual: Stripe retries for 72 hours, so a steady trickle of `duplicate` is the
 * idempotency guard working, and the same trickle under `failed` is money going
 * unrecorded.
 */
const stripeWebhooks = meter.createCounter('stripe_webhooks', {
  description: 'Stripe webhook deliveries, by event type and result',
});

export function recordSignup(): void {
  signups.add(1);
}

export function recordEmail(template: string, status: 'sent' | 'failed'): void {
  emails.add(1, { template, status });
}

export function recordJob(
  queue: string,
  name: string,
  status: 'completed' | 'failed',
  seconds: number,
): void {
  jobDuration.record(seconds, { queue, name, status });
}

export function recordStripeWebhook(
  type: string,
  result: 'processed' | 'duplicate' | 'failed',
): void {
  stripeWebhooks.add(1, { type, result } satisfies Attributes);
}

/**
 * Registers a gauge somebody else observes.
 *
 * Used for the numbers that are a state rather than an event — how many subscriptions
 * are active right now — where counting up and down by hand would drift the first time
 * a path forgot to decrement. The callback runs once per export interval; keep it to a
 * single query.
 */
export function observeGauge(name: string, description: string, read: () => Promise<number>): void {
  const gauge = meter.createObservableGauge(name, { description });

  gauge.addCallback(async (result) => {
    try {
      result.observe(await read());
    } catch {
      // A gauge that cannot read must not take the export down with it: the other
      // metrics in the same batch are still worth having.
    }
  });
}
