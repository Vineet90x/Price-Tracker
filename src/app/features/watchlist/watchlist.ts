import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Skeleton } from 'primeng/skeleton';
import { PriceService } from '../../core/services/price.service';

@Component({
  selector: 'app-watchlist',
  standalone: true,
  imports: [DatePipe, Skeleton],
  template: `
    <div class="p-6 max-w-7xl mx-auto space-y-6">
      <!-- Header & Top Stats Banner -->
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div class="flex items-center gap-3">
            <h1 class="text-3xl font-extrabold tracking-tight text-white">Live Watchlist</h1>
            
            <!-- Clean Live Streaming Badge -->
            <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/60 border border-cyan-800/50 text-cyan-400 text-xs font-semibold shadow-sm">
              <span class="relative flex h-2 w-2">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span class="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
              </span>
              <span>LIVE FEED</span>
            </div>
          </div>
          <p class="text-slate-400 mt-1">Real-time stock and crypto market prices.</p>
        </div>

        <!-- Summary Badges using computed signals -->
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

      <!-- Live Asset Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        @for (stock of priceService.pricesSignal(); track stock.symbol) {
          <div 
            class="bg-slate-900/80 border rounded-2xl p-5 transition-all duration-300 hover:border-slate-700 shadow-lg relative overflow-hidden group cursor-pointer"
            [class.border-emerald-500/50]="stock.change >= 0"
            [class.border-rose-500/50]="stock.change < 0">
            
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
              
              <!-- Gain/Loss Badge -->
              <span 
                class="px-2.5 py-1 rounded-lg text-xs font-extrabold flex items-center gap-1 shadow-sm"
                [class.bg-emerald-500/10]="stock.change >= 0"
                [class.text-emerald-400]="stock.change >= 0"
                [class.border]="true"
                [class.border-emerald-500/20]="stock.change >= 0"
                [class.bg-rose-500/10]="stock.change < 0"
                [class.text-rose-400]="stock.change < 0"
                [class.border-rose-500/20]="stock.change < 0">
                {{ stock.change >= 0 ? '+' : '' }}{{ stock.changePercent }}%
              </span>
            </div>

            <div class="mt-5 flex items-baseline justify-between pt-3 border-t border-slate-800/80">
              <div>
                <span class="text-2xl font-black tracking-tight text-white">
                  {{ isCrypto(stock.symbol) ? '$' : '₹' }}{{ stock.price.toLocaleString() }}
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
        } @empty {
          <!-- Official PrimeNG Skeleton Loader Placeholder -->
          <div class="col-span-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <p-skeleton width="100%" height="160px" borderRadius="16px" styleClass="!bg-slate-900/80 !border !border-slate-800" />
            <p-skeleton width="100%" height="160px" borderRadius="16px" styleClass="!bg-slate-900/80 !border !border-slate-800" />
            <p-skeleton width="100%" height="160px" borderRadius="16px" styleClass="!bg-slate-900/80 !border !border-slate-800" />
          </div>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Watchlist {
  readonly priceService = inject(PriceService);

  isCrypto(symbol: string): boolean {
    return symbol === 'BTC' || symbol === 'ETH';
  }

  getLogoBgClass(symbol: string): string {
    switch (symbol) {
      case 'BTC':
        return 'bg-gradient-to-tr from-amber-500 to-yellow-600 shadow-amber-500/20';
      case 'ETH':
        return 'bg-gradient-to-tr from-indigo-500 to-purple-600 shadow-indigo-500/20';
      case 'RELIANCE':
        return 'bg-gradient-to-tr from-blue-600 to-cyan-600 shadow-blue-500/20';
      case 'TCS':
        return 'bg-gradient-to-tr from-purple-600 to-pink-600 shadow-purple-500/20';
      case 'INFY':
        return 'bg-gradient-to-tr from-sky-500 to-blue-600 shadow-sky-500/20';
      default:
        return 'bg-gradient-to-tr from-slate-700 to-slate-800';
    }
  }
}
