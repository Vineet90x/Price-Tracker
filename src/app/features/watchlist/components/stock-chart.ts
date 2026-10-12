import {
  Component,
  Input,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  inject,
  PLATFORM_ID,
  ChangeDetectionStrategy,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subscription } from 'rxjs';
import { createChart, IChartApi, ISeriesApi, AreaSeries, ColorType } from 'lightweight-charts';
import { PriceService } from '../../../core/services/price.service';

@Component({
  selector: 'app-stock-chart',
  standalone: true,
  template: `
    <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-2xl backdrop-blur relative overflow-hidden">
      <!-- Chart Header -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-4 border-b border-slate-800/80">
        <div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-black text-cyan-400 tracking-wider uppercase">TRADINGVIEW CHART</span>
            <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300">
              LIVE (1.5s Ticks)
            </span>
          </div>
          <h2 class="text-xl font-extrabold text-white mt-1 flex items-center gap-2">
            <span>{{ symbol }}</span>
            <span class="text-sm font-normal text-slate-400">Continuous Price Series</span>
          </h2>
        </div>

        <div class="text-left sm:text-right">
          <span class="text-[11px] text-slate-500 font-semibold block uppercase tracking-wider">WINDOW</span>
          <span class="text-xs font-mono text-cyan-400 font-bold">Last 50 Data Points</span>
        </div>
      </div>

      <!-- Canvas Mounting Target -->
      <div #chartContainer class="w-full h-[320px] rounded-xl overflow-hidden"></div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StockChart implements AfterViewInit, OnDestroy, OnChanges {
  @Input({ required: true }) symbol!: string;
  @ViewChild('chartContainer', { static: false }) chartContainer!: ElementRef<HTMLDivElement>;

  private chart?: IChartApi;
  private lineSeries?: ISeriesApi<'Area'>;
  private resizeObserver?: ResizeObserver;
  private priceSub?: Subscription;

  private readonly priceService = inject(PriceService);
  private readonly platformId = inject(PLATFORM_ID);

  ngAfterViewInit(): void {
    // Ensure chart only mounts in browser environment (safe for Angular SSR)
    if (!isPlatformBrowser(this.platformId) || !this.chartContainer) {
      return;
    }

    this.initChart();
    this.subscribeToTicks();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['symbol'] && !changes['symbol'].firstChange && this.lineSeries) {
      // Reload series data when user clicks a different asset
      const history = this.priceService.getPriceHistory(this.symbol);
      this.lineSeries.setData(history as any);
      if (this.chart) {
        this.chart.timeScale().fitContent();
      }
    }
  }

  ngOnDestroy(): void {
    this.priceSub?.unsubscribe();
    this.resizeObserver?.disconnect();
    if (this.chart) {
      this.chart.remove();
    }
  }

  private initChart(): void {
    const container = this.chartContainer.nativeElement;

    // 1. Create Lightweight-Charts instance with dark theme palette
    this.chart = createChart(container, {
      width: container.clientWidth || 600,
      height: 320,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.04)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.04)' },
      },
      crosshair: {
        vertLine: { color: 'rgba(6, 182, 212, 0.4)', width: 1 },
        horzLine: { color: 'rgba(6, 182, 212, 0.4)', width: 1 },
      },
      localization: {
        timeFormatter: (time: number) => {
          return new Date(time * 1000).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          });
        },
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        timeVisible: true,
        secondsVisible: true,
        tickMarkFormatter: (time: number) => {
          return new Date(time * 1000).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          });
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
      },
    });

    // 2. Add Area Series with glowing gradient fill
    this.lineSeries = this.chart.addSeries(AreaSeries, {
      lineColor: '#06b6d4',
      topColor: 'rgba(6, 182, 212, 0.4)',
      bottomColor: 'rgba(6, 182, 212, 0.0)',
      lineWidth: 2,
    });

    // 3. Load historical data points
    const history = this.priceService.getPriceHistory(this.symbol);
    this.lineSeries.setData(history as any);
    this.chart.timeScale().fitContent();

    // 4. Setup responsive resize observer
    this.resizeObserver = new ResizeObserver((entries) => {
      if (entries.length > 0 && this.chart) {
        const { width } = entries[0].contentRect;
        this.chart.applyOptions({ width });
      }
    });
    this.resizeObserver.observe(container);
  }

  private subscribeToTicks(): void {
    this.priceSub = this.priceService.prices$.subscribe((prices) => {
      if (!this.lineSeries) return;

      const current = prices.find((p) => p.symbol === this.symbol);
      if (current) {
        const nowSeconds = Math.floor(Date.now() / 1000);
        this.lineSeries.update({
          time: nowSeconds as any,
          value: current.price,
        });
      }
    });
  }
}
