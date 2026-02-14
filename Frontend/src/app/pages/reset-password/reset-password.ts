import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './reset-password.html',
  styleUrls: ['./reset-password.css']
})
export class ResetPasswordComponent {
  email = '';
  token = '';
  password = '';
  confirmPassword = '';
  error = '';
  success = '';
  submitting = false;
  showPassword = false;
  showConfirmPassword = false;
  tokenFromLink = false;

  constructor(
    private auth: AuthService,
    private route: ActivatedRoute,
    private router: Router
  ) {
    this.route.queryParamMap.subscribe((params) => {
      this.email = String(params.get('email') || '').trim().toLowerCase();
      this.token = String(params.get('token') || '').trim();
      this.tokenFromLink = !!this.token;
    });
  }

  submit() {
    if (this.submitting) return;
    this.error = '';
    this.success = '';

    this.email = String(this.email || '').trim().toLowerCase();
    this.token = String(this.token || '').trim();

    if (!this.email || !this.token || !this.password || !this.confirmPassword) {
      this.error = 'All fields are required.';
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email)) {
      this.error = 'Please enter a valid email address.';
      return;
    }
    if (this.password !== this.confirmPassword) {
      this.error = 'Passwords do not match.';
      return;
    }

    this.submitting = true;
    this.auth.resetPassword(this.email, this.token, this.password).subscribe({
      next: (res: any) => {
        this.success = String(res?.message || 'Password reset successful.');
        setTimeout(() => this.router.navigate(['/login']), 1400);
      },
      error: (err) => {
        this.error = err?.error?.error?.message || 'Could not reset password.';
      },
      complete: () => {
        this.submitting = false;
      }
    });
  }

  toggleShowPassword() {
    this.showPassword = !this.showPassword;
  }

  toggleShowConfirmPassword() {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  passwordPolicyHint(): string {
    if (!this.password) {
      return 'Use at least 8 characters with uppercase, lowercase, number, and symbol.';
    }
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
}
