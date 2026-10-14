import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  Signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { debounceTime, startWith, switchMap } from 'rxjs/operators';
import { Skeleton } from 'primeng/skeleton';
import { PriceService, AssetInfo } from '../../core/services/price.service';
import { AlertService } from '../../core/services/alert.service';
import { StockChart } from './components/stock-chart';

// ─── Custom Validator ────────────────────────────────────────────────────────
/**
 * Factory function that creates a validator checking the typed target price
 * is NOT equal to the current live price of the symbol.
 *
 * WHY a factory (not a plain validator):
 * A plain validator receives only the control's value. We need the current price
 * too — so we close over it via a factory parameter. The validator is re-created
 * each time the form is rendered for a different stock (current price changes).
 *
 * Angular calls this on every value change inside the FormGroup.
 */
function targetPriceDifferentFromCurrent(currentPrice: number) {
  return (control: AbstractControl): ValidationErrors | null => {
    const val = Number(control.value);
    if (isNaN(val)) return null; // Let 'required' handle blank values
    return val === currentPrice
      ? { samePriceAsCurrentError: { current: currentPrice, given: val } }
      : null;
  };
}

@Component({
  selector: 'app-watchlist',
  standalone: true,
  imports: [DatePipe, ReactiveFormsModule, Skeleton, StockChart],
  template: `
    <div class="p-6 max-w-7xl mx-auto space-y-6">

      <!-- ── Header & Top Stats Banner ───────────────────────────────── -->
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div class="flex items-center gap-3">
            <h1 class="text-3xl font-extrabold tracking-tight text-white">Live Watchlist</h1>

            <!-- Live Streaming Badge -->
            <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/60 border border-cyan-800/50 text-cyan-400 text-xs font-semibold shadow-sm">
              <span class="relative flex h-2 w-2">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span class="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
              </span>
              <span>LIVE FEED</span>
            </div>
          </div>
          <p class="text-slate-400 mt-1">Real-time stock and crypto market prices. Click any card to view its chart.</p>
        </div>

        <!-- Summary Badges -->
        <div class="flex items-center gap-3">
          <div class="bg-slate-900 border border-slate-800 px-4 py-2 rounded-xl text-center shadow-sm">
            <span class="text-[11px] text-slate-400 uppercase font-semibold tracking-wider">Total</span>
            <p class="text-lg font-bold text-white mt-0.5">{{ priceService.totalTracked() }}</p>
          </div>
          <div class="bg-emerald-950/40 border border-emerald-900/50 px-4 py-2 rounded-xl text-center shadow-sm">
            <span class="text-[11px] text-emerald-400 uppercase font-semibold tracking-wider">Gainers</span>
            <p class="text-lg font-bold text-emerald-400 mt-0.5">{{ priceService.gainersCount() }}</p>
          </div>
          <div class="bg-rose-950/40 border border-rose-900/50 px-4 py-2 rounded-xl text-center shadow-sm">
            <span class="text-[11px] text-rose-400 uppercase font-semibold tracking-wider">Losers</span>
            <p class="text-lg font-bold text-rose-400 mt-0.5">{{ priceService.losersCount() }}</p>
          </div>
        </div>
      </div>

      <!-- ── Search & Add Symbol ──────────────────────────────────────── -->
      <div class="relative">
        <div class="flex items-center gap-3 bg-slate-900/80 border border-slate-800 rounded-2xl px-4 py-3 focus-within:border-cyan-600/50 focus-within:ring-1 focus-within:ring-cyan-600/20 transition-all duration-300 shadow-lg">
          <svg class="w-4 h-4 text-slate-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            [formControl]="searchControl"
            (focus)="isSearchOpen.set(true)"
            (blur)="onSearchBlur()"
            type="text"
            id="symbol-search"
            placeholder="Search by ticker or name — e.g. 'BTC' or 'bitcoin'..."
            class="flex-1 bg-transparent text-white placeholder-slate-500 text-sm outline-none"
          />
          @if (searchControl.value) {
            <button (click)="clearSearch()" class="text-slate-500 hover:text-slate-300 transition-colors flex-shrink-0">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          }
        </div>

        <!-- Search Results Dropdown -->
        @if (isSearchOpen() && searchControl.value && searchControl.value.trim()) {
          <div
            class="absolute z-50 top-full mt-2 w-full bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl overflow-hidden"
            (mousedown)="$event.preventDefault()">

            @if (searchResults().length === 0) {
              <div class="p-6 text-center">
                <div class="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center mx-auto mb-3">
                  <svg class="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p class="text-slate-400 text-sm font-medium">No symbols found for "{{ searchControl.value }}"</p>
                <p class="text-slate-600 text-xs mt-1">Try "BTC", "bitcoin", "INFY", or "tata"</p>
              </div>
            } @else {
              <div class="max-h-72 overflow-y-auto divide-y divide-slate-800/60">
                @for (result of searchResults(); track result.symbol) {
                  <div class="flex items-center justify-between px-4 py-3 hover:bg-slate-800/50 transition-colors duration-150">
                    <div class="flex items-center gap-3 min-w-0">
                      <div
                        class="w-9 h-9 rounded-xl flex items-center justify-center text-white text-[10px] font-black shadow-md flex-shrink-0"
                        [class]="getLogoBgClass(result.symbol)">
                        {{ result.symbol.slice(0, 3) }}
                      </div>
                      <div class="min-w-0">
                        <div class="flex items-center gap-2">
                          <span class="text-white font-bold text-sm">{{ result.symbol }}</span>
                          <span
                            class="px-1.5 py-0.5 rounded text-[9px] font-bold flex-shrink-0"
                            [class]="result.isCrypto ? 'bg-amber-500/15 text-amber-400' : 'bg-blue-500/15 text-blue-400'">
                            {{ result.isCrypto ? 'CRYPTO' : 'STOCK' }}
                          </span>
                        </div>
                        <p class="text-slate-400 text-xs mt-0.5 truncate">{{ result.name }}</p>
                      </div>
                    </div>
                    @if (priceService.isTracked(result.symbol)) {
                      <span class="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
                        </svg>
                        Tracking
                      </span>
                    } @else {
                      <button
                        (click)="addToWatchlist(result.symbol)"
                        class="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-cyan-600 text-slate-300 hover:text-white border border-slate-700 hover:border-cyan-500 transition-all duration-200">
                        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" />
                        </svg>
                        Add
                      </button>
                    }
                  </div>
                }
              </div>
            }
          </div>
        }
      </div>

      <!-- ── Live Asset Grid ───────────────────────────────────────────── -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        @for (stock of priceService.pricesSignal(); track stock.symbol) {
          <div
            class="bg-slate-900/80 border rounded-2xl transition-all duration-300 shadow-lg relative overflow-hidden group"
            [class.border-emerald-500/50]="stock.change >= 0"
            [class.border-rose-500/50]="stock.change < 0"
            [class.ring-2]="selectedSymbol() === stock.symbol"
            [class.ring-cyan-400]="selectedSymbol() === stock.symbol">

            <!-- Card click area (top part) — selects for chart -->
            <div class="p-5 cursor-pointer" (click)="selectedSymbol.set(stock.symbol)">
              <div class="flex items-start justify-between">
                <div class="flex items-center gap-3">
                  <!-- Brand Gradient Logo Avatar -->
                  <div
                    class="w-11 h-11 rounded-xl flex items-center justify-center text-white font-extrabold shadow-md transition-transform group-hover:scale-105"
                    [class]="getLogoBgClass(stock.symbol)">
                    @switch (stock.symbol) {
                      @case ('BTC') {
                        <svg class="w-6 h-6 fill-current" viewBox="0 0 24 24">
                          <path d="M23.638 14.904c-1.602 6.43-8.113 10.34-14.542 8.736C2.67 22.05-1.244 15.525.362 9.105 1.962 2.67 8.475-1.243 14.9.358c6.43 1.605 10.342 8.115 8.738 14.548zm-6.34-4.57c.287-1.92-1.173-2.952-3.17-3.64l.648-2.602-1.583-.395-.63 2.533c-.416-.104-.844-.2-1.27-.296l.635-2.548-1.582-.395-.648 2.6c-.344-.078-.684-.156-1.016-.237l.002-.01-2.183-.545-.42 1.69s1.176.27 1.15.286c.642.16.758.583.738.918l-.74 2.97c.044.01.101.026.164.05-.053-.013-.11-.027-.165-.04l-1.037 4.16c-.078.196-.277.49-.724.378.016.023-1.15-.287-1.15-.287l-.784 1.81 2.06.514c.384.096.76.196 1.13.292l-.656 2.636 1.58.395.647-2.6c.432.117.85.228 1.26.333l-.645 2.593 1.584.395.656-2.632c2.7.512 4.733.305 5.588-2.138.69-1.968-.034-3.103-1.46-3.842 1.037-.24 1.82-.92 2.03-2.327z" />
                        </svg>
                      }
                      @case ('ETH') {
                        <svg class="w-6 h-6 fill-current" viewBox="0 0 24 24">
                          <path d="M11.944 17.97L4.58 13.62 11.943 24l7.37-10.38-7.372 4.35h.003zM12.056 0L4.69 12.223l7.365 4.354 7.365-4.35L12.056 0z" />
                        </svg>
                      }
                      @case ('RELIANCE') {
                        <svg class="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                      }
                      @case ('TCS') {
                        <svg class="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                        </svg>
                      }
                      @default {
                        <svg class="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                      }
                    }
                  </div>

                  <div>
                    <span class="text-xs font-black text-cyan-400 tracking-wider uppercase">{{ stock.symbol }}</span>
                    <h3 class="text-base font-bold text-white leading-tight mt-0.5">{{ stock.name }}</h3>
                  </div>
                </div>

                <!-- Right side: Gain/Loss Badge + Bell Button -->
                <div class="flex items-center gap-2">
                  <!-- Gain/Loss Badge -->
                  <span
                    class="px-2.5 py-1 rounded-lg text-xs font-extrabold flex items-center gap-1 shadow-sm border"
                    [class.bg-emerald-500/10]="stock.change >= 0"
                    [class.text-emerald-400]="stock.change >= 0"
                    [class.border-emerald-500/20]="stock.change >= 0"
                    [class.bg-rose-500/10]="stock.change < 0"
                    [class.text-rose-400]="stock.change < 0"
                    [class.border-rose-500/20]="stock.change < 0">
                    {{ stock.change >= 0 ? '+' : '' }}{{ stock.changePercent }}%
                  </span>

                  <!--
                    Bell Icon Button — toggles the alert form panel.
                    stopPropagation() prevents triggering the chart-select click on the parent.
                  -->
                  <button
                    (click)="toggleAlertForm(stock.symbol); $event.stopPropagation()"
                    [id]="'bell-btn-' + stock.symbol"
                    class="relative p-2 rounded-lg transition-all duration-200"
                    [class.bg-amber-500/20]="alertService.alertCountForSymbol(stock.symbol) > 0"
                    [class.text-amber-400]="alertService.alertCountForSymbol(stock.symbol) > 0"
                    [class.bg-slate-800]="alertService.alertCountForSymbol(stock.symbol) === 0"
                    [class.text-slate-400]="alertService.alertCountForSymbol(stock.symbol) === 0"
                    [class.hover:text-amber-400]="alertService.alertCountForSymbol(stock.symbol) === 0"
                    title="Set price alert">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                    <!-- Active alert count badge -->
                    @if (alertService.alertCountForSymbol(stock.symbol) > 0) {
                      <span class="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 text-[9px] font-black text-slate-900 rounded-full flex items-center justify-center">
                        {{ alertService.alertCountForSymbol(stock.symbol) }}
                      </span>
                    }
                  </button>
                </div>
              </div>

              <!-- Price row -->
              <div class="mt-5 flex items-baseline justify-between pt-3 border-t border-slate-800/80">
                <div>
                  <span class="text-2xl font-black tracking-tight text-white">
                    {{ priceService.isCrypto(stock.symbol) ? '$' : '₹' }}{{ stock.price.toLocaleString() }}
                  </span>
                  <p
                    class="text-xs font-bold mt-0.5 flex items-center gap-1"
                    [class.text-emerald-400]="stock.change >= 0"
                    [class.text-rose-400]="stock.change < 0">
                    <span>{{ stock.change >= 0 ? '▲' : '▼' }}</span>
                    <span>{{ stock.change >= 0 ? '+' : '' }}{{ stock.change }}</span>
                  </p>
                </div>

                <div class="text-right">
                  <span class="text-[10px] text-slate-500 uppercase tracking-wider font-semibold block">LAST TICK</span>
                  <span class="text-xs text-slate-400 font-mono font-medium">
                    {{ stock.updatedAt | date:'HH:mm:ss' }}
                  </span>
                </div>
              </div>
            </div>

            <!-- ── Alert Panel (toggles per card) ─────────────────────────── -->
            @if (openAlertSymbol() === stock.symbol) {
              <div class="border-t border-slate-800/80 bg-slate-950/60 px-5 py-4" (click)="$event.stopPropagation()">

                <!-- Existing active alerts for this symbol -->
                @if (alertService.alertsForSymbol(stock.symbol).length > 0) {
                  <div class="mb-3 space-y-2">
                    @for (alert of alertService.alertsForSymbol(stock.symbol); track alert.id) {
                      <div class="flex items-center justify-between bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                        <span class="text-xs text-amber-300 font-semibold">
                          {{ alert.direction === 'above' ? '▲ Above' : '▼ Below' }}
                          <span class="font-black ml-1">
                            {{ priceService.isCrypto(stock.symbol) ? '$' : '₹' }}{{ alert.targetPrice.toLocaleString() }}
                          </span>
                        </span>
                        <button
                          (click)="alertService.removeAlert(alert.id)"
                          class="text-slate-500 hover:text-rose-400 transition-colors">
                          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    }
                  </div>
                }

                <!-- Set New Alert Form -->
                <form [formGroup]="getOrCreateAlertForm(stock.symbol, stock.price)" (ngSubmit)="submitAlert(stock.symbol, stock.price)">
                  <p class="text-[11px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Set New Alert</p>

                  <!-- Direction selector -->
                  <div class="flex gap-2 mb-3">
                    <label class="flex-1 cursor-pointer">
                      <input type="radio" formControlName="direction" value="above" class="sr-only peer" />
                      <span class="block text-center text-xs font-bold py-1.5 rounded-lg border transition-all duration-200
                                   border-slate-700 text-slate-400
                                   peer-checked:border-emerald-500/50 peer-checked:bg-emerald-500/10 peer-checked:text-emerald-400">
                        ▲ Above
                      </span>
                    </label>
                    <label class="flex-1 cursor-pointer">
                      <input type="radio" formControlName="direction" value="below" class="sr-only peer" />
                      <span class="block text-center text-xs font-bold py-1.5 rounded-lg border transition-all duration-200
                                   border-slate-700 text-slate-400
                                   peer-checked:border-rose-500/50 peer-checked:bg-rose-500/10 peer-checked:text-rose-400">
                        ▼ Below
                      </span>
                    </label>
                  </div>

                  <!-- Target price input + submit -->
                  <div class="flex gap-2">
                    <div class="flex-1 relative">
                      <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-bold">
                        {{ priceService.isCrypto(stock.symbol) ? '$' : '₹' }}
                      </span>
                      <input
                        formControlName="targetPrice"
                        type="number"
                        step="any"
                        [id]="'alert-price-' + stock.symbol"
                        placeholder="{{ stock.price.toFixed(2) }}"
                        class="w-full bg-slate-900 border rounded-lg pl-7 pr-3 py-2 text-sm text-white placeholder-slate-600 outline-none transition-colors duration-200"
                        [class.border-slate-700]="!getAlertFormControl(stock.symbol, 'targetPrice')?.invalid || !getAlertFormControl(stock.symbol, 'targetPrice')?.touched"
                        [class.border-rose-500/50]="getAlertFormControl(stock.symbol, 'targetPrice')?.invalid && getAlertFormControl(stock.symbol, 'targetPrice')?.touched"
                        [class.focus:border-cyan-600]="true"
                      />
                    </div>
                    <button
                      type="submit"
                      [disabled]="getOrCreateAlertForm(stock.symbol, stock.price).invalid"
                      class="px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed bg-cyan-600 hover:bg-cyan-500 text-white disabled:bg-slate-700 disabled:text-slate-400">
                      Set Alert
                    </button>
                  </div>

                  <!-- Validation error messages -->
                  @if (getAlertFormControl(stock.symbol, 'targetPrice')?.touched) {
                    @if (getAlertFormControl(stock.symbol, 'targetPrice')?.hasError('required')) {
                      <p class="text-rose-400 text-[11px] mt-1.5">Please enter a target price.</p>
                    } @else if (getAlertFormControl(stock.symbol, 'targetPrice')?.hasError('min')) {
                      <p class="text-rose-400 text-[11px] mt-1.5">Price must be greater than zero.</p>
                    } @else if (getAlertFormControl(stock.symbol, 'targetPrice')?.hasError('samePriceAsCurrentError')) {
                      <p class="text-rose-400 text-[11px] mt-1.5">
                        Target can't equal current price ({{ priceService.isCrypto(stock.symbol) ? '$' : '₹' }}{{ stock.price.toFixed(2) }}) — it would fire instantly.
                      </p>
                    }
                  }
                </form>
              </div>
            }
          </div>
        } @empty {
          <!-- PrimeNG Skeleton Loader Placeholder -->
          <div class="col-span-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <p-skeleton width="100%" height="160px" borderRadius="16px" styleClass="!bg-slate-900/80 !border !border-slate-800" />
            <p-skeleton width="100%" height="160px" borderRadius="16px" styleClass="!bg-slate-900/80 !border !border-slate-800" />
            <p-skeleton width="100%" height="160px" borderRadius="16px" styleClass="!bg-slate-900/80 !border !border-slate-800" />
          </div>
        }
      </div>

      <!-- ── Live TradingView Chart for Selected Symbol ────────────────── -->
      @if (selectedSymbol()) {
        <div class="mt-8">
          <app-stock-chart [symbol]="selectedSymbol()!" />
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Watchlist {
  readonly priceService = inject(PriceService);
  readonly alertService = inject(AlertService);

  readonly selectedSymbol = signal<string>('BTC');

  // ─── Search State ──────────────────────────────────────────────────────────
  readonly searchControl = new FormControl('');
  readonly isSearchOpen = signal(false);
  readonly searchResults: Signal<AssetInfo[]>;

  // ─── Alert Panel State ─────────────────────────────────────────────────────
  /** Which card's alert panel is currently open (null = all closed) */
  readonly openAlertSymbol = signal<string | null>(null);

  /**
   * Per-symbol alert FormGroups cache.
   * Key = symbol string. We keep one FormGroup per symbol rather than
   * recreating it every render cycle (which would reset validation state).
   */
  private alertForms = new Map<string, FormGroup>();

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

  // ─── Alert Form Helpers ────────────────────────────────────────────────────

  /**
   * Returns (or lazily creates) the FormGroup for a given symbol's alert form.
   * Recreates the 'targetPrice' validator each call so it captures the latest price.
   *
   * WHY recreate validator but not FormGroup:
   * - The FormGroup caches user input and touched state across renders.
   * - But the custom validator must always compare against the CURRENT price,
   *   so we .setValidators() on the control on every template evaluation.
   */
  getOrCreateAlertForm(symbol: string, currentPrice: number): FormGroup {
    if (!this.alertForms.has(symbol)) {
      this.alertForms.set(
        symbol,
        new FormGroup({
          targetPrice: new FormControl('', [
            Validators.required,
            Validators.min(0.000001),
            targetPriceDifferentFromCurrent(currentPrice),
          ]),
          direction: new FormControl<'above' | 'below'>('above'),
        })
      );
    } else {
      // Update the targetPrice validator with the fresh live price
      const ctrl = this.alertForms.get(symbol)!.get('targetPrice')!;
      ctrl.setValidators([
        Validators.required,
        Validators.min(0.000001),
        targetPriceDifferentFromCurrent(currentPrice),
      ]);
      ctrl.updateValueAndValidity({ emitEvent: false });
    }
    return this.alertForms.get(symbol)!;
  }

  /** Shortcut to access a single control (used in template for error messages) */
  getAlertFormControl(symbol: string, controlName: string): AbstractControl | null {
    return this.alertForms.get(symbol)?.get(controlName) ?? null;
  }

  // ─── Alert Actions ─────────────────────────────────────────────────────────

  /** Toggles the alert panel for a card. Clicking the same bell closes it. */
  toggleAlertForm(symbol: string): void {
    this.openAlertSymbol.update((current) =>
      current === symbol ? null : symbol
    );
  }

  /**
   * Validates the form and delegates to AlertService.addAlert().
   * Resets the form after submission so the user can set another alert.
   */
  submitAlert(symbol: string, currentPrice: number): void {
    const form = this.getOrCreateAlertForm(symbol, currentPrice);
    if (form.invalid) {
      form.markAllAsTouched(); // Show all validation errors
      return;
    }

    const { targetPrice, direction } = form.value;
    this.alertService.addAlert(symbol, Number(targetPrice), direction);

    // Reset only the targetPrice input, keep direction selection
    form.get('targetPrice')?.reset('');
    form.get('targetPrice')?.markAsUntouched();
  }

  // ─── Search Actions ────────────────────────────────────────────────────────

  addToWatchlist(symbol: string): void {
    this.priceService.addSymbol(symbol);
    this.searchControl.setValue('');
    this.isSearchOpen.set(false);
  }

  clearSearch(): void {
    this.searchControl.setValue('');
  }

  onSearchBlur(): void {
    setTimeout(() => this.isSearchOpen.set(false), 150);
  }

  // ─── Style Helpers ─────────────────────────────────────────────────────────

  getLogoBgClass(symbol: string): string {
    switch (symbol) {
      case 'BTC':        return 'bg-gradient-to-tr from-amber-500 to-yellow-600 shadow-amber-500/20';
      case 'ETH':        return 'bg-gradient-to-tr from-indigo-500 to-purple-600 shadow-indigo-500/20';
      case 'SOL':        return 'bg-gradient-to-tr from-purple-500 to-cyan-500 shadow-purple-500/20';
      case 'BNB':        return 'bg-gradient-to-tr from-yellow-500 to-amber-600 shadow-yellow-500/20';
      case 'ADA':        return 'bg-gradient-to-tr from-blue-500 to-indigo-600 shadow-blue-500/20';
      case 'DOT':        return 'bg-gradient-to-tr from-pink-500 to-rose-600 shadow-pink-500/20';
      case 'AVAX':       return 'bg-gradient-to-tr from-red-500 to-rose-700 shadow-red-500/20';
      case 'DOGE':       return 'bg-gradient-to-tr from-amber-400 to-yellow-500 shadow-amber-400/20';
      case 'LINK':       return 'bg-gradient-to-tr from-blue-600 to-cyan-500 shadow-blue-600/20';
      case 'UNI':        return 'bg-gradient-to-tr from-pink-500 to-fuchsia-600 shadow-pink-500/20';
      case 'MATIC':      return 'bg-gradient-to-tr from-purple-600 to-violet-700 shadow-purple-600/20';
      case 'RELIANCE':   return 'bg-gradient-to-tr from-blue-600 to-cyan-600 shadow-blue-500/20';
      case 'TCS':        return 'bg-gradient-to-tr from-purple-600 to-pink-600 shadow-purple-500/20';
      case 'INFY':       return 'bg-gradient-to-tr from-sky-500 to-blue-600 shadow-sky-500/20';
      case 'HDFCBANK':   return 'bg-gradient-to-tr from-rose-600 to-red-700 shadow-rose-500/20';
      case 'ICICIBANK':  return 'bg-gradient-to-tr from-orange-500 to-red-600 shadow-orange-500/20';
      case 'WIPRO':      return 'bg-gradient-to-tr from-teal-500 to-cyan-600 shadow-teal-500/20';
      case 'ADANIPORTS': return 'bg-gradient-to-tr from-slate-500 to-slate-700 shadow-slate-500/20';
      case 'BAJFINANCE': return 'bg-gradient-to-tr from-blue-700 to-blue-900 shadow-blue-700/20';
      case 'MARUTI':     return 'bg-gradient-to-tr from-red-600 to-rose-700 shadow-red-600/20';
      case 'TITAN':      return 'bg-gradient-to-tr from-cyan-600 to-teal-700 shadow-cyan-600/20';
      case 'SUNPHARMA':  return 'bg-gradient-to-tr from-emerald-500 to-green-600 shadow-emerald-500/20';
      case 'ONGC':       return 'bg-gradient-to-tr from-amber-700 to-orange-700 shadow-amber-700/20';
      case 'POWERGRID':  return 'bg-gradient-to-tr from-yellow-600 to-amber-700 shadow-yellow-600/20';
      case 'LTIM':       return 'bg-gradient-to-tr from-indigo-600 to-blue-700 shadow-indigo-600/20';
      default:           return 'bg-gradient-to-tr from-slate-700 to-slate-800';
    }
  }
}
