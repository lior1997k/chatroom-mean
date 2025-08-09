import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthGuard } from './auth-guard';
import { AuthService } from '../services/auth';

class MockAuthService {
  token: string | null = 'token';
  getToken() { return this.token; }
}
class MockRouter {
  parseUrl(url: string) { return url as any; }
}

describe('AuthGuard (class)', () => {
  let guard: AuthGuard;
  let auth: MockAuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AuthGuard,
        { provide: AuthService, useClass: MockAuthService },
        { provide: Router, useClass: MockRouter },
      ],
    });
    guard = TestBed.inject(AuthGuard);
    auth = TestBed.inject(AuthService) as any;
  });

  it('allows when token exists', () => {
    auth.token = 'abc';
    expect(guard.canActivate()).toBe(true);
  });

  it('redirects when no token', () => {
    auth.token = null;
    expect(guard.canActivate() as any).toBe('/login');
  });
});
