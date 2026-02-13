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
  password = '';
  confirmPassword = '';
  error = '';
  success = '';
  infoMessage = '';

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
    this.error = '';
    this.success = '';

    if (!this.username.trim() || !this.password || !this.confirmPassword) {
      this.error = 'All fields are required.';
      return;
    }

    if (this.password !== this.confirmPassword) {
      this.error = 'Passwords do not match.';
      return;
    }

    this.auth.register(this.username.trim(), this.password).subscribe({
      next: () => {
        this.success = 'Registration successful! Redirecting to login...';
        setTimeout(() => this.router.navigate(['/login']), 1500);
      },
      error: (err) => {
        this.error = err?.error?.error?.message || err?.error?.message || 'Registration failed.';
      }
    });
  }
}
