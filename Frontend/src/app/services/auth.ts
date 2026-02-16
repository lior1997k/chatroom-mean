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

  getMe() {
    const token = this.getToken();
    return this.http.get(`${environment.apiUrl}/api/me`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
  }

  updateProfile(payload: {
    avatarUrl?: string;
    displayName?: string;
    bio?: string;
    statusText?: string;
    timezone?: string;
    lastSeenVisibility?: 'everyone' | 'contacts' | 'nobody';
  }) {
    const token = this.getToken();
    return this.http.patch(`${environment.apiUrl}/api/me/profile`, payload, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
  }

  changePassword(currentPassword: string, newPassword: string) {
    const token = this.getToken();
    return this.http.patch(`${environment.apiUrl}/api/me/password`, { currentPassword, newPassword }, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
  }

  listSessions() {
    const token = this.getToken();
    return this.http.get(`${this.apiUrl}/sessions`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
  }

  uploadAvatar(file: File) {
    const token = this.getToken();
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post(`${environment.apiUrl}/api/upload/avatar`, formData, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
  }

  getPublicProfile(username: string) {
    return this.http.get(`${environment.apiUrl}/api/users/${encodeURIComponent(username)}/public-profile`);
  }

  adminListUsers(params: {
    q?: string;
    role?: string;
    verified?: '' | 'true' | 'false';
    page?: number;
    limit?: number;
    sortBy?: 'createdAt' | 'lastLoginAt' | 'username';
    sortDir?: 'asc' | 'desc';
  } = {}) {
    const token = this.getToken();
    return this.http.get(`${environment.apiUrl}/api/admin/auth/users`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      params: {
        q: params.q || '',
        role: params.role || '',
        verified: params.verified || '',
        page: Number(params.page || 1),
        limit: Number(params.limit || 40),
        sortBy: params.sortBy || 'createdAt',
        sortDir: params.sortDir || 'desc'
      }
    });
  }

  adminSetUserRole(userId: string, role: string) {
    const token = this.getToken();
    return this.http.patch(`${environment.apiUrl}/api/admin/auth/users/${encodeURIComponent(userId)}/role`, { role }, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
  }

  adminVerifyEmail(userId: string) {
    const token = this.getToken();
    return this.http.post(`${environment.apiUrl}/api/admin/auth/users/${encodeURIComponent(userId)}/verify-email`, {}, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
  }

  adminUnlockUser(userId: string) {
    const token = this.getToken();
    return this.http.post(`${environment.apiUrl}/api/admin/auth/users/${encodeURIComponent(userId)}/unlock`, {}, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
  }

  adminRevokeSessions(userId: string) {
    const token = this.getToken();
    return this.http.post(`${environment.apiUrl}/api/admin/auth/users/${encodeURIComponent(userId)}/revoke-sessions`, {}, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
  }

  adminListAbuseEvents(page = 1, limit = 80) {
    const token = this.getToken();
    return this.http.get(`${environment.apiUrl}/api/admin/auth/abuse-events`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      params: { page, limit }
    });
  }

  adminListAttachmentReports(params: {
    status?: string;
    category?: string;
    scope?: string;
    severity?: string;
    page?: number;
    limit?: number;
  } = {}) {
    const token = this.getToken();
    return this.http.get(`${environment.apiUrl}/api/admin/auth/reports/attachments`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      params: {
        status: params.status || '',
        category: params.category || '',
        scope: params.scope || '',
        severity: params.severity || '',
        page: Number(params.page || 1),
        limit: Number(params.limit || 80)
      }
    });
  }

  adminAttachmentReportDetail(reportId: string) {
    const token = this.getToken();
    return this.http.get(`${environment.apiUrl}/api/admin/auth/reports/attachments/${encodeURIComponent(reportId)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
  }

  adminUpdateAttachmentReport(reportId: string, status: string) {
    const token = this.getToken();
    return this.http.patch(`${environment.apiUrl}/api/admin/auth/reports/attachments/${encodeURIComponent(reportId)}`, { status }, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
  }

  adminRemoveMessage(scope: 'public' | 'private', messageId: string) {
    const token = this.getToken();
    return this.http.post(`${environment.apiUrl}/api/admin/auth/messages/${scope}/${encodeURIComponent(messageId)}/remove`, {}, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
  }

  adminAuditActions(page = 1, limit = 60) {
    const token = this.getToken();
    return this.http.get(`${environment.apiUrl}/api/admin/auth/audit-actions`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      params: { page, limit }
    });
  }

  checkDisplayNameAvailability(displayName: string) {
    const token = this.getToken();
    return this.http.get(`${environment.apiUrl}/api/users/check-display-name`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      params: { displayName }
    });
  }

  adminBanUserWeek(userId: string) {
    const token = this.getToken();
    return this.http.post(`${environment.apiUrl}/api/admin/auth/users/${encodeURIComponent(userId)}/ban-week`, {}, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
  }

  adminBlockUser(userId: string) {
    const token = this.getToken();
    return this.http.post(`${environment.apiUrl}/api/admin/auth/users/${encodeURIComponent(userId)}/block`, {}, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
  }

  adminUnblockUser(userId: string) {
    const token = this.getToken();
    return this.http.post(`${environment.apiUrl}/api/admin/auth/users/${encodeURIComponent(userId)}/unblock`, {}, {
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

  // User preferences
  getPreferences() {
    const token = this.getToken();
    return this.http.get(`${environment.apiUrl}/api/me/preferences`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
  }

  updatePreferences(preferences: any) {
    const token = this.getToken();
    return this.http.patch(`${environment.apiUrl}/api/me/preferences`, preferences, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
  }

  // Blocked users (private messages)
  getBlockedPrivateList() {
    const token = this.getToken();
    return this.http.get<any[]>(`${environment.apiUrl}/api/me/blocked-private`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
  }

  blockPrivateUser(userId: string) {
    const token = this.getToken();
    return this.http.post(`${environment.apiUrl}/api/me/block-private/${encodeURIComponent(userId)}`, {}, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
  }

  unblockPrivateUser(userId: string) {
    const token = this.getToken();
    return this.http.post(`${environment.apiUrl}/api/me/unblock-private/${encodeURIComponent(userId)}`, {}, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined
    });
  }

  private saveAuthSessionFromResponse(res: any) {
    const token = String(res?.token || '');
    const refreshToken = String(res?.refreshToken || '');
    if (token) this.saveToken(token, this.shouldRememberSession());
    if (refreshToken) this.saveRefreshToken(refreshToken, this.shouldRememberSession());
  }
}
