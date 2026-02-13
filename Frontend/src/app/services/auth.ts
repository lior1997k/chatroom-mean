import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private apiUrl = `${environment.apiUrl}/api/user`;
  private tokenKey = 'token';

  constructor(private http: HttpClient) {}

  register(username: string, password: string) {
    return this.http.post(`${this.apiUrl}/register`, { username, password });
  }

  login(username: string, password: string) {
    return this.http.post(`${this.apiUrl}/login`, { username, password });
  }

  getUsername(): string | null {
  const token = this.getToken();
  if (!token) return null;

  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.username;
    } catch (e) {
      return null;
    }
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

  logout() {
    localStorage.removeItem(this.tokenKey);
  }
}
