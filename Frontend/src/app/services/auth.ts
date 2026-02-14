import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Observable, tap } from 'rxjs';

interface JwtPayload {
  username?: string;
  exp?: number;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private apiUrl = `${environment.apiUrl}/api/user`;
  private tokenKey = 'token';
  private refreshTokenKey = 'refreshToken';
  private rememberKey = 'rememberSession';

  constructor(private http: HttpClient) {}

  register(username: string, email: string, password: string) {
    return this.http.post(`${this.apiUrl}/register`, { username, email, password });
  }

  login(identifier: string, password: string, remember = true) {
    this.setRememberSession(remember);
    return this.http.post(`${this.apiUrl}/login`, { identifier, password }).pipe(
      tap((res: any) => this.saveAuthSessionFromResponse(res))
    );
  }

  socialGoogle(idToken: string, nonce: string, username?: string) {
    return this.http.post(`${this.apiUrl}/social/google`, { idToken, nonce, username: username || undefined }).pipe(
      tap((res: any) => this.saveAuthSessionFromResponse(res))
    );
  }

  socialApple(idToken: string, nonce: string, username?: string) {
    return this.http.post(`${this.apiUrl}/social/apple`, { idToken, nonce, username: username || undefined }).pipe(
      tap((res: any) => this.saveAuthSessionFromResponse(res))
    );
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

  refreshSession() {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      return this.http.post(`${this.apiUrl}/refresh-token`, { refreshToken: '' });
    }
    return this.http.post(`${this.apiUrl}/refresh-token`, { refreshToken }).pipe(
      tap((res: any) => this.saveAuthSessionFromResponse(res))
    );
  }

  logoutSession() {
    const refreshToken = this.getRefreshToken();
    return this.http.post(`${this.apiUrl}/logout`, { refreshToken: refreshToken || undefined });
  }

  logoutAllSessions() {
    const token = this.getToken();
    return this.http.post(`${this.apiUrl}/logout-all`, {}, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
  }

  getUsername(): string | null {
    const payload = this.getTokenPayload();
    return payload?.username || null;
  }


  saveToken(token: string, remember = this.shouldRememberSession()) {
    const storage = remember ? localStorage : sessionStorage;
    const other = remember ? sessionStorage : localStorage;
    storage.setItem(this.tokenKey, token);
    other.removeItem(this.tokenKey);
  }

  saveRefreshToken(refreshToken: string, remember = this.shouldRememberSession()) {
    const storage = remember ? localStorage : sessionStorage;
    const other = remember ? sessionStorage : localStorage;
    storage.setItem(this.refreshTokenKey, refreshToken);
    other.removeItem(this.refreshTokenKey);
  }

  setRememberSession(remember: boolean) {
    localStorage.setItem(this.rememberKey, remember ? '1' : '0');
  }

  shouldRememberSession(): boolean {
    return localStorage.getItem(this.rememberKey) !== '0';
  }

  getToken(): string | null {
    return localStorage.getItem(this.tokenKey) || sessionStorage.getItem(this.tokenKey);
  }

  getRefreshToken(): string | null {
    return localStorage.getItem(this.refreshTokenKey) || sessionStorage.getItem(this.refreshTokenKey);
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
    localStorage.removeItem(this.refreshTokenKey);
    sessionStorage.removeItem(this.tokenKey);
    sessionStorage.removeItem(this.refreshTokenKey);
  }

  private saveAuthSessionFromResponse(res: any) {
    const token = String(res?.token || '');
    const refreshToken = String(res?.refreshToken || '');
    if (token) this.saveToken(token, this.shouldRememberSession());
    if (refreshToken) this.saveRefreshToken(refreshToken, this.shouldRememberSession());
  }
}
