import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './forgot-password.html',
  styleUrls: ['./forgot-password.css']
})
export class ForgotPasswordComponent {
  email = '';
  message = '';
  error = '';
  submitting = false;

  constructor(private auth: AuthService) {}

  submit() {
    if (this.submitting) return;
    const email = String(this.email || '').trim().toLowerCase();
    this.error = '';
    this.message = '';

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.error = 'Email address is invalid.';
      return;
    }

    this.submitting = true;
    this.auth.forgotPassword(email).subscribe({
      next: (res: any) => {
        this.message = String(res?.message || 'If this email exists, a reset link was sent.');
      },
      error: (err) => {
        this.error = err?.error?.error?.message || 'Could not request password reset.';
      },
      complete: () => {
        this.submitting = false;
      }
    });
  }
}
