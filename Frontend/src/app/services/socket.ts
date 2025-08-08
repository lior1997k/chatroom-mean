import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { BehaviorSubject, Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth';
import { ChatMessage } from '../models/message.model';

@Injectable({ providedIn: 'root' })
export class SocketService {
  private socket!: Socket;

  private publicMessages$  = new BehaviorSubject<ChatMessage[]>([]);
  private privateMessages$ = new BehaviorSubject<ChatMessage[]>([]);
  private onlineUsers$     = new BehaviorSubject<string[]>([]);

  constructor(private auth: AuthService) {}

  connect(): void {
    if (this.socket && this.socket.connected) return;

    const token = this.auth.getToken();
    if (!token) {
      console.error('❌ No token available for socket connection');
      return;
    }

    this.socket = io(environment.apiUrl, {
      query: { token }
    });

    this.socket.on('connect',    () => console.log('✅ Socket connected'));
    this.socket.on('disconnect', () => console.log('❌ Socket disconnected'));

    // === Server -> Client streams ===
    this.socket.on('publicMessage', (msg: ChatMessage) => {
      this.publicMessages$.next([...this.publicMessages$.value, msg]);
    });

    // Only real messages from server (recipient side). Sender gets privateAck instead.
    this.socket.on('privateMessage', (msg: ChatMessage) => {
      this.privateMessages$.next([...this.privateMessages$.value, msg]);
    });

    this.socket.on('onlineUsers', (list: string[]) => {
      this.onlineUsers$.next(list || []);
    });

    // We do NOT add handlers for 'privateAck' / 'messageSent' / 'messageDelivered' / 'messageRead' here,
    // because the component will subscribe to them via onEvent<T>('eventName').
  }

  // === Client -> Server ===
  sendPublicMessage(text: string): void {
    this.socket.emit('publicMessage', { text });
  }

  // tempId lets the UI show the message immediately and later map to real DB id via privateAck
  sendPrivateMessage(to: string, text: string, tempId?: string): void {
    this.socket.emit('privateMessage', { to, text, tempId });
  }

  emitEvent(event: string, data: any): void {
    this.socket.emit(event, data);
  }

  // === Observables ===
  getMessages(): Observable<ChatMessage[]> {
    return this.publicMessages$.asObservable();
  }

  getPrivateMessages(): Observable<ChatMessage[]> {
    return this.privateMessages$.asObservable();
  }

  onOnlineUsers(): Observable<string[]> {
    return this.onlineUsers$.asObservable();
  }

  // Subscribe to arbitrary socket events (acks & receipts)
  onEvent<T = any>(event: string): Observable<T> {
    return new Observable<T>((observer) => {
      const handler = (data: T) => observer.next(data);
      this.socket.on(event, handler);
      // optional cleanup when subscriber unsubscribes
      return () => this.socket.off(event, handler);
    });
  }
}

// Some tests import Socket from here; re-export to keep them happy.
export { Socket };
