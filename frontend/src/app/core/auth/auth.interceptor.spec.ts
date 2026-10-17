import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';

const tokenResponse = (token: string) => ({
  access_token: token,
  token_type: 'bearer',
  expires_in: 900,
  user: { id: 1, email: 'a@b.co' },
});

describe('authInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let auth: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'login', children: [] }]), // handleSessionExpired() navigates here
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);

    // Log in with access token "t1"
    auth.login('a@b.co', 'password1').subscribe();
    backend.expectOne('/api/auth/login').flush(tokenResponse('t1'));
  });

  afterEach(() => backend.verify());

  it('attaches the access token to API calls', () => {
    http.get('/api/portfolio').subscribe();
    const req = backend.expectOne('/api/portfolio');
    expect(req.request.headers.get('Authorization')).toBe('Bearer t1');
    req.flush({});
  });

  it('does not attach it to non-API URLs', () => {
    http.get('/assets/x.json').subscribe();
    const req = backend.expectOne('/assets/x.json');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('on 401: refreshes once, then retries the request with the new token', () => {
    let body: unknown;
    http.get('/api/portfolio').subscribe((b) => (body = b));

    backend.expectOne('/api/portfolio').flush(null, { status: 401, statusText: 'Unauthorized' });
    backend.expectOne('/api/auth/refresh').flush(tokenResponse('t2'));
    const retry = backend.expectOne('/api/portfolio');
    expect(retry.request.headers.get('Authorization')).toBe('Bearer t2');
    retry.flush({ ok: true });

    expect(body).toEqual({ ok: true });
  });

  it('two requests failing at once share ONE refresh call', () => {
    http.get('/api/portfolio').subscribe();
    http.get('/api/auth/me').subscribe();

    backend.expectOne('/api/portfolio').flush(null, { status: 401, statusText: 'Unauthorized' });
    backend.expectOne('/api/auth/me').flush(null, { status: 401, statusText: 'Unauthorized' });
    backend.expectOne('/api/auth/refresh').flush(tokenResponse('t2')); // fails if there were two

    backend.expectOne('/api/portfolio').flush({});
    backend.expectOne('/api/auth/me').flush({});
  });

  it('if the refresh fails: logs out and passes the error on', () => {
    let failed = false;
    http.get('/api/portfolio').subscribe({ error: () => (failed = true) });

    backend.expectOne('/api/portfolio').flush(null, { status: 401, statusText: 'Unauthorized' });
    backend.expectOne('/api/auth/refresh').flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(failed).toBe(true);
    expect(auth.isLoggedIn()).toBe(false);
  });

  it('a non-401 error is passed through without refreshing', () => {
    let status = 0;
    http.get('/api/portfolio').subscribe({ error: (e) => (status = e.status) });
    backend.expectOne('/api/portfolio').flush(null, { status: 500, statusText: 'Server Error' });
    expect(status).toBe(500);
  });
});
