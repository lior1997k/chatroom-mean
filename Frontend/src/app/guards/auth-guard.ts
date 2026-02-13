import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { AuthService } from '../services/auth';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {
  constructor(private auth: AuthService, private router: Router) {}

  canActivate(): boolean {
    if (this.auth.hasValidSession()) {
      return true;
    } else {
      this.auth.logout();
      this.router.navigate(['/login']);
      return false;
    }
  }
}
