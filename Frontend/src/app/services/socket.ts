// src/app/services/socket.ts
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

  // NEW: ensure we only bind listeners once
  private listenersBound = false;

  constructor(private auth: AuthService) {}

  connect(): void {
    const token = this.auth.getToken();
    if (!token) {
      console.error('❌ No token available for socket connection');
      return;
    }

    // Create or reconnect socket
    if (!this.socket) {
      this.socket = io(environment.apiUrl, { query: { token } });
      this.socket.on('connect',    () => console.log('✅ Socket connected'));
      this.socket.on('disconnect', () => console.log('❌ Socket disconnected'));
    } else if (!this.socket.connected) {
      this.socket.connect();
    }

    // Bind core listeners ONCE
    if (!this.listenersBound) {
      this.bindCoreListeners();
      this.listenersBound = true;
    }
  }

  private bindCoreListeners() {
    // Remove any existing handlers (useful in HMR/dev)
    this.socket.off('publicMessage');
    this.socket.off('privateMessage');
    this.socket.off('publicVoice');
    this.socket.off('privateVoice');
    this.socket.off('onlineUsers');

    // ---- Text message listeners ----
    this.socket.on('publicMessage', (msg: ChatMessage) => {
      this.publicMessages$.next([...this.publicMessages$.value, msg]);
    });

    this.socket.on('privateMessage', (msg: ChatMessage) => {
      this.privateMessages$.next([...this.privateMessages$.value, msg]);
    });

    // ---- Voice message listeners ----
    this.socket.on('publicVoice', (msg: ChatMessage) => {
      this.publicMessages$.next([...this.publicMessages$.value, msg]);
    });

    this.socket.on('privateVoice', (msg: ChatMessage) => {
      this.privateMessages$.next([...this.privateMessages$.value, msg]);
    });

    // ---- Online users list ----
    this.socket.on('onlineUsers', (list: string[]) => {
      this.onlineUsers$.next(list || []);
    });
  }

  // ---- Send (text) ----
  sendPublicMessage(text: string): void {
    this.socket.emit('publicMessage', { text });
  }

  sendPrivateMessage(to: string, text: string, tempId?: string): void {
    this.socket.emit('privateMessage', { to, text, tempId });
  }

  // ---- Send (voice) ----
  sendPublicVoice(url: string, durationMs: number): void {
    this.socket.emit('publicVoice', { url, durationMs });
  }

  sendPrivateVoice(to: string, url: string, durationMs: number, tempId?: string): void {
    this.socket.emit('privateVoice', { to, url, durationMs, tempId });
  }

  // ---- Typing: public ----
  typingPublicStart(): void { this.socket.emit('typing:public'); }
  typingPublicStop(): void  { this.socket.emit('typing:publicStop'); }

  // ---- Typing: private ----
  typingPrivateStart(to: string): void { this.socket.emit('typing:private', { to }); }
  typingPrivateStop(to: string): void  { this.socket.emit('typing:privateStop', { to }); }

  // ---- Observers ----
  getMessages(): Observable<ChatMessage[]> {
    return this.publicMessages$.asObservable();
  }
  getPrivateMessages(): Observable<ChatMessage[]> {
    return this.privateMessages$.asObservable();
  }
  onOnlineUsers(): Observable<string[]> {
    return this.onlineUsers$.asObservable();
  }

  // Generic event listener
  onEvent<T = any>(event: string): Observable<T> {
    return new Observable<T>((observer) => {
      const handler = (data: T) => observer.next(data);
      this.socket.on(event, handler);
      return () => this.socket.off(event, handler);
    });
  }

  // Generic emitter
  emitEvent(event: string, data: any): void {
    this.socket.emit(event, data);
  }
}

export { Socket };
