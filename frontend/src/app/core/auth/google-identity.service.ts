import { DOCUMENT, Injectable, inject } from '@angular/core';

// Minimal typings for the parts of Google Identity Services (GIS) we use.
// Written by hand instead of adding @types/google.accounts as a dependency.
interface GoogleCredentialResponse {
  credential: string; // the ID token (a JWT signed by Google)
}

interface GoogleButtonOptions {
  type: 'standard' | 'icon';
  theme: 'outline' | 'filled_blue' | 'filled_black';
  size: 'large' | 'medium' | 'small';
  text: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape: 'rectangular' | 'pill';
  width: number;
}

interface GoogleAccountsId {
  initialize(config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    ux_mode: 'popup' | 'redirect';
  }): void;
  renderButton(parent: HTMLElement, options: GoogleButtonOptions): void;
  disableAutoSelect(): void;
}

type GoogleWindow = Window & { google?: { accounts: { id: GoogleAccountsId } } };

const GSI_SCRIPT = 'https://accounts.google.com/gsi/client';

/**
 * Wraps Google's "Sign in with Google" script. The script is loaded only when the login page
 * needs it (not in the main bundle, not on other pages), and only once.
 */
@Injectable({ providedIn: 'root' })
export class GoogleIdentityService {
  private readonly document = inject(DOCUMENT);
  private loading?: Promise<GoogleAccountsId>;

  private load(): Promise<GoogleAccountsId> {
    this.loading ??= new Promise<GoogleAccountsId>((resolve, reject) => {
      const script = this.document.createElement('script');
      script.src = GSI_SCRIPT;
      script.async = true;
      script.onload = () => {
        const gsi = (this.document.defaultView as GoogleWindow | null)?.google?.accounts.id;
        if (gsi) resolve(gsi);
        else reject(new Error('Google Identity Services did not initialise'));
      };
      script.onerror = () => {
        this.loading = undefined; // allow a retry next time
        script.remove();
        reject(new Error('Could not load Google Identity Services'));
      };
      this.document.head.appendChild(script);
    });
    return this.loading;
  }

  /** Draws Google's button into `container`; `onCredential` gets the ID token after the popup. */
  async renderButton(
    container: HTMLElement,
    clientId: string,
    onCredential: (credential: string) => void,
  ): Promise<void> {
    const gsi = await this.load();
    gsi.initialize({
      client_id: clientId,
      callback: (response) => onCredential(response.credential),
      ux_mode: 'popup', // stay on our page; no full-page redirect to Google and back
    });
    gsi.renderButton(container, {
      type: 'standard',
      theme: 'filled_black',
      size: 'large',
      text: 'continue_with',
      shape: 'rectangular',
      width: Math.min(400, Math.max(200, container.clientWidth)), // Google allows 200–400 px
    });
  }

  /** After logout: don't let Google silently pick the same account next time. */
  disableAutoSelect(): void {
    (this.document.defaultView as GoogleWindow | null)?.google?.accounts.id.disableAutoSelect();
  }
}
