import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './register.html',
  styleUrls: ['./register.css']
})
export class RegisterComponent {
  username = '';
  email = '';
  password = '';
  confirmPassword = '';
  error = '';
  success = '';
  infoMessage = '';
  submitting = false;
  showPassword = false;
  showConfirmPassword = false;
  private autoUsernameSuggestion = '';

  constructor(private auth: AuthService, private router: Router, private route: ActivatedRoute) {
    if (this.auth.hasValidSession()) {
      this.router.navigate(['/chat']);
    }

    this.route.queryParamMap.subscribe((params) => {
      const reason = params.get('reason');
      this.infoMessage = reason === 'session-expired'
        ? 'Your session expired. Create an account or sign in again.'
        : '';
    });
  }

  register() {
    if (this.submitting) return;
    this.error = '';
    this.success = '';

    const username = this.normalizeUsername(this.username);
    const password = String(this.password || '');
    const confirmPassword = String(this.confirmPassword || '');

    const email = this.normalizeEmail(this.email);

    if (!username || !email || !password || !confirmPassword) {
      this.error = 'All fields are required.';
      return;
    }

    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      this.error = 'Username must be 3-24 chars using lowercase letters, numbers, or underscores.';
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.error = 'Email address is invalid.';
      return;
    }

    const passwordIssues = this.passwordPolicyIssues(password);
    if (passwordIssues.length) {
      this.error = `Password must include ${passwordIssues.join(', ')}.`;
      return;
    }

    if (password !== confirmPassword) {
      this.error = 'Passwords do not match.';
      return;
    }

    this.submitting = true;

    this.auth.register(username, email, password).subscribe({
      next: (res: any) => {
        const delivery = String(res?.emailDelivery || '');
        this.success = delivery === 'sent'
          ? 'Registration successful. Check your email to verify your account.'
          : 'Registration successful. Email delivery is not configured, contact admin to verify your account.';
        setTimeout(() => this.router.navigate(['/login']), 1700);
      },
      error: (err) => {
        this.error = err?.error?.error?.message || err?.error?.message || 'Registration failed.';
        this.submitting = false;
      },
      complete: () => {
        this.submitting = false;
      }
    });
  }

  passwordPolicyHint(): string {
    const issues = this.passwordPolicyIssues(this.password);
    return issues.length ? `Needs ${issues.join(', ')}.` : 'Strong password format.';
  }

  passwordMatchHint(): string {
    const password = String(this.password || '');
    const confirm = String(this.confirmPassword || '');
    if (!password || !confirm) return '';
    return password === confirm ? 'Passwords match.' : 'Passwords do not match yet.';
  }

  passwordsMatch(): boolean {
    const password = String(this.password || '');
    const confirm = String(this.confirmPassword || '');
    return !!password && !!confirm && password === confirm;
  }

  toggleShowPassword() {
    this.showPassword = !this.showPassword;
  }

  toggleShowConfirmPassword() {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  onEmailInput() {
    const suggestion = this.suggestUsernameFromEmail(this.email);
    if (!suggestion) return;

    const current = this.normalizeUsername(this.username);
    if (!current || current === this.autoUsernameSuggestion) {
      this.username = suggestion;
      this.autoUsernameSuggestion = suggestion;
    }
  }

  onUsernameInput() {
    const current = this.normalizeUsername(this.username);
    if (!current) {
      this.autoUsernameSuggestion = '';
    }
  }

  private normalizeUsername(value: string): string {
    return String(value || '').trim().toLowerCase();
  }

  private normalizeEmail(value: string): string {
    return String(value || '').trim().toLowerCase();
  }

  private passwordPolicyIssues(passwordRaw: string): string[] {
    const password = String(passwordRaw || '');
    const issues: string[] = [];
    if (password.length < 8) issues.push('at least 8 characters');
    if (!/[A-Z]/.test(password)) issues.push('an uppercase letter');
    if (!/[a-z]/.test(password)) issues.push('a lowercase letter');
    if (!/[0-9]/.test(password)) issues.push('a number');
    if (!/[^A-Za-z0-9]/.test(password)) issues.push('a symbol');
    return issues;
  }

  private suggestUsernameFromEmail(emailRaw: string): string {
    const email = this.normalizeEmail(emailRaw);
    const prefix = email.split('@')[0] || '';
    const cleaned = prefix
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24);
    return cleaned || '';
  }
}
