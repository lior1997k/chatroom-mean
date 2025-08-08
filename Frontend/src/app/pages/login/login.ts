import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
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

  constructor(
    private auth: AuthService,
    private socket: SocketService,
    private router: Router
  ) {}

  login() {
    if (!this.username || !this.password) {
      this.errorMessage = 'Please enter username and password';
      return;
    }

    this.auth.login(this.username, this.password).subscribe({
      next: (res: any) => {
        // Save token
        this.auth.saveToken(res.token);

        // Connect socket AFTER login
        this.socket.connect();

        // Navigate to chat
        this.router.navigate(['/chat']);
      },
      error: (err) => {
        this.errorMessage = err.error?.error || 'Login failed';
      }
    });
  }

  goToRegister() {
    this.router.navigate(['/register']);
  }
}
