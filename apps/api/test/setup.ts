import http from 'node:http';
import https from 'node:https';

/**
 * No connection pooling in the test process.
 *
 * Node 19 turned `keepAlive` on for `http.globalAgent`, and supertest uses it. Every
 * request listens on an ephemeral port, every spec builds and closes its own Nest
 * application, and the operating system recycles those port numbers — so a pooled
 * socket to 127.0.0.1:PORT can be handed to a request aimed at a *different*
 * application, or at one that has since been closed.
 *
 * That is the shape of the flake this suite chased for weeks: it appeared only in long
 * full runs, never in isolation, always as damage at the HTTP layer rather than in the
 * logic under test — `Parse Error: Expected HTTP/, RTSP/ or ICE/` when the bytes came
 * from nowhere sensible, and `404` when the request landed on an application that did
 * not have that route.
 *
 * Pooling buys nothing here: the suite is sequential and the cost of a fresh socket is
 * invisible next to booting a Nest application per file.
 */
http.globalAgent = new http.Agent({ keepAlive: false });

/**
 * Nothing in this suite may talk to Stripe.
 *
 * Not a preference — a rule with teeth. `createCustomerOnSignUp` fires on every
 * sign-up and the suite creates dozens of accounts per run; pointed at a live account
 * that is a few hundred requests a day spent on nothing, and on a claimable sandbox it
 * exhausts the budget outright. Once it is exhausted EVERY Stripe call answers 429,
 * including the customer portal in the browser — a failure that looks like a bug in
 * this application and is not. That happened.
 *
 * The plugin already stops creating customers under NODE_ENV=test, but a flag is a
 * promise and this is the enforcement: any request to Stripe throws, loudly, naming
 * the spec that made it. A future hook that starts calling Stripe fails the suite
 * instead of quietly spending somebody's quota.
 *
 * Both entry points are covered because the Stripe SDK picks one or the other
 * depending on how it was constructed.
 */
const STRIPE_HOST = /(^|\.)stripe\.com$/i;

/** Exported so a spec can prove what it does and does not match, without a socket. */
export function targetsStripe(target: unknown): boolean {
  if (typeof target === 'string') {
    try {
      return STRIPE_HOST.test(new URL(target).hostname);
    } catch {
      return false;
    }
  }
  if (target instanceof URL) return STRIPE_HOST.test(target.hostname);

  if (target && typeof target === 'object') {
    const options = target as { hostname?: unknown; host?: unknown; url?: unknown };
    const host = options.hostname ?? options.host;
    if (typeof host === 'string') return STRIPE_HOST.test(host.split(':')[0] ?? '');
    if (typeof options.url === 'string') return targetsStripe(options.url);
  }
  return false;
}

/**
 * Every refusal, recorded before it throws.
 *
 * The throw alone is not enough to test with: Better Auth catches what its hooks
 * raise and logs it, so a hook that started calling Stripe again would be refused
 * *and* invisible. A spec asserts this list is empty — see billing.e2e-spec.
 */
export const stripeCallAttempts: string[] = [];

/** A readable target, so a failure names what was called rather than [object Object]. */
function describe(target: unknown): string {
  if (typeof target === 'string') return target;
  if (target instanceof URL) return target.href;
  if (target && typeof target === 'object') {
    const o = target as { method?: unknown; hostname?: unknown; host?: unknown; path?: unknown };
    const host = o.hostname ?? o.host ?? 'stripe';
    return `${String(o.method ?? 'GET')} ${String(host)}${String(o.path ?? '')}`;
  }
  return String(target);
}

function refuse(target: unknown): never {
  stripeCallAttempts.push(describe(target));
  throw new Error(
    'A test tried to call the Stripe API. The suite must not: it spends a real ' +
      'request budget, and exhausting it makes the customer portal fail in the ' +
      'browser for reasons unrelated to the code. See stripe-plugin.ts.',
  );
}

type RequestFn = (...args: unknown[]) => unknown;

for (const module of [http, https] as const) {
  // The overloads of `request` do not survive a generic wrapper, so both sides of the
  // swap go through one narrow cast rather than a scattering of @ts-expect-error.
  const carrier = module as unknown as { request: RequestFn };
  const original = carrier.request.bind(module) as RequestFn;

  carrier.request = (...args: unknown[]) => {
    const stripeArg = args.find(targetsStripe);
    if (stripeArg !== undefined) refuse(stripeArg);
    return original(...args);
  };
}

const originalFetch = globalThis.fetch;
if (typeof originalFetch === 'function') {
  globalThis.fetch = ((input: unknown, init?: unknown) => {
    const url = typeof input === 'object' && input !== null && 'url' in input ? input.url : input;
    if (targetsStripe(url)) refuse(url);
    return (originalFetch as RequestFn)(input, init);
  }) as typeof fetch;
}
