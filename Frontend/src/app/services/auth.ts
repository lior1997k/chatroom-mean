import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Observable } from 'rxjs';

interface JwtPayload {
  username?: string;
  exp?: number;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private apiUrl = `${environment.apiUrl}/api/user`;
  private tokenKey = 'token';

  constructor(private http: HttpClient) {}

  register(username: string, email: string, password: string) {
    return this.http.post(`${this.apiUrl}/register`, { username, email, password });
  }

  login(identifier: string, password: string) {
    return this.http.post(`${this.apiUrl}/login`, { identifier, password });
  }

  socialGoogle(idToken: string, username?: string) {
    return this.http.post(`${this.apiUrl}/social/google`, { idToken, username: username || undefined });
  }

  socialApple(idToken: string, username?: string) {
    return this.http.post(`${this.apiUrl}/social/apple`, { idToken, username: username || undefined });
  }

  resendEmailVerification(email: string) {
    return this.http.post(`${this.apiUrl}/verify-email/resend`, { email });
  }

  forgotPassword(email: string) {
    return this.http.post(`${this.apiUrl}/password/forgot`, { email });
  }

  resetPassword(email: string, token: string, password: string) {
    return this.http.post(`${this.apiUrl}/password/reset`, { email, token, password });
  }

  getUsername(): string | null {
    const payload = this.getTokenPayload();
    return payload?.username || null;
  }


  saveToken(token: string) {
    localStorage.setItem(this.tokenKey, token);
  }

  getToken(): string | null {
    return localStorage.getItem(this.tokenKey);
  }

  getPrivateChatWith(username: string): Observable<any[]> {
    const token = this.getToken();
    return this.http.get<any[]>(`${environment.apiUrl}/api/private/${username}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  hasValidSession(): boolean {
    const token = this.getToken();
    if (!token) return false;

    const payload = this.getTokenPayload();
    if (!payload?.exp) return false;

    const nowSec = Math.floor(Date.now() / 1000);
    return payload.exp > nowSec;
  }

  getTokenPayload(): JwtPayload | null {
    const token = this.getToken();
    if (!token) return null;

    try {
      const parts = token.split('.');
      if (parts.length < 2) return null;

      return JSON.parse(atob(parts[1])) as JwtPayload;
    } catch {
      return null;
    }
  }

  logout() {
    localStorage.removeItem(this.tokenKey);
  }
}
