import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { BehaviorSubject, Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth';
import { ChatMessage } from '../models/message.model';
import { Router } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class SocketService {
  private socket!: Socket;

  private publicMessages$  = new BehaviorSubject<ChatMessage[]>([]);
  private privateMessages$ = new BehaviorSubject<ChatMessage[]>([]);
  private onlineUsers$     = new BehaviorSubject<string[]>([]);

  constructor(private auth: AuthService, private router: Router) {}

  connect(): void {
    if (this.socket && this.socket.connected) return;

    if (this.socket && !this.socket.connected) {
      this.socket.connect();
      return;
    }

    const token = this.auth.getToken();
    if (!token) {
      console.error('❌ No token available for socket connection');
      return;
    }

    this.socket = io(environment.apiUrl, {
      query: { token },
      reconnection: true
    });

    this.socket.on('connect',    () => console.log('✅ Socket connected'));
    this.socket.on('disconnect', () => console.log('❌ Socket disconnected'));
    this.socket.on('connect_error', (err: Error) => {
      const msg = err?.message || '';
      if (msg.includes('AUTH_INVALID') || msg.includes('AUTH_REQUIRED')) {
        this.auth.logout();
        if (!this.router.url.startsWith('/login')) {
          this.router.navigate(['/login'], { queryParams: { reason: 'session-expired' } });
        }
      }
    });

    // Streams
    this.socket.on('publicMessage', (msg: ChatMessage) => {
      this.publicMessages$.next([...this.publicMessages$.value, msg]);
    });

    this.socket.on('privateMessage', (msg: ChatMessage) => {
      this.privateMessages$.next([...this.privateMessages$.value, msg]);
    });

    this.socket.on('onlineUsers', (list: string[]) => {
      this.onlineUsers$.next(list || []);
    });
  }

  // Send
  sendPublicMessage(text: string): void {
    this.socket.emit('publicMessage', { text });
  }

  sendPrivateMessage(to: string, text: string, tempId?: string): void {
    this.socket.emit('privateMessage', { to, text, tempId });
  }

  reactToMessage(scope: 'public' | 'private', messageId: string, emoji: string): void {
    this.socket.emit('messageReaction', { scope, messageId, emoji });
  }

  // Typing: public
  typingPublicStart(): void {
    this.socket.emit('typing:public');
  }
  typingPublicStop(): void {
    this.socket.emit('typing:publicStop');
  }

  // Typing: private
  typingPrivateStart(to: string): void {
    this.socket.emit('typing:private', { to });
  }
  typingPrivateStop(to: string): void {
    this.socket.emit('typing:privateStop', { to });
  }

  // Observe
  getMessages(): Observable<ChatMessage[]> {
    return this.publicMessages$.asObservable();
  }
  getPrivateMessages(): Observable<ChatMessage[]> {
    return this.privateMessages$.asObservable();
  }
  onOnlineUsers(): Observable<string[]> {
    return this.onlineUsers$.asObservable();
  }

  onEvent<T = any>(event: string): Observable<T> {
    return new Observable<T>((observer) => {
      const handler = (data: T) => observer.next(data);
      this.socket.on(event, handler);
      return () => this.socket.off(event, handler);
    });
  }

  emitEvent(event: string, data: any): void {
    this.socket.emit(event, data);
  }

  disconnect(): void {
    if (!this.socket) return;
    this.socket.disconnect();
  }
}
export { Socket };
