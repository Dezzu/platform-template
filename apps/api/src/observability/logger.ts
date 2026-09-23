import type { LoggerService, LogLevel } from '@nestjs/common';
import { context, trace } from '@opentelemetry/api';
import { pino, type Logger } from 'pino';

export interface LoggerOptions {
  level: string;
  /** Human-readable lines instead of JSON. Development only. */
  pretty: boolean;
  serviceName: string;
}

/**
 * Structured logs, correlated to traces.
 *
 * The correlation is the whole reason this replaces Nest's logger. Every line carries
 * `trace_id` and `span_id` taken from whatever span is active when it is written, so a
 * log in Loki links to the trace in Tempo and back — which turns "an error happened"
 * into "here is the request it happened in, and everything else that request did".
 * Nest's default logger writes coloured prose to stdout with none of that.
 *
 * The ids come from the **ambient** OpenTelemetry context rather than from an argument.
 * A call site that had to pass them would be a call site that can forget, and the one
 * that forgets is always the error path.
 *
 * JSON in production, pretty in development: a log collector parses the first and a
 * person reads the second, and asking either to do the other's job is how people stop
 * reading logs.
 */
export function createLogger(options: LoggerOptions): Logger {
  return pino({
    level: options.level,
    base: { service: options.serviceName },

    /**
     * Merged into every line. Returning an empty object when there is no active span is
     * deliberate: work outside a request — a queue job on a cold worker, a scheduler
     * tick — still logs, it simply has no trace to point at.
     */
    mixin() {
      const span = trace.getSpan(context.active());
      if (!span) return {};

      const { traceId, spanId } = span.spanContext();
      return { trace_id: traceId, span_id: spanId };
    },

    // `time` rather than pino's default epoch integer: Loki and a human both read it.
    timestamp: pino.stdTimeFunctions.isoTime,

    ...(options.pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss.l',
              ignore: 'pid,hostname,service',
            },
          },
        }
      : {}),
  });
}

/**
 * Adapts pino to the interface Nest expects.
 *
 * Nest hands the framework's own startup and error output through here too, so the
 * routes it maps and the exceptions it catches end up in the same stream, in the same
 * shape, as everything the application writes itself.
 */
export class PinoLoggerService implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, ...optional: unknown[]): void {
    this.logger.info(payload(optional), String(message));
  }

  error(message: unknown, ...optional: unknown[]): void {
    this.logger.error(payload(optional), String(message));
  }

  warn(message: unknown, ...optional: unknown[]): void {
    this.logger.warn(payload(optional), String(message));
  }

  debug(message: unknown, ...optional: unknown[]): void {
    this.logger.debug(payload(optional), String(message));
  }

  verbose(message: unknown, ...optional: unknown[]): void {
    this.logger.trace(payload(optional), String(message));
  }

  fatal(message: unknown, ...optional: unknown[]): void {
    this.logger.fatal(payload(optional), String(message));
  }

  setLogLevels?(_levels: LogLevel[]): void {
    // Nest's levels are a different vocabulary from pino's and the level is already
    // decided by LOG_LEVEL. Accepting the call and ignoring it keeps Nest happy without
    // pretending there are two places to configure this.
  }
}

/**
 * Nest's trailing arguments are positional and untyped: the last is the `context` (the
 * class name it came from) and anything before it is usually a stack trace.
 */
function payload(optional: readonly unknown[]): Record<string, unknown> {
  if (optional.length === 0) return {};

  const last = optional[optional.length - 1];
  const rest = optional.slice(0, -1).filter(Boolean);

  return {
    ...(typeof last === 'string' ? { context: last } : {}),
    ...(rest.length > 0 ? { detail: rest.map(String).join('\n') } : {}),
  };
}
