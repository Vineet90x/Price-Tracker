import { DestroyRef, Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PriceFeed, TickTiming } from './price-feed';

/**
 * The steps a live price goes through, timed separately:
 *
 *   exchange ──1──► our server ──2──► leaves our server ──3──► browser receives ──4──► painted on screen
 *
 * 1 exchange: Binance → us. Uses two different clocks (theirs and ours), so treat it as approximate.
 * 2 server:   our backend + Redis. Same clock at both ends: exact.
 * 3 network:  our server → this browser. Needs the clock difference from ping/pong (± half a round trip).
 * 4 render:   arrival → pixels on screen. Same clock: exact. Includes our 250 ms batching (auditTime).
 * total:      our server → screen (2 + 3 + 4): the part we control.
 */
export type Segment = 'exchange' | 'server' | 'network' | 'render' | 'total';

export interface SegmentStats {
  segment: Segment;
  label: string;
  p50: number;
  p95: number;
  p99: number;
  samples: number;
}

export interface LatencyReport {
  rows: SegmentStats[];
  clockOffset: number | null;
  clockRtt: number | null;
}

const LABELS: Record<Segment, string> = {
  exchange: 'Exchange → our server',
  server: 'Inside our server (Redis)',
  network: 'Our server → browser',
  render: 'Browser → on screen',
  total: 'Our server → on screen',
};

/** Measurements kept per step: the most recent ones only, so the numbers describe "now". */
const WINDOW = 600;
const REFRESH_MS = 1000;

/** p in 0..1. "p95 = 180 ms" means 95 % of ticks were faster than 180 ms. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

/** A fixed-size list that overwrites its oldest entry: constant memory, however long the app runs. */
class Ring {
  private readonly values: number[] = [];
  private next = 0;
  push(value: number): void {
    if (this.values.length < WINDOW) this.values.push(value);
    else this.values[this.next] = value;
    this.next = (this.next + 1) % WINDOW;
  }
  sorted(): number[] {
    return [...this.values].sort((a, b) => a - b);
  }
}

@Injectable({ providedIn: 'root' })
export class LatencyService {
  private readonly feed = inject(PriceFeed);
  private readonly rings: Record<Segment, Ring> = {
    exchange: new Ring(),
    server: new Ring(),
    network: new Ring(),
    render: new Ring(),
    total: new Ring(),
  };
  /** Ticks that arrived but are not painted yet */
  private pending: TickTiming[] = [];

  private readonly _report = signal<LatencyReport>({ rows: [], clockOffset: null, clockRtt: null });
  /** Refreshed once per second (not per tick: sorting on every tick would cost more than it measures) */
  readonly report = this._report.asReadonly();

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;

    this.feed.events$.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe((event) => {
      if (event.type === 'tick' && event.timing) this.onTick(event.timing);
    });
    const timer = setInterval(() => this.refresh(), REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  /** Called right after the browser has painted the latest prices (see App). */
  markPainted(): void {
    if (this.pending.length === 0) return;
    const painted = Date.now();
    const offset = this.feed.clockSync()?.offset;
    for (const t of this.pending) {
      this.rings.render.push(painted - t.received);
      if (offset !== undefined) this.rings.total.push(painted + offset - t.serverIn);
    }
    this.pending = [];
  }

  private onTick(t: TickTiming): void {
    // Simulated stocks are created on our server, so exchange time = server time: nothing to measure.
    if (t.exchange !== t.serverIn) this.rings.exchange.push(t.serverIn - t.exchange);
    this.rings.server.push(t.serverOut - t.serverIn);
    const offset = this.feed.clockSync()?.offset;
    if (offset !== undefined) this.rings.network.push(t.received + offset - t.serverOut);
    this.pending.push(t);
    if (this.pending.length > WINDOW) this.pending = this.pending.slice(-WINDOW); // never paints? cap memory
  }

  private refresh(): void {
    const rows = (Object.keys(this.rings) as Segment[]).map((segment) => {
      const sorted = this.rings[segment].sorted();
      return {
        segment,
        label: LABELS[segment],
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        p99: percentile(sorted, 0.99),
        samples: sorted.length,
      };
    });
    const clock = this.feed.clockSync();
    this._report.set({ rows, clockOffset: clock?.offset ?? null, clockRtt: clock?.rtt ?? null });
  }
}
