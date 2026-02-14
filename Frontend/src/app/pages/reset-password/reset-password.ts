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

  constructor(
    private auth: AuthService,
    private route: ActivatedRoute,
    private router: Router
  ) {
    this.route.queryParamMap.subscribe((params) => {
      this.email = String(params.get('email') || '').trim().toLowerCase();
      this.token = String(params.get('token') || '').trim();
    });
  }

  submit() {
    if (this.submitting) return;
    this.error = '';
    this.success = '';

    if (!this.email || !this.token || !this.password || !this.confirmPassword) {
      this.error = 'All fields are required.';
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
}
