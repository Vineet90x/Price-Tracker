import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  signal,
  Signal,
  TrackByFunction,
} from '@angular/core';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { debounceTime, startWith, switchMap } from 'rxjs/operators';
import { Skeleton } from 'primeng/skeleton';
import { PriceService, AssetInfo } from '../../core/services/price.service';
import { StockPrice } from '../../core/models/stock.model';
import { RUNTIME_OPTIONS } from '../../core/config/runtime-options';
import { AlertService } from '../../core/services/alert.service';
import { StockChart } from './components/stock-chart';
import { WatchlistRow } from './components/watchlist-row';
import { AlertPanel } from './components/alert-panel';

/**
 * Watchlist page = 3-pane trading terminal.
 *   LEFT   search + watchlist rows      (<app-watchlist-row>)
 *   CENTRE selected symbol header + chart (<app-stock-chart>)
 *   RIGHT  alerts for the selected symbol (<app-alert-panel>)
 * This component owns only page-level state: which symbol is selected, and the search box.
 */
@Component({
  selector: 'app-watchlist',
  standalone: true,
  imports: [
    DatePipe,
    DecimalPipe,
    ReactiveFormsModule,
    ScrollingModule,
    Skeleton,
    StockChart,
    WatchlistRow,
    AlertPanel,
  ],
  template: `
    <!--
      < lg : one column, panes stacked, the page (main) scrolls.
      lg   : list | chart, alerts under the chart.
      xl   : list | chart | alerts.
      minmax(0,1fr) instead of 1fr lets the chart column shrink below the canvas width.
    -->
    <div
      class="grid grid-cols-1
             lg:h-full lg:grid-cols-[300px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)_auto]
             xl:grid-cols-[320px_minmax(0,1fr)_300px] xl:grid-rows-[minmax(0,1fr)]">

      <!-- ── LEFT: search + watchlist ─────────────────────────────────── -->
      <aside class="flex flex-col lg:min-h-0 lg:row-span-2 xl:row-span-1 border-b lg:border-b-0 lg:border-r border-line bg-surface-1">
        <div class="h-10 shrink-0 px-3 flex items-center justify-between border-b border-line text-xs">
          <span class="font-semibold">
            Watchlist <span class="text-ink-faint tabular-nums">({{ priceService.totalTracked() }})</span>
            @if (!virtualScroll) {
              <span class="ml-1 text-warn font-medium" title="?virtual=0: every row is in the DOM">· virtual off</span>
            }
          </span>
          <span class="flex gap-3 tabular-nums font-medium">
            <span class="text-up">▲ {{ priceService.gainersCount() }}</span>
            <span class="text-down">▼ {{ priceService.losersCount() }}</span>
          </span>
        </div>

        <!-- Search & add symbol -->
        <div class="relative shrink-0 p-2 border-b border-line">
          <div class="flex items-center gap-2 h-9 px-2.5 rounded bg-surface-0 border border-line focus-within:border-accent transition-colors">
            <svg class="w-4 h-4 text-ink-faint shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              [formControl]="searchControl"
              (focus)="isSearchOpen.set(true)"
              (blur)="onSearchBlur()"
              type="text"
              id="symbol-search"
              aria-label="Search symbols"
              placeholder="Search e.g. BTC, bitcoin, tata"
              class="flex-1 min-w-0 bg-transparent text-sm placeholder:text-ink-faint outline-none"
            />
            @if (searchControl.value) {
              <button type="button" (click)="clearSearch()" aria-label="Clear search" class="text-ink-faint hover:text-ink transition-colors">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            }
          </div>

          @if (isSearchOpen() && searchControl.value && searchControl.value.trim()) {
            <div
              class="absolute z-50 left-2 right-2 top-full mt-1 rounded border border-line bg-surface-1 shadow-xl shadow-black/50 overflow-hidden"
              (mousedown)="$event.preventDefault()">
              @if (searchResults().length === 0) {
                <p class="p-4 text-center text-xs text-ink-muted">
                  No symbols match "{{ searchControl.value }}"
                </p>
              } @else {
                <div class="max-h-72 overflow-y-auto divide-y divide-line">
                  @for (result of searchResults(); track result.symbol) {
                    <div class="flex items-center justify-between gap-3 h-12 px-3 hover:bg-surface-2 transition-colors">
                      <div class="min-w-0">
                        <div class="flex items-center gap-1.5">
                          <span class="text-sm font-semibold">{{ result.symbol }}</span>
                          <span class="px-1 rounded-sm text-[9px] font-semibold bg-surface-2 text-ink-muted">
                            {{ result.isCrypto ? 'CRYPTO' : 'NSE' }}
                          </span>
                        </div>
                        <p class="text-xs text-ink-faint truncate">{{ result.name }}</p>
                      </div>
                      @if (priceService.isTracked(result.symbol)) {
                        <span class="shrink-0 text-xs font-medium text-ink-faint">✓ Added</span>
                      } @else {
                        <button
                          type="button"
                          (click)="addToWatchlist(result.symbol)"
                          class="shrink-0 h-7 px-2.5 rounded text-xs font-semibold bg-surface-2 text-ink hover:bg-accent hover:text-white transition-colors">
                          + Add
                        </button>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          }
        </div>

        <!--
          Rows. Virtual scrolling (Phase 1 Step 7): the CDK viewport renders only the rows in view
          (+ a small buffer) and recycles them while you scroll; every row must be exactly itemSize px.
          ?virtual=0 renders all rows instead, to compare the two.
        -->
        @if (priceService.pricesSignal().length === 0) {
          @for (i of [1, 2, 3, 4, 5]; track i) {
            <div class="h-14 px-3 flex items-center">
              <p-skeleton width="100%" height="32px" styleClass="bg-surface-2!" />
            </div>
          }
        } @else if (virtualScroll) {
          <cdk-virtual-scroll-viewport
            itemSize="56"
            minBufferPx="280"
            maxBufferPx="560"
            class="h-[45dvh] lg:h-auto lg:flex-1 lg:min-h-0">
            <app-watchlist-row
              *cdkVirtualFor="let stock of priceService.pricesSignal(); trackBy: trackBySymbol"
              [stock]="stock"
              [selected]="selectedSymbol() === stock.symbol"
              [alertCount]="alertService.alertCountBySymbol().get(stock.symbol) ?? 0"
              (selectSymbol)="selectedSymbol.set($event)" />
          </cdk-virtual-scroll-viewport>
        } @else {
          <div class="max-h-[45dvh] overflow-y-auto lg:max-h-none lg:flex-1 lg:min-h-0">
            @for (stock of priceService.pricesSignal(); track stock.symbol) {
              <app-watchlist-row
                [stock]="stock"
                [selected]="selectedSymbol() === stock.symbol"
                [alertCount]="alertService.alertCountBySymbol().get(stock.symbol) ?? 0"
                (selectSymbol)="selectedSymbol.set($event)" />
            }
          </div>
        }
      </aside>

      <!-- ── CENTRE: selected symbol header + chart ───────────────────── -->
      <section class="min-w-0 flex flex-col lg:min-h-0 lg:col-start-2 lg:row-start-1">
        <div class="shrink-0 min-h-14 px-4 py-2 flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-line">
          @if (selectedStock(); as s) {
            <div class="flex items-baseline gap-2">
              <h1 class="text-base font-semibold">{{ s.symbol }}</h1>
              <span class="text-xs text-ink-muted">{{ s.name }}</span>
            </div>
            <div class="flex items-baseline gap-3 font-mono tabular-nums">
              <span class="text-xl font-semibold">{{ selectedCurrency() }}{{ s.price | number: '1.2-4' }}</span>
              <span class="text-sm" [class]="s.change >= 0 ? 'text-up' : 'text-down'">
                {{ s.change >= 0 ? '+' : '' }}{{ s.change | number: '1.2-4' }}
                ({{ s.change >= 0 ? '+' : '' }}{{ s.changePercent | number: '1.2-2' }}%)
              </span>
            </div>
            @if (selectedRange(); as r) {
              <div class="flex gap-4 text-xs text-ink-muted font-mono tabular-nums" title="High / low of the last 50 ticks">
                <span>H <span class="text-ink">{{ r.high | number: '1.2-4' }}</span></span>
                <span>L <span class="text-ink">{{ r.low | number: '1.2-4' }}</span></span>
              </div>
            }
            <span class="ml-auto text-xs text-ink-faint font-mono tabular-nums">{{ s.updatedAt | date: 'HH:mm:ss' }}</span>
          } @else {
            <p-skeleton width="260px" height="28px" styleClass="bg-surface-2!" />
          }
        </div>

        <!-- Mobile: fixed 320 px (a % height of an auto-height parent is 0). Desktop: fill the pane. -->
        <div class="h-80 p-2 lg:h-auto lg:flex-1 lg:min-h-64">
          <app-stock-chart class="block h-full" [symbol]="selectedSymbol()" />
        </div>
      </section>

      <!-- ── RIGHT: alerts for the selected symbol ────────────────────── -->
      <aside
        class="border-t border-line bg-surface-1
               lg:col-start-2 lg:row-start-2 lg:max-h-72 lg:overflow-y-auto
               xl:col-start-3 xl:row-start-1 xl:max-h-none xl:min-h-0 xl:border-t-0 xl:border-l">
        @if (selectedStock(); as s) {
          <app-alert-panel [symbol]="s.symbol" [price]="s.price" [currency]="selectedCurrency()" />
        }
      </aside>
    </div>
  `,
  host: { class: 'block lg:h-full' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Watchlist {
  readonly priceService = inject(PriceService);
  readonly alertService = inject(AlertService);

  readonly selectedSymbol = signal<string>('BTC');

  /** false when the URL has ?virtual=0 (Step 7 comparison) */
  readonly virtualScroll = inject(RUNTIME_OPTIONS).virtualScroll;

  /** *cdkVirtualFor has no `track` syntax; it takes a trackBy function instead */
  readonly trackBySymbol: TrackByFunction<StockPrice> = (_index, stock) => stock.symbol;

  /** Latest tick of the selected symbol; undefined until the first tick (~1.5 s) arrives */
  readonly selectedStock = computed(() =>
    this.priceService.pricesSignal().find((s) => s.symbol === this.selectedSymbol())
  );

  readonly selectedCurrency = computed(() =>
    this.priceService.isCrypto(this.selectedSymbol()) ? '$' : '₹'
  );

  /**
   * High / low over the chart's history window.
   * The history array is mutated in place inside PriceService (not a signal), so we read
   * pricesSignal() only to re-run this once per tick. That workaround goes away with Backlog #10.
   */
  readonly selectedRange = computed(() => {
    this.priceService.pricesSignal();
    const values = this.priceService.getPriceHistory(this.selectedSymbol()).map((p) => p.value);
    return values.length ? { high: Math.max(...values), low: Math.min(...values) } : null;
  });

  // ─── Search State ──────────────────────────────────────────────────────────
  readonly searchControl = new FormControl('');
  readonly isSearchOpen = signal(false);
  readonly searchResults: Signal<AssetInfo[]>;

  constructor() {
    this.searchResults = toSignal(
      this.searchControl.valueChanges.pipe(
        startWith(''),
        debounceTime(300),
        switchMap((term) => of(this.priceService.searchSymbols(term ?? '')))
      ),
      { initialValue: [] }
    );
  }

  // ─── Search Actions ────────────────────────────────────────────────────────

  addToWatchlist(symbol: string): void {
    this.priceService.addSymbol(symbol);
    this.searchControl.setValue('');
    this.isSearchOpen.set(false);
    this.selectedSymbol.set(symbol);
  }

  clearSearch(): void {
    this.searchControl.setValue('');
  }

  onSearchBlur(): void {
    setTimeout(() => this.isSearchOpen.set(false), 150);
  }
}
