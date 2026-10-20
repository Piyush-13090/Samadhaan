import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  REQUEST_ID_HEADER,
  err,
  ok,
  toErrorMessage,
  type Result,
} from '@samadhaan/shared';
import { AppConfig } from '../config/app.config.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { CircuitBreaker } from './circuit-breaker.js';

/**
 * A non-2xx response from the AI service, carrying its body.
 *
 * The body matters: it holds the `code`/`retryable` pair the orchestration
 * layer needs to decide between retrying and giving up.
 */
export class AiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'AiRequestError';
  }
}

/** Returned without calling the service while its circuit is open (Prompt 29). */
export class AiCircuitOpenError extends Error {
  constructor(readonly circuit: string) {
    super(`AI service circuit "${circuit}" is open; failing fast`);
    this.name = 'AiCircuitOpenError';
  }
}

/** Endpoint group a call belongs to: its first path segment (`/search/...` -> `search`). */
export function circuitKey(path: string): string {
  return path.replace(/^\/+/, '').split('/')[0] || 'root';
}

/** Options accepted by a single AI service call. */
export interface AiRequestOptions {
  /** Correlation id to propagate, so one trace spans web -> api -> ai. */
  requestId?: string;
  /** Per-call override of the configured timeout. */
  timeoutMs?: number;
}

/**
 * Transport layer for the Python AI service.
 *
 * This is the ONLY place in the codebase that knows the AI service exists over
 * HTTP. It owns the base URL, the internal auth header, timeouts and error
 * normalisation; `AiService` and future feature modules call it through typed
 * methods and never touch `fetch` themselves.
 *
 * Every method returns a `Result` rather than throwing, because an unreachable
 * AI service is an expected operational state that callers must degrade around.
 */
@Injectable()
export class AiClient {
  private readonly logger = new Logger(AiClient.name);
  readonly breaker: CircuitBreaker;

  constructor(
    private readonly config: AppConfig,
    @Optional() private readonly metrics?: MetricsService,
  ) {
    this.breaker = new CircuitBreaker(config.aiCircuit, Date.now, (t) => {
      this.metrics?.aiCircuit.set(
        { group: t.key },
        t.to === 'closed' ? 0 : t.to === 'half-open' ? 1 : 2,
      );
      const message = `AI service circuit "${t.key}" ${t.from} -> ${t.to}`;
      if (t.to === 'open') this.logger.warn(message);
      else this.logger.log(message);
    });
  }

  get baseUrl(): string {
    return this.config.aiServiceUrl;
  }

  /** GET a JSON resource from the AI service. */
  async get<TResponse>(
    path: string,
    options: AiRequestOptions = {},
  ): Promise<Result<TResponse>> {
    return this.request<TResponse>('GET', path, undefined, options);
  }

  /** POST a JSON payload to the AI service. */
  async post<TResponse>(
    path: string,
    body: unknown,
    options: AiRequestOptions = {},
  ): Promise<Result<TResponse>> {
    return this.request<TResponse>('POST', path, body, options);
  }

  private async request<TResponse>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    options: AiRequestOptions,
  ): Promise<Result<TResponse>> {
    const normalised = path.startsWith('/') ? path : `/${path}`;
    const url = `${this.baseUrl}${normalised}`;
    const timeoutMs = options.timeoutMs ?? this.config.aiServiceTimeoutMs;
    // Health probes bypass the breaker: readiness must see the real state.
    const circuit = normalised.startsWith('/health') ? null : circuitKey(normalised);
    const group = circuit ?? 'health';
    const started = Date.now();
    const record = (outcome: string) => {
      this.metrics?.aiRequests.inc({ group, outcome });
      if (outcome !== 'circuit_open') {
        this.metrics?.aiDuration.observe({ group }, (Date.now() - started) / 1000);
      }
    };
    if (circuit && !this.breaker.allow(circuit)) {
      record('circuit_open');
      return err(new AiCircuitOpenError(circuit));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        signal: controller.signal,
        // Never follow a redirect: it would carry x-internal-token to whatever
        // host the response names (Prompt 26).
        redirect: 'error',
        headers: this.buildHeaders(options.requestId, body !== undefined, timeoutMs),
        // Omit the key entirely rather than passing `undefined`: fetch rejects
        // a body on GET even when it is undefined.
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

      // 5xx is the service failing; 4xx is a verdict about this request.
      if (circuit) {
        if (response.status >= 500) this.breaker.failure(circuit);
        else this.breaker.success(circuit);
      }
      record(
        response.ok ? 'ok' : response.status >= 500 ? 'server_error' : 'client_error',
      );

      if (!response.ok) {
        // The body is parsed rather than stringified, because the AI service
        // returns a structured failure whose `retryable` flag decides whether
        // the caller tries again. Flattening it to a message would cost that.
        const body: unknown = await response.json().catch(() => null);

        return err(
          new AiRequestError(
            `AI service responded ${response.status}`,
            response.status,
            body,
          ),
        );
      }

      return ok((await response.json()) as TResponse);
    } catch (error) {
      if (circuit) this.breaker.failure(circuit);
      const timedOut = error instanceof Error && error.name === 'AbortError';
      record(timedOut ? 'timeout' : 'unreachable');
      const message = timedOut
        ? `AI service request timed out after ${timeoutMs}ms`
        : toErrorMessage(error);
      this.logger.warn(`${method} ${url} failed: ${message}`);
      return err(new Error(message));
    } finally {
      clearTimeout(timer);
    }
  }

  private buildHeaders(
    requestId: string | undefined,
    hasBody: boolean,
    timeoutMs: number,
  ): HeadersInit {
    // How long this side will wait (Prompt 29). The AI service stops provider
    // work before then, so nothing keeps running — or billing — after the
    // caller has given up.
    const headers: Record<string, string> = {
      accept: 'application/json',
      'x-deadline-ms': String(timeoutMs),
    };

    if (hasBody) headers['content-type'] = 'application/json';
    if (requestId) headers[REQUEST_ID_HEADER] = requestId;

    const token = this.config.aiServiceToken;
    if (token) headers['x-internal-token'] = token;

    return headers;
  }
}
