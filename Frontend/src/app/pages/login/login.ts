import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth';
import { SocketService } from '../../services/socket';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule,RouterModule],
  templateUrl: './login.html',
  styleUrls: ['./login.css']
})
export class LoginComponent {
  identifier = '';
  password = '';
  errorMessage = '';
  infoMessage = '';
  submitting = false;
  showPassword = false;
  socialBusy: 'google' | 'apple' | null = null;
  socialPendingProvider: 'google' | 'apple' | null = null;
  socialSuggestedUsername = '';
  socialTokenForSetup = '';
  socialSetupNotice = '';
  socialSetupUsername = '';
  readonly googleSignInEnabled = !!String(environment.googleClientId || '').trim();
  readonly appleSignInEnabled = !!String(environment.appleClientId || '').trim() && !!String(environment.appleRedirectUri || '').trim();
  pendingVerificationEmail = '';
  resendVerificationBusy = false;
  resendVerificationMessage = '';

  constructor(
    private auth: AuthService,
    private socket: SocketService,
    private router: Router,
    private route: ActivatedRoute
  ) {
    if (this.auth.hasValidSession()) {
      this.router.navigate(['/chat']);
    }

    this.route.queryParamMap.subscribe((params) => {
      const reason = params.get('reason');
      if (reason === 'session-expired') {
        this.infoMessage = 'Your session expired. Please sign in again.';
        return;
      }
      if (reason === 'email-verified') {
        this.infoMessage = 'Email verified. You can sign in now.';
        return;
      }
      if (reason === 'email-verify-failed') {
        this.infoMessage = 'Email verification link is invalid or expired.';
        return;
      }
      this.infoMessage = '';
    });
  }

  login() {
    if (this.submitting) return;
    const identifier = this.normalizeIdentifier(this.identifier);
    const password = String(this.password || '');

    if (!identifier || !password) {
      this.errorMessage = 'Please enter username/email and password';
      return;
    }

    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);

    this.errorMessage = '';
    this.infoMessage = '';
    this.resendVerificationMessage = '';
    this.pendingVerificationEmail = isEmail ? identifier : '';
    this.submitting = true;

    this.auth.login(identifier, password).subscribe({
      next: (res: any) => {
        this.socket.connect();
        this.router.navigate(['/chat']);
      },
      error: (err) => {
        const apiError = err?.error?.error;
        const code = String(apiError?.code || '');
        if (code === 'EMAIL_NOT_VERIFIED') {
          this.pendingVerificationEmail = isEmail ? identifier : '';
        }
        this.errorMessage = apiError?.message
          || (code === 'ACCOUNT_LOCKED' ? 'Too many failed attempts. Please wait and try again.' : '')
          || 'Login failed';
        this.submitting = false;
      },
      complete: () => {
        this.submitting = false;
      }
    });
  }

  async signInWithGoogle() {
    if (!this.googleSignInEnabled) return;
    if (this.socialBusy) return;
    this.clearSocialSetupState();
    this.socialBusy = 'google';

    try {
      const google = await this.waitForGoogleIdentity();
      const idToken = await this.promptGoogleIdToken(google);
      this.submitSocialGoogle(idToken);
    } catch (err: any) {
      this.errorMessage = err?.message || 'Google sign-in failed.';
      this.socialBusy = null;
    }
  }

  async signInWithApple() {
    if (!this.appleSignInEnabled) return;
    if (this.socialBusy) return;
    this.clearSocialSetupState();
    this.socialBusy = 'apple';

    try {
      const idToken = await this.promptAppleIdToken();
      this.submitSocialApple(idToken);
    } catch (err: any) {
      this.errorMessage = err?.message || 'Apple sign-in failed.';
      this.socialBusy = null;
    }
  }

  completeSocialSetup() {
    const username = this.normalizeUsername(this.socialSetupUsername);
    if (!this.socialPendingProvider || !this.socialTokenForSetup) return;
    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      this.errorMessage = 'Username must be 3-24 chars using lowercase letters, numbers, or underscores.';
      return;
    }

    this.errorMessage = '';
    this.socialBusy = this.socialPendingProvider;
    if (this.socialPendingProvider === 'google') {
      this.submitSocialGoogle(this.socialTokenForSetup, username);
      return;
    }
    this.submitSocialApple(this.socialTokenForSetup, username);
  }

  cancelSocialSetup() {
    this.clearSocialSetupState();
  }

  resendVerificationEmail() {
    const email = String(this.pendingVerificationEmail || '').trim().toLowerCase();
    if (!email || this.resendVerificationBusy) return;
    this.resendVerificationBusy = true;
    this.resendVerificationMessage = '';

    this.auth.resendEmailVerification(email).subscribe({
      next: (res: any) => {
        this.resendVerificationMessage = String(res?.message || 'Verification email sent.');
      },
      error: (err) => {
        this.resendVerificationMessage = err?.error?.error?.message || 'Could not resend verification email.';
      },
      complete: () => {
        this.resendVerificationBusy = false;
      }
    });
  }

  toggleShowPassword() {
    this.showPassword = !this.showPassword;
  }

  private normalizeIdentifier(value: string): string {
    return String(value || '').trim().toLowerCase();
  }

  private normalizeUsername(value: string): string {
    return String(value || '').trim().toLowerCase();
  }

  private clearSocialSetupState() {
    this.socialPendingProvider = null;
    this.socialSuggestedUsername = '';
    this.socialTokenForSetup = '';
    this.socialSetupNotice = '';
    this.socialSetupUsername = '';
  }

  private handleAuthSuccess(res: any) {
    this.socket.connect();
    this.router.navigate(['/chat']);
  }

  private submitSocialGoogle(idToken: string, username?: string) {
    this.auth.socialGoogle(idToken, username).subscribe({
      next: (res: any) => {
        this.socialBusy = null;
        this.handleAuthSuccess(res);
      },
      error: (err) => {
        this.socialBusy = null;
        this.handleSocialError(err, 'google', idToken);
      }
    });
  }

  private submitSocialApple(idToken: string, username?: string) {
    this.auth.socialApple(idToken, username).subscribe({
      next: (res: any) => {
        this.socialBusy = null;
        this.handleAuthSuccess(res);
      },
      error: (err) => {
        this.socialBusy = null;
        this.handleSocialError(err, 'apple', idToken);
      }
    });
  }

  private handleSocialError(err: any, provider: 'google' | 'apple', idToken: string) {
    const apiError = err?.error?.error;
    const code = String(apiError?.code || '');

    if (code === 'PROFILE_SETUP_REQUIRED') {
      this.socialPendingProvider = provider;
      this.socialTokenForSetup = idToken;
      this.socialSuggestedUsername = String(err?.error?.profile?.suggestedUsername || '');
      this.socialSetupUsername = this.socialSuggestedUsername;
      this.socialSetupNotice = apiError?.message || 'Choose a username to finish social sign in.';
      this.errorMessage = '';
      return;
    }

    this.errorMessage = apiError?.message || 'Social sign-in failed.';
  }

  private waitForGoogleIdentity(): Promise<any> {
    const timeoutMs = 6000;
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const tick = () => {
        const win = window as any;
        const google = win?.google?.accounts?.id;
        if (google && this.googleSignInEnabled) {
          resolve(google);
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          reject(new Error('Google sign-in is not configured in this environment.'));
          return;
        }
        setTimeout(tick, 120);
      };
      tick();
    });
  }

  private promptGoogleIdToken(googleId: any): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      try {
        googleId.initialize({
          client_id: String(environment.googleClientId || '').trim(),
          callback: (response: any) => {
            const credential = String(response?.credential || '');
            if (!credential) {
              finish(() => reject(new Error('Google did not return a credential.')));
              return;
            }
            finish(() => resolve(credential));
          }
        });
        googleId.prompt();
        setTimeout(() => {
          finish(() => reject(new Error('Google sign-in was cancelled.')));
        }, 10000);
      } catch {
        finish(() => reject(new Error('Google sign-in failed to initialize.')));
      }
    });
  }

  private async promptAppleIdToken(): Promise<string> {
    const win = window as any;
    if (!this.appleSignInEnabled) {
      throw new Error('Apple sign-in is not configured in this environment.');
    }
    if (!win?.AppleID?.auth) {
      throw new Error('Apple sign-in SDK is not loaded.');
    }

    win.AppleID.auth.init({
      clientId: String(environment.appleClientId || '').trim(),
      scope: 'name email',
      redirectURI: String(environment.appleRedirectUri || '').trim(),
      usePopup: true
    });

    const response = await win.AppleID.auth.signIn();
    const idToken = String(response?.authorization?.id_token || '');
    if (!idToken) throw new Error('Apple did not return an id token.');
    return idToken;
  }

  goToRegister() {
    this.router.navigate(['/register']);
  }
}
