import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { AlertService } from '../../../core/services/alert.service';

type Direction = 'above' | 'below';

/**
 * Blocks a target equal to the current price.
 * Takes a *getter* instead of a number, so the validator always reads the latest price when it runs.
 * That removes the old need to call setValidators() from the template on every tick (Backlog #4).
 */
function notCurrentPrice(currentPrice: () => number): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    if (control.value === null || control.value === '') return null; // 'required' handles blanks
    const current = currentPrice();
    return Number(control.value) === current ? { samePriceAsCurrent: { current } } : null;
  };
}

/** Right-hand pane: active alerts for the selected symbol + the form to add one. */
@Component({
  selector: 'app-alert-panel',
  standalone: true,
  imports: [ReactiveFormsModule, DecimalPipe],
  template: `
    <div class="h-10 shrink-0 px-3 flex items-center justify-between border-b border-line">
      <span class="text-xs font-semibold">Alerts · {{ symbol() }}</span>
      <span class="text-xs text-ink-faint tabular-nums">{{ alerts().length }} active</span>
    </div>

    <div class="p-3 space-y-1.5">
      @for (alert of alerts(); track alert.id) {
        <div class="flex items-center h-8 px-2.5 rounded bg-surface-2 text-xs">
          <span [class]="alert.direction === 'above' ? 'text-up' : 'text-down'">
            {{ alert.direction === 'above' ? '▲ Above' : '▼ Below' }}
          </span>
          <span class="ml-auto mr-3 font-mono tabular-nums">
            {{ currency() }}{{ alert.targetPrice | number: '1.2-4' }}
          </span>
          <button
            type="button"
            (click)="alertService.removeAlert(alert.id)"
            [attr.aria-label]="'Remove alert at ' + alert.targetPrice"
            class="text-ink-faint hover:text-down transition-colors">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      } @empty {
        <p class="text-xs text-ink-faint">No active alerts for {{ symbol() }}.</p>
      }
    </div>

    @let tp = form.controls.targetPrice;
    <form [formGroup]="form" (ngSubmit)="submit()" class="p-3 border-t border-line space-y-3">
      <p class="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">New alert</p>

      <div class="grid grid-cols-2 gap-0.5 rounded bg-surface-0 p-0.5 text-xs font-semibold">
        <label class="cursor-pointer">
          <input type="radio" formControlName="direction" value="above" class="peer sr-only" />
          <span
            class="block text-center py-1.5 rounded text-ink-muted transition-colors peer-checked:bg-up/15 peer-checked:text-up peer-focus-visible:ring-1 peer-focus-visible:ring-accent">
            ▲ Above
          </span>
        </label>
        <label class="cursor-pointer">
          <input type="radio" formControlName="direction" value="below" class="peer sr-only" />
          <span
            class="block text-center py-1.5 rounded text-ink-muted transition-colors peer-checked:bg-down/15 peer-checked:text-down peer-focus-visible:ring-1 peer-focus-visible:ring-accent">
            ▼ Below
          </span>
        </label>
      </div>

      <div class="relative">
        <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-faint">{{ currency() }}</span>
        <input
          formControlName="targetPrice"
          type="number"
          step="any"
          aria-label="Target price"
          [placeholder]="price() | number: '1.2-4'"
          class="w-full h-9 pl-6 pr-2 rounded bg-surface-0 border text-sm font-mono tabular-nums outline-none transition-colors placeholder:text-ink-faint focus:border-accent"
          [class]="tp.touched && tp.invalid ? 'border-down' : 'border-line'" />
      </div>

      @if (tp.touched && tp.invalid) {
        <p class="text-[11px] text-down">
          @if (tp.hasError('required')) {
            Enter a target price.
          } @else if (tp.hasError('min')) {
            Price must be greater than zero.
          } @else if (tp.hasError('samePriceAsCurrent')) {
            Target equals the current price, so it would fire instantly.
          }
        </p>
      }

      <button
        type="submit"
        [disabled]="form.invalid"
        class="w-full h-9 rounded bg-accent text-white text-xs font-semibold transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed">
        Set alert
      </button>
    </form>
  `,
  host: { class: 'flex flex-col' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertPanel {
  readonly symbol = input.required<string>();
  readonly price = input.required<number>();
  readonly currency = input.required<string>();

  protected readonly alertService = inject(AlertService);

  readonly alerts = computed(() =>
    this.alertService.activeAlerts().filter((a) => a.symbol === this.symbol())
  );

  /** Typed form (Backlog #6): form.value.direction is Direction, not any */
  readonly form = new FormGroup({
    direction: new FormControl<Direction>('above', { nonNullable: true }),
    targetPrice: new FormControl<number | null>(null, [
      Validators.required,
      Validators.min(0.000001),
      notCurrentPrice(() => this.price()),
    ]),
  });

  constructor() {
    // A different symbol was selected → clear the old target (keep the chosen direction).
    // untracked(): the reset itself must not become a dependency of this effect.
    effect(() => {
      this.symbol();
      untracked(() => this.form.controls.targetPrice.reset(null));
    });
  }

  submit(): void {
    const targetCtrl = this.form.controls.targetPrice;
    targetCtrl.updateValueAndValidity(); // re-check against the price at this moment
    const target = targetCtrl.value;
    if (this.form.invalid || target === null) {
      this.form.markAllAsTouched();
      return;
    }
    this.alertService.addAlert(this.symbol(), target, this.form.controls.direction.value);
    targetCtrl.reset(null);
  }
}
