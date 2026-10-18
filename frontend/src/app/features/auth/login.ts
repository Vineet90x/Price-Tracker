import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse, httpResource } from '@angular/common/http';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { AuthService, AuthUser } from '../../core/auth/auth.service';
import { GoogleIdentityService } from '../../core/auth/google-identity.service';

type Mode = 'login' | 'register';

function describeGoogleError(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 409) {
    return 'That email is already linked to a different Google account.';
  }
  if (error instanceof HttpErrorResponse && error.status === 401) {
    return 'Google sign-in was rejected. Try again, or use email and password.';
  }
  return describeError(error);
}

function describeError(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) return 'Something went wrong.';
  switch (error.status) {
    case 401:
      return 'Wrong email or password.';
    case 409:
      return 'That email is already registered. Log in instead.';
    case 422:
      return 'Check the email address and use at least 8 characters for the password.';
    default:
      return error.status === 0 || error.status >= 500
        ? "Can't reach the server. Is the backend running?"
        : 'Something went wrong.';
  }
}

/** Login + register on one page; a signal toggles the mode. */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="min-h-full grid place-items-center p-4">
      <div class="w-full max-w-sm rounded border border-line bg-surface-1 p-6">
        <h1 class="text-base font-semibold">{{ mode() === 'login' ? 'Log in' : 'Create account' }}</h1>
        <p class="mt-1 text-xs text-ink-muted">
          {{ mode() === 'login' ? 'Your portfolio needs a login.' : 'Passwords need at least 8 characters.' }}
        </p>

        <!-- Google button: shown only when the backend has a client ID configured -->
        @if (googleClientId()) {
          <!-- color-scheme: light → browser doesn't paint a white backdrop behind Google's (light) iframe -->
          <div #googleButton class="mt-5 flex justify-center min-h-10 [color-scheme:light]"></div>
          <div class="mt-5 flex items-center gap-3 text-[11px] uppercase tracking-wider text-ink-faint">
            <span class="h-px flex-1 bg-line"></span>
            or with email
            <span class="h-px flex-1 bg-line"></span>
          </div>
        }

        @let email = form.controls.email;
        @let password = form.controls.password;
        <form [formGroup]="form" (ngSubmit)="submit()" class="mt-5 space-y-4" novalidate>
          <label class="block">
            <span class="text-xs font-medium text-ink-muted">Email</span>
            <input
              formControlName="email"
              type="email"
              autocomplete="email"
              class="mt-1 w-full h-9 px-2.5 rounded bg-surface-0 border text-sm outline-none transition-colors focus:border-accent"
              [class]="email.touched && email.invalid ? 'border-down' : 'border-line'" />
            @if (email.touched && email.invalid) {
              <span class="mt-1 block text-[11px] text-down">Enter a valid email address.</span>
            }
          </label>

          <label class="block">
            <span class="text-xs font-medium text-ink-muted">Password</span>
            <input
              formControlName="password"
              type="password"
              [attr.autocomplete]="mode() === 'login' ? 'current-password' : 'new-password'"
              class="mt-1 w-full h-9 px-2.5 rounded bg-surface-0 border text-sm outline-none transition-colors focus:border-accent"
              [class]="password.touched && password.invalid ? 'border-down' : 'border-line'" />
            @if (password.touched && password.invalid) {
              <span class="mt-1 block text-[11px] text-down">At least 8 characters.</span>
            }
          </label>

          @if (error()) {
            <p role="alert" class="rounded bg-down/10 px-3 py-2 text-xs text-down">{{ error() }}</p>
          }

          <button
            type="submit"
            [disabled]="pending()"
            class="w-full h-9 rounded bg-accent text-white text-sm font-semibold transition hover:brightness-110 disabled:opacity-50">
            @if (pending()) {
              Please wait…
            } @else {
              {{ mode() === 'login' ? 'Log in' : 'Create account' }}
            }
          </button>
        </form>

        <p class="mt-4 text-center text-xs text-ink-muted">
          {{ mode() === 'login' ? 'No account?' : 'Already registered?' }}
          <button type="button" (click)="toggleMode()" class="text-accent hover:underline">
            {{ mode() === 'login' ? 'Create one' : 'Log in' }}
          </button>
        </p>
      </div>
    </div>
  `,
  host: { class: 'block h-full' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly google = inject(GoogleIdentityService);

  /** GET /api/auth/config: which Google client ID to use (null = Google login switched off) */
  private readonly authConfig = httpResource<{ google_client_id: string | null }>(() => '/api/auth/config');
  readonly googleClientId = computed(() =>
    this.authConfig.hasValue() ? this.authConfig.value().google_client_id : null,
  );
  private readonly googleButton = viewChild<ElementRef<HTMLDivElement>>('googleButton');
  private googleButtonHost?: HTMLDivElement;

  readonly mode = signal<Mode>('login');
  readonly pending = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(8)],
    }),
  });

  constructor() {
    // afterRenderEffect: runs after the DOM is updated, so the container exists and has a width.
    // Re-runs when the config arrives (the @if renders the container) and draws Google's button once.
    afterRenderEffect(() => {
      const clientId = this.googleClientId();
      const host = this.googleButton()?.nativeElement;
      if (!clientId || !host || host === this.googleButtonHost) return;
      this.googleButtonHost = host;
      this.google
        .renderButton(host, clientId, (credential) =>
          this.finish(this.auth.loginWithGoogle(credential), describeGoogleError),
        )
        .catch(() => this.error.set("Google sign-in couldn't load. Use email and password instead."));
    });
  }

  toggleMode(): void {
    this.mode.update((m) => (m === 'login' ? 'register' : 'login'));
    this.error.set(null);
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { email, password } = this.form.getRawValue();
    this.finish(
      this.mode() === 'login' ? this.auth.login(email, password) : this.auth.register(email, password),
      describeError,
    );
  }

  /** Shared by email and Google login: show progress, then go back where the user came from. */
  private finish(request$: Observable<AuthUser>, describe: (err: unknown) => string): void {
    this.pending.set(true);
    this.error.set(null);
    request$.subscribe({
      next: () => {
        // Only same-app paths: "//evil.com" or "https://…" would be an open redirect.
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        const safe = returnUrl?.startsWith('/') && !returnUrl.startsWith('//') ? returnUrl : '/watchlist';
        this.router.navigateByUrl(safe);
      },
      error: (err: unknown) => {
        this.pending.set(false);
        this.error.set(describe(err));
      },
    });
  }
}
