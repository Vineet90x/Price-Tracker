import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { StockPrice } from '../../../core/models/stock.model';
import { PriceService } from '../../../core/services/price.service';
import { RUNTIME_OPTIONS } from '../../../core/config/runtime-options';

/**
 * One compact row in the watchlist pane: symbol + name on the left, last price + % change on the right.
 * Dumb-ish component: it receives the price as an input and emits a click; it owns no state.
 */
@Component({
  selector: 'app-watchlist-row',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    <button
      type="button"
      (click)="selectSymbol.emit(stock().symbol)"
      [attr.aria-pressed]="selected()"
      class="w-full h-14 px-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 text-left border-l-2 border-b border-b-line/60 transition-colors"
      [class]="selected() ? 'bg-surface-2 border-accent' : 'border-transparent hover:bg-surface-2/60'">
      <div class="min-w-0">
        <div class="flex items-center gap-1.5">
          <span class="text-sm font-semibold truncate">{{ stock().symbol }}</span>
          @if (simulated()) {
            <span class="px-1 rounded-sm text-[9px] font-semibold bg-surface-2 text-ink-faint" title="Simulated price (no free live NSE feed)">SIM</span>
          }
          @if (alertCount() > 0) {
            <span
              class="text-[10px] font-semibold text-warn tabular-nums"
              [attr.aria-label]="alertCount() + ' active alerts'">
              ● {{ alertCount() }}
            </span>
          }
        </div>
        <div class="text-xs text-ink-faint truncate">{{ stock().name }}</div>
      </div>

      <div class="text-right font-mono tabular-nums">
        <!--
          A CSS animation only replays when its element is new. Tracking by updatedAt (a new Date
          every tick) makes Angular destroy and recreate this one <div> per tick, restarting the flash.
        -->
        @for (tick of [stock().updatedAt]; track tick) {
          <div class="text-sm px-1 -mx-1 rounded-sm" [class]="flashClass()">
            {{ currency() }}{{ stock().price | number: '1.2-4' }}
          </div>
        }
        <div class="text-xs" [class]="isUp() ? 'text-up' : 'text-down'">
          {{ isUp() ? '▲ +' : '▼ ' }}{{ stock().changePercent | number: '1.2-2' }}%
        </div>
      </div>
    </button>
  `,
  // block: virtual scrolling measures rows, and an inline host element has no height.
  // Exactly 56 px tall (h-14, border included) — must match itemSize in watchlist.ts.
  host: { class: 'block' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WatchlistRow {
  readonly stock = input.required<StockPrice>();
  readonly selected = input(false);
  readonly alertCount = input(0);
  readonly selectSymbol = output<string>();

  private readonly priceService = inject(PriceService);
  private readonly liveFeed = inject(RUNTIME_OPTIONS).feed === 'live';

  /**
   * The stock object is new every tick, but the symbol string is equal, so this computed
   * stops propagation there: currency() below is NOT recomputed per tick (Backlog #9).
   */
  private readonly symbol = computed(() => this.stock().symbol);
  private readonly isCrypto = computed(() => this.priceService.isCrypto(this.symbol()));
  readonly currency = computed(() => (this.isCrypto() ? '$' : '₹'));

  /** With the live backend, crypto is real (Binance) but NSE stocks are simulated server-side */
  readonly simulated = computed(() => this.liveFeed && !this.isCrypto());

  readonly isUp = computed(() => this.stock().change >= 0);

  /** Tick-to-tick direction (vs. isUp, which is vs. the session's base price) */
  readonly flashClass = computed(() => {
    const { price, previousPrice } = this.stock();
    if (price > previousPrice) return 'motion-safe:animate-flash-up';
    if (price < previousPrice) return 'motion-safe:animate-flash-down';
    return '';
  });
}
