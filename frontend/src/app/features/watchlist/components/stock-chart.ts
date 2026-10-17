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
import {
  createChart,
  IChartApi,
  ISeriesApi,
  AreaSeries,
  ColorType,
  UTCTimestamp,
} from 'lightweight-charts';
import { PricePoint, PriceService } from '../../../core/services/price.service';

/** '#16c784' + 0.3 → 'rgba(22, 199, 132, 0.3)'. The canvas needs real colours, not CSS classes. */
function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function toChartPoint(p: PricePoint) {
  return { time: p.time as UTCTimestamp, value: p.value };
}

/** Fills whatever box the parent gives it (the parent sets the height). Header lives in Watchlist. */
@Component({
  selector: 'app-stock-chart',
  standalone: true,
  template: `<div #chartContainer class="w-full h-full"></div>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StockChart implements AfterViewInit, OnDestroy, OnChanges {
  @Input({ required: true }) symbol!: string;
  @ViewChild('chartContainer', { static: false }) chartContainer!: ElementRef<HTMLDivElement>;

  private chart?: IChartApi;
  private lineSeries?: ISeriesApi<'Area'>;
  private priceSub?: Subscription;

  /** Design tokens read from :root (styles.css @theme) once the chart mounts */
  private colors = { up: '', down: '', line: '', text: '', crosshair: '' };
  /** Current series colour direction, so we only call applyOptions when it flips */
  private seriesIsUp?: boolean;

  /** The history array last passed to setData(), and the time of its last drawn point */
  private drawnHistory?: readonly PricePoint[];
  private lastDrawnTime = 0;

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
      // Different asset clicked: forget what was drawn so draw() does a full setData()
      this.drawnHistory = undefined;
      this.draw();
      this.seriesIsUp = undefined;
      this.applySeriesColor(this.latestChangeIsUp());
    }
  }

  ngOnDestroy(): void {
    this.priceSub?.unsubscribe();
    if (this.chart) {
      this.chart.remove();
    }
  }

  private initChart(): void {
    const container = this.chartContainer.nativeElement;
    const css = getComputedStyle(document.documentElement);
    const token = (name: string) => css.getPropertyValue(name).trim();
    this.colors = {
      up: token('--color-up'),
      down: token('--color-down'),
      line: token('--color-line'),
      text: token('--color-ink-muted'),
      crosshair: withAlpha(token('--color-ink-muted'), 0.5),
    };

    // 1. Create the chart. autoSize: the library watches the container with its own
    //    ResizeObserver and redraws at the new width AND height (we used to do width only).
    this.chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: this.colors.text,
        fontFamily: token('--font-mono'),
        fontSize: 11,
      },
      grid: {
        vertLines: { color: withAlpha(this.colors.line, 0.6) },
        horzLines: { color: withAlpha(this.colors.line, 0.6) },
      },
      crosshair: {
        vertLine: { color: this.colors.crosshair, width: 1 },
        horzLine: { color: this.colors.crosshair, width: 1 },
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
        borderColor: this.colors.line,
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
        borderColor: this.colors.line,
      },
    });

    // 2. Add Area Series; colour (green/red) is set by applySeriesColor()
    this.lineSeries = this.chart.addSeries(AreaSeries, { lineWidth: 2 });
    this.applySeriesColor(this.latestChangeIsUp());

    // 3. Load historical data points
    this.draw();
  }

  private subscribeToTicks(): void {
    this.priceSub = this.priceService.prices$.subscribe((prices) => {
      if (!this.lineSeries) return;

      const current = prices.find((p) => p.symbol === this.symbol);
      if (current) {
        this.draw();
        this.applySeriesColor(current.change >= 0);
      }
    });
  }

  /**
   * Draws the service's history; the chart never makes up timestamps (fixes Backlog #3).
   * New array (symbol switch or fresh snapshot after a reconnect) → full setData().
   * Same array → update() only the points at or after the last one drawn: update() with
   * an equal time replaces the last point, a newer time appends.
   */
  private draw(): void {
    if (!this.lineSeries) return;
    const history = this.priceService.getPriceHistory(this.symbol);
    if (history !== this.drawnHistory) {
      this.lineSeries.setData(history.map(toChartPoint));
      this.chart?.timeScale().fitContent();
      this.drawnHistory = history;
    } else {
      let i = history.length;
      while (i > 0 && history[i - 1].time >= this.lastDrawnTime) i--;
      for (; i < history.length; i++) this.lineSeries.update(toChartPoint(history[i]));
    }
    this.lastDrawnTime = history.at(-1)?.time ?? 0;
  }

  /** Green area when the symbol is up on the session, red when down */
  private applySeriesColor(isUp: boolean): void {
    if (!this.lineSeries || this.seriesIsUp === isUp) return;
    this.seriesIsUp = isUp;
    const color = isUp ? this.colors.up : this.colors.down;
    this.lineSeries.applyOptions({
      lineColor: color,
      topColor: withAlpha(color, 0.28),
      bottomColor: withAlpha(color, 0),
    });
  }

  private latestChangeIsUp(): boolean {
    const latest = this.priceService.pricesSignal().find((p) => p.symbol === this.symbol);
    return (latest?.change ?? 0) >= 0;
  }
}
