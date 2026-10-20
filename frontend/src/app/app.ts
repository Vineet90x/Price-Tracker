import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, ChangeDetectionStrategy, afterRenderEffect, computed, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AlertService } from './core/services/alert.service';
import { PriceService } from './core/services/price.service';
import { AuthService } from './core/auth/auth.service';
import { FeedStatus } from './core/services/price-feed';
import { LatencyService } from './core/services/latency.service';
import { LatencyBadge } from './shared/latency-badge/latency-badge';

const FEED_LABELS: Record<FeedStatus, string> = {
  live: 'Live',
  simulated: 'Simulated feed',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, DatePipe, DecimalPipe, LatencyBadge],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  readonly title = 'Live Price Tracker';
  readonly alertService = inject(AlertService);
  readonly auth = inject(AuthService);

  private readonly priceService = inject(PriceService);
  readonly feedStatus = this.priceService.feedStatus;
  readonly feedLabel = computed(() => FEED_LABELS[this.feedStatus()]);
  /** Green = live, blue = simulated, amber = not connected (yet) */
  readonly feedDotClass = computed(() => {
    switch (this.feedStatus()) {
      case 'live':
        return 'bg-up';
      case 'simulated':
        return 'bg-accent';
      default:
        return 'bg-warn';
    }
  });

  constructor() {
    // Latency tracing, last step: after Angular has put new prices into the DOM, wait until the browser
    // has actually painted them (the next animation frame, then one more task), and record the time.
    const latency = inject(LatencyService);
    afterRenderEffect(() => {
      this.priceService.pricesSignal(); // re-run after every render that showed new prices
      requestAnimationFrame(() => setTimeout(() => latency.markPainted()));
    });
  }
}
