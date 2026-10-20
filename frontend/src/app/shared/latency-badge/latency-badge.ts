import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { LatencyService } from '../../core/services/latency.service';

/**
 * Header badge "⏱ 120 ms" (p50, our server → on screen). Click: a panel with every step's
 * p50 / p95 / p99, so you can see WHERE the time goes. Only has data with the live backend feed.
 */
@Component({
  selector: 'app-latency-badge',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    <button
      type="button"
      (click)="open.set(!open())"
      [attr.aria-expanded]="open()"
      title="How long prices take to reach your screen"
      class="flex items-center gap-1.5 h-7 px-2 rounded text-xs font-medium font-mono tabular-nums text-ink-muted hover:text-ink hover:bg-surface-2 transition-colors">
      ⏱ {{ headline() }}
    </button>

    @if (open()) {
      <div
        class="absolute right-0 top-full mt-2 z-50 w-[26rem] max-w-[calc(100vw-2rem)] rounded border border-line bg-surface-1 shadow-xl shadow-black/50 p-3 text-xs"
        role="dialog"
        aria-label="Latency details">
        <p class="font-semibold">Tick latency (last {{ maxSamples() }} ticks)</p>
        <p class="mt-0.5 text-ink-faint">p95 = 95 % of ticks were faster than this.</p>

        <table class="mt-3 w-full font-mono tabular-nums">
          <thead class="text-[10px] uppercase tracking-wider text-ink-muted">
            <tr>
              <th class="text-left font-semibold font-sans pb-1">Step</th>
              <th class="text-right font-semibold pb-1">p50</th>
              <th class="text-right font-semibold pb-1">p95</th>
              <th class="text-right font-semibold pb-1">p99</th>
            </tr>
          </thead>
          <tbody>
            @for (row of report().rows; track row.segment) {
              <tr [class]="row.segment === 'total' ? 'border-t border-line text-ink font-semibold' : 'text-ink-muted'">
                <td class="py-1 font-sans">{{ row.label }}</td>
                @if (row.samples > 0) {
                  <td class="py-1 text-right">{{ row.p50 | number: '1.0-0' }}</td>
                  <td class="py-1 text-right">{{ row.p95 | number: '1.0-0' }}</td>
                  <td class="py-1 text-right">{{ row.p99 | number: '1.0-0' }}</td>
                } @else {
                  <td colspan="3" class="py-1 text-right text-ink-faint">no data</td>
                }
              </tr>
            }
          </tbody>
        </table>

        <p class="mt-3 text-ink-faint">
          All times in ms.
          @if (report().clockRtt !== null) {
            Clock difference to server {{ report().clockOffset | number: '1.0-0' }} ms,
            measured to ± {{ report().clockRtt! / 2 | number: '1.0-0' }} ms.
          } @else {
            Waiting for the live feed (the simulated feed has no server timings).
          }
        </p>
      </div>
    }
  `,
  host: { class: 'relative' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LatencyBadge {
  private readonly latency = inject(LatencyService);
  readonly report = this.latency.report;
  readonly open = signal(false);

  readonly headline = computed(() => {
    const total = this.report().rows.find((r) => r.segment === 'total');
    return total && total.samples > 0 ? `${Math.round(total.p50)} ms` : '–';
  });
  readonly maxSamples = computed(() => Math.max(0, ...this.report().rows.map((r) => r.samples)));
}
