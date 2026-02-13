import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth';
import { SocketService } from '../../services/socket';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule,RouterModule],
  templateUrl: './login.html',
  styleUrls: ['./login.css']
})
export class LoginComponent {
  username = '';
  password = '';
  errorMessage = '';
  infoMessage = '';

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
      this.infoMessage = reason === 'session-expired'
        ? 'Your session expired. Please sign in again.'
        : '';
    });
  }

  login() {
    if (!this.username || !this.password) {
      this.errorMessage = 'Please enter username and password';
      return;
    }

    this.auth.login(this.username, this.password).subscribe({
      next: (res: any) => {
        this.auth.saveToken(res.token);
        this.socket.connect();
        this.router.navigate(['/chat']);
      },
      error: (err) => {
        this.errorMessage = err.error?.error?.message || err.error?.error || 'Login failed';
      }
    });
  }

  goToRegister() {
    this.router.navigate(['/register']);
  }
}
