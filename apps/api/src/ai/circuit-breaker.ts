/**
 * A small circuit breaker for AI service calls (Prompt 29).
 *
 * Why: when the AI service hangs or is overloaded (as opposed to refusing
 * connections), every call waits its full timeout — 8 s for search
 * understanding, up to 150 s for a knowledge answer — and holds a request the
 * whole time. Every caller already has a fallback for a failed call, so after
 * repeated failures it is better to fail immediately and let the fallback run.
 *
 * States per key: closed (calls pass; consecutive failures counted), open
 * (calls rejected until `resetMs` has passed), half-open (one trial call; its
 * success closes the circuit, its failure re-opens it). In-memory and per
 * process: each API replica judges the AI service for itself.
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

interface Circuit {
  state: CircuitState;
  failures: number;
  openedAt: number;
  trialInFlight: boolean;
}

export interface CircuitTransition {
  key: string;
  from: CircuitState;
  to: CircuitState;
}

export class CircuitBreaker {
  private readonly circuits = new Map<string, Circuit>();

  constructor(
    private readonly options: { failureThreshold: number; resetMs: number },
    private readonly now: () => number = Date.now,
    private readonly onTransition: (t: CircuitTransition) => void = () => undefined,
  ) {}

  get enabled(): boolean {
    return this.options.failureThreshold > 0;
  }

  /** Whether a call may proceed now. Marks a half-open trial as in flight. */
  allow(key: string): boolean {
    if (!this.enabled) return true;
    const c = this.circuit(key);
    if (c.state === 'closed') return true;
    if (c.state === 'open') {
      if (this.now() - c.openedAt < this.options.resetMs) return false;
      this.move(key, c, 'half-open');
    }
    if (c.trialInFlight) return false;
    c.trialInFlight = true;
    return true;
  }

  success(key: string): void {
    if (!this.enabled) return;
    const c = this.circuit(key);
    c.failures = 0;
    c.trialInFlight = false;
    if (c.state !== 'closed') this.move(key, c, 'closed');
  }

  failure(key: string): void {
    if (!this.enabled) return;
    const c = this.circuit(key);
    c.trialInFlight = false;
    c.failures += 1;
    if (c.state === 'half-open' || c.failures >= this.options.failureThreshold) {
      c.openedAt = this.now();
      if (c.state !== 'open') this.move(key, c, 'open');
    }
  }

  state(key: string): CircuitState {
    return this.circuit(key).state;
  }

  snapshot(): Record<string, CircuitState> {
    return Object.fromEntries([...this.circuits].map(([k, c]) => [k, c.state]));
  }

  private circuit(key: string): Circuit {
    let c = this.circuits.get(key);
    if (!c) {
      c = { state: 'closed', failures: 0, openedAt: 0, trialInFlight: false };
      this.circuits.set(key, c);
    }
    return c;
  }

  private move(key: string, c: Circuit, to: CircuitState) {
    const from = c.state;
    c.state = to;
    this.onTransition({ key, from, to });
  }
}
