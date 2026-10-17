import { Component, ChangeDetectionStrategy, computed, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { PriceService } from '../../core/services/price.service';

interface Holding {
  symbol: string;
  quantity: number;
  avg_price: number;
}

interface PortfolioResponse {
  email: string;
  holdings: Holding[];
}

/**
 * Protected page (authGuard). Holdings come from GET /api/portfolio, which needs the access
 * token, so this page exercises the whole interceptor flow. Prices come from the live feed.
 */
@Component({
  selector: 'app-portfolio',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    <div class="p-4">
      <h1 class="text-base font-semibold">Portfolio</h1>
      <p class="mt-1 text-xs text-ink-muted">
        Demo holdings from the protected API. Last price (LTP) and P&amp;L are live.
      </p>

      <div class="mt-4 overflow-x-auto rounded border border-line bg-surface-1">
        @if (portfolio.isLoading()) {
          <p class="p-6 text-center text-sm text-ink-muted">Loading…</p>
        } @else if (portfolio.error()) {
          <p class="p-6 text-center text-sm text-down">Couldn't load the portfolio.</p>
        } @else {
          <table class="w-full text-sm">
            <thead class="text-[11px] uppercase tracking-wider text-ink-muted">
              <tr class="border-b border-line">
                <th class="px-4 py-2 text-left font-semibold">Symbol</th>
                <th class="px-4 py-2 text-right font-semibold">Qty</th>
                <th class="px-4 py-2 text-right font-semibold">Avg</th>
                <th class="px-4 py-2 text-right font-semibold">LTP</th>
                <th class="px-4 py-2 text-right font-semibold">Value</th>
                <th class="px-4 py-2 text-right font-semibold">P&amp;L</th>
              </tr>
            </thead>
            <tbody class="font-mono tabular-nums">
              @for (row of rows(); track row.symbol) {
                <tr class="border-b border-line/60 last:border-b-0">
                  <td class="px-4 py-2.5 font-sans font-semibold">{{ row.symbol }}</td>
                  <td class="px-4 py-2.5 text-right">{{ row.quantity | number: '1.0-4' }}</td>
                  <td class="px-4 py-2.5 text-right">{{ row.currency }}{{ row.avg_price | number: '1.2-2' }}</td>
                  @if (row.ltp !== undefined && row.pnl !== undefined) {
                    <td class="px-4 py-2.5 text-right">{{ row.currency }}{{ row.ltp | number: '1.2-4' }}</td>
                    <td class="px-4 py-2.5 text-right">{{ row.currency }}{{ row.value | number: '1.2-2' }}</td>
                    <td class="px-4 py-2.5 text-right" [class]="row.pnl >= 0 ? 'text-up' : 'text-down'">
                      {{ row.pnl >= 0 ? '+' : '' }}{{ row.pnl | number: '1.2-2' }}
                      <span class="text-xs">({{ row.pnl >= 0 ? '+' : '' }}{{ row.pnlPercent | number: '1.2-2' }}%)</span>
                    </td>
                  } @else {
                    <td colspan="3" class="px-4 py-2.5 text-right text-ink-faint">waiting for price…</td>
                  }
                </tr>
              } @empty {
                <tr><td colspan="6" class="p-6 text-center text-ink-muted">No holdings.</td></tr>
              }
            </tbody>
          </table>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Portfolio {
  private readonly priceService = inject(PriceService);

  /** Signal-based HTTP: re-fetches if its URL function's signals change; goes through interceptors. */
  readonly portfolio = httpResource<PortfolioResponse>(() => '/api/portfolio');

  readonly rows = computed(() => {
    const holdings = this.portfolio.hasValue() ? this.portfolio.value().holdings : [];
    const prices = new Map(this.priceService.pricesSignal().map((p) => [p.symbol, p.price] as const));
    return holdings.map((h) => {
      const ltp = prices.get(h.symbol);
      const cost = h.quantity * h.avg_price;
      const value = ltp === undefined ? undefined : h.quantity * ltp;
      const pnl = value === undefined ? undefined : value - cost;
      return {
        ...h,
        currency: this.priceService.isCrypto(h.symbol) ? '$' : '₹',
        ltp,
        value,
        pnl,
        pnlPercent: pnl === undefined ? undefined : (pnl / cost) * 100,
      };
    });
  });
}
