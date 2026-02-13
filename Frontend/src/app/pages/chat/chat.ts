import { Component, TemplateRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';

import { SocketService } from '../../services/socket';
import { AuthService } from '../../services/auth';
import { environment } from '../../../environments/environment';
import { ChatMessage } from '../../models/message.model';

import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatCardModule } from '@angular/material/card';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatSidenavModule, MatListModule, MatIconModule,
    MatButtonModule, MatInputModule, MatFormFieldModule,
    MatToolbarModule, MatMenuModule, MatDialogModule,
    MatDividerModule, MatCardModule, MatTooltipModule
  ],
  templateUrl: './chat.html',
  styleUrls: ['./chat.css'],
})
export class ChatComponent {
  // Composer
  message = '';

  // Data
  publicMessages: ChatMessage[] = [];
  publicHasMore = true;
  publicLoading = false;
  privateChats: Record<string, ChatMessage[]> = {};
  users: string[] = [];
  onlineUsers: string[] = [];
  unreadCounts: Record<string, number> = {};

  // Typing state we SHOW about others
  isTypingPublic = new Set<string>();        // who is typing in public
  isTypingMap: Record<string, boolean> = {}; // username -> typing in private

  // Typing state WE EMIT (to avoid spamming start/stop)
  private publicTypingActive = false;
  private privateTypingActiveFor: string | null = null;
  private lastPublicTypingEmitAt = 0;
  private lastPrivateTypingEmitAt: Record<string, number> = {};
  private typingIdleTimer: ReturnType<typeof setTimeout> | null = null;
  private publicTypingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private privateTypingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private historyLoaded = new Set<string>();

  // Filtering
  searchTerm = '';
  filteredOnlineUsers: string[] = [];

  // View state
  selectedUser: string | null = null;
  menuUser: string | null = null;

  // Dialog
  newUser = '';
  @ViewChild('startChatTpl') startChatTpl!: TemplateRef<any>;

  constructor(
    private socket: SocketService,
    private auth: AuthService,
    private http: HttpClient,
    public dialog: MatDialog
  ) {}

  ngOnInit() {
    const token = this.auth.getToken();
    if (!token) {
      window.location.href = '/login';
      return;
    }

    this.socket.connect();
    this.loadUnreadCounts();
    this.loadPublicMessages();

    // === PUBLIC ===
    this.socket.getMessages().subscribe((messages: ChatMessage[]) => {
      const m = messages[messages.length - 1];
      if (m) this.appendPublicMessage(m);
    });

    // === PRIVATE (incoming only; your own sends use privateAck) ===
    this.socket.getPrivateMessages().subscribe((messages: ChatMessage[]) => {
      const m = messages[messages.length - 1];
      if (!m) return;

      const me = this.myUsername;
      const other = m.from === me ? m.to! : m.from;
      if (!other) return;

      if (!this.privateChats[other]) this.privateChats[other] = [];
      this.privateChats[other].push({
        ...m,
        status: (m.from === me ? 'sent' : m.status) as ChatMessage['status']
      });

      if (!this.users.includes(other)) this.users.unshift(other);

      // Instant read if I'm viewing this thread and msg is from the other user
      if (m.from !== me && this.selectedUser === other && m.id) {
        this.socket.emitEvent('markAsRead', { id: m.id, from: m.from });
        this.updateMessageStatus(other, m.id, 'read');
      } else if (m.from !== me) {
        this.unreadCounts[other] = (this.unreadCounts[other] || 0) + 1;
      }
    });

    this.socket.onEvent<{ counts: Array<{ username: string; count: number }> }>('unreadCountsUpdated')
      .subscribe((payload) => {
        if (!payload?.counts) return;
        this.applyUnreadCounts(payload.counts);
      });

    // === ACK: tempId -> real id ===
    this.socket.onEvent<{ tempId: string; id: string; to: string; timestamp: string }>('privateAck')
      .subscribe((ack) => {
        if (!ack) return;
        const arr = this.privateChats[ack.to] || [];
        const msg = arr.find(x => x.id === ack.tempId);
        if (msg) {
          msg.id = ack.id;
          msg.timestamp = ack.timestamp;
          msg.status = 'delivered';
        }
      });

    // === RECEIPTS ===
    this.socket.onEvent<{ id: string; to: string }>('messageSent')
      .subscribe((d) => d && this.updateMessageStatus(d.to, d.id, 'sent'));

    this.socket.onEvent<{ id: string; to: string }>('messageDelivered')
      .subscribe((d) => d && this.updateMessageStatus(d.to, d.id, 'delivered'));

    this.socket.onEvent<{ id: string }>('messageRead')
      .subscribe((d) => {
        if (!d) return;
        Object.keys(this.privateChats).forEach(u => this.updateMessageStatus(u, d.id, 'read'));
      });

    // === ONLINE USERS ===
    this.socket.onOnlineUsers().subscribe((list) => {
      const me = this.myUsername;
      this.onlineUsers = (list || []).filter(u => u !== me);
      this.applyFilter();
    });

    // === TYPING: PUBLIC ===
    this.socket.onEvent<{ from: string }>('typing:public')
      .subscribe((ev) => {
        if (!ev?.from) return;
        this.isTypingPublic.add(ev.from);
        this.refreshPublicTypingTimeout(ev.from);
      });

    this.socket.onEvent<{ from: string }>('typing:publicStop')
      .subscribe((ev) => {
        if (!ev?.from) return;
        this.isTypingPublic.delete(ev.from);
        this.clearPublicTypingTimeout(ev.from);
      });

    // === TYPING: PRIVATE ===
    this.socket.onEvent<{ from: string; to: string }>('typing:private')
      .subscribe((ev) => {
        if (!ev) return;
        if (this.selectedUser === ev.from) this.isTypingMap[ev.from] = true;
        this.refreshPrivateTypingTimeout(ev.from);
      });

    this.socket.onEvent<{ from: string; to: string }>('typing:privateStop')
      .subscribe((ev) => {
        if (!ev) return;
        if (this.selectedUser === ev.from) this.isTypingMap[ev.from] = false;
        this.clearPrivateTypingTimeout(ev.from);
      });
  }

  ngOnDestroy() {
    this.clearTypingIdleTimer();
    this._stopPublicTypingIfActive();

    if (this.privateTypingActiveFor) {
      this.socket.typingPrivateStop(this.privateTypingActiveFor);
      this.privateTypingActiveFor = null;
    }

    this.publicTypingTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.privateTypingTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.publicTypingTimeouts.clear();
    this.privateTypingTimeouts.clear();
  }

  // ===== Public Chat =====
  sendPublic() {
    const text = this.message.trim();
    if (!text) return;
    this.socket.sendPublicMessage(text);
    this.message = '';
    this._stopPublicTypingIfActive();
  }

  loadOlderPublicMessages() {
    if (this.publicLoading || !this.publicHasMore) return;

    const oldest = this.publicMessages[0]?.timestamp;
    this.loadPublicMessages(oldest || undefined);
  }

  // Called on <input> for PUBLIC view
  onPublicInput() {
    if (this.selectedUser) return; // only in public

    const hasText = this.message.trim().length > 0;

    if (!hasText) {
      this._stopPublicTypingIfActive();
      this.clearTypingIdleTimer();
      return;
    }

    const now = Date.now();
    if (!this.publicTypingActive || now - this.lastPublicTypingEmitAt > 900) {
      this.socket.typingPublicStart();
      this.publicTypingActive = true;
      this.lastPublicTypingEmitAt = now;
    }

    this.resetTypingIdleTimer();
  }

  // ===== Private Chat =====
  async openChat(username: string) {
    // switching views → stop public typing if active
    this._stopPublicTypingIfActive();

    // switching threads → stop previous private typing if active
    if (this.privateTypingActiveFor && this.privateTypingActiveFor !== username) {
      this.socket.typingPrivateStop(this.privateTypingActiveFor);
      this.privateTypingActiveFor = null;
    }

    this.selectedUser = username;
    this.unreadCounts[username] = 0;
    this.markAllAsRead(username);

    if (this.historyLoaded.has(username)) return;

    try {
      const token = this.auth.getToken()!;
      const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });

      const history = await this.http
        .get<ChatMessage[]>(`${environment.apiUrl}/api/private/${username}`, { headers })
        .toPromise();

      const loaded = (history || [])
        .map((m) => ({
          ...m,
          status: (m.from === this.myUsername ? 'read' : undefined) as ChatMessage['status']
        }))
        .sort(
          (a, b) =>
            new Date(a.timestamp || 0).getTime() -
            new Date(b.timestamp || 0).getTime()
        );

      const existing = this.privateChats[username] || [];
      const merged = new Map<string, ChatMessage>();

      [...loaded, ...existing].forEach((m) => {
        const key = m.id || `${m.from}|${m.to}|${m.timestamp}|${m.text}`;
        merged.set(key, m);
      });

      this.privateChats[username] = Array.from(merged.values()).sort(
        (a, b) =>
          new Date(a.timestamp || 0).getTime() -
          new Date(b.timestamp || 0).getTime()
      );
      this.historyLoaded.add(username);

      if (!this.users.includes(username)) this.users.unshift(username);
    } catch (e) {
      console.error('Failed to load chat history:', e);
      if (!this.privateChats[username]) this.privateChats[username] = [];
    }
  }

  // Called on <input> for PRIVATE view
  onPrivateInput() {
    if (!this.selectedUser) return;

    const to = this.selectedUser;
    const hasText = this.message.trim().length > 0;

    if (!hasText) {
      if (this.privateTypingActiveFor === to) {
        this.socket.typingPrivateStop(to);
        this.privateTypingActiveFor = null;
      }
      this.clearTypingIdleTimer();
      return;
    }

    const now = Date.now();
    const last = this.lastPrivateTypingEmitAt[to] || 0;
    if (this.privateTypingActiveFor !== to || now - last > 900) {
      this.socket.typingPrivateStart(to);
      this.privateTypingActiveFor = to;
      this.lastPrivateTypingEmitAt[to] = now;
    }

    this.resetTypingIdleTimer();
  }

  onInputBlur() {
    // If composer loses focus, stop whichever typing mode was active
    if (!this.selectedUser) {
      this._stopPublicTypingIfActive();
    } else if (this.privateTypingActiveFor === this.selectedUser) {
      this.socket.typingPrivateStop(this.selectedUser);
      this.privateTypingActiveFor = null;
    }

    this.clearTypingIdleTimer();
  }

  sendPrivate() {
    const text = this.message.trim();
    if (!text || !this.selectedUser) return;

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const msg: ChatMessage = {
      id: tempId,
      from: this.myUsername!,
      to: this.selectedUser,
      text,
      timestamp: new Date().toISOString(),
      status: 'sent'
    };

    if (!this.privateChats[this.selectedUser]) this.privateChats[this.selectedUser] = [];
    this.privateChats[this.selectedUser].push(msg);

    this.socket.sendPrivateMessage(this.selectedUser, text, tempId);
    this.message = '';

    // stop private typing after send
    if (this.privateTypingActiveFor === this.selectedUser) {
      this.socket.typingPrivateStop(this.selectedUser);
      this.privateTypingActiveFor = null;
    }
  }

  backToPublic() {
    // leaving private → stop private typing if active
    if (this.privateTypingActiveFor) {
      this.socket.typingPrivateStop(this.privateTypingActiveFor);
      this.privateTypingActiveFor = null;
    }

    this.clearTypingIdleTimer();
    this.selectedUser = null;
    this.message = '';
  }

  openDmFromSidebar(u: string) {
    if (!u) return;
    if (!this.users.includes(u)) this.users.unshift(u);
    if (!this.privateChats[u]) this.privateChats[u] = [];
    this.openChat(u);
  }

  // Dialog
  openStartChatDialog() {
    this.newUser = '';
    this.dialog.open(this.startChatTpl, { width: '360px' });
  }
  openAddUserDialog() { this.openStartChatDialog(); }

  startChatConfirm(ref: MatDialogRef<any>) {
    const u = (this.newUser || '').trim();
    if (!u) return;

    if (!this.users.includes(u)) this.users.unshift(u);
    if (!this.privateChats[u]) this.privateChats[u] = [];

    ref.close();
    this.openChat(u);
  }

  startChatFromPublic(username: string | null) {
    if (!username || username === this.myUsername) return;
    if (!this.users.includes(username)) this.users.unshift(username);
    if (!this.privateChats[username]) this.privateChats[username] = [];
    this.openChat(username);
  }

  // Helpers
  get myUsername(): string | null {
    return this.auth.getUsername();
  }

  // Angular template can’t call Array.from directly; provide a getter
  get typingPublicList(): string[] {
    return Array.from(this.isTypingPublic);
  }

  get publicTypingText(): string {
    const users = this.typingPublicList;
    if (!users.length) return '';

    const shown = users.slice(0, 2);
    const extra = users.length - shown.length;
    const subject = extra > 0 ? `${shown.join(', ')} +${extra} others` : shown.join(', ');
    const verb = users.length === 1 ? 'is' : 'are';

    return `${subject} ${verb} typing...`;
  }

  lastText(u: string): string {
    const arr = this.privateChats[u] || [];
    return arr.length ? arr[arr.length - 1].text : '';
  }

  currentThread(): ChatMessage[] {
    return this.selectedUser ? (this.privateChats[this.selectedUser] || []) : this.publicMessages;
  }

  updateMessageStatus(user: string, id: string, status: 'sent' | 'delivered' | 'read') {
    const arr = this.privateChats[user] || [];
    const msg = arr.find(m => m.id === id);
    if (msg) msg.status = status as ChatMessage['status'];
  }

  markAllAsRead(user: string) {
    const arr = this.privateChats[user] || [];
    arr.forEach(m => {
      if (m.from !== this.myUsername && m.status !== 'read' && m.id) {
        this.socket.emitEvent('markAsRead', { id: m.id, from: m.from });
        m.status = 'read' as ChatMessage['status'];
      }
    });
  }

  applyFilter() {
    const term = this.searchTerm.toLowerCase();
    this.filteredOnlineUsers = this.onlineUsers.filter(u => u.toLowerCase().includes(term));
  }

  removePrivateChat(u: string) {
    delete this.privateChats[u];
    delete this.unreadCounts[u];
    this.historyLoaded.delete(u);
    this.users = this.users.filter(user => user !== u);
    if (this.selectedUser === u) {
      this.selectedUser = null;
    }
  }

  unreadCount(u: string): number {
    return this.unreadCounts[u] || 0;
  }

  private loadUnreadCounts() {
    const token = this.auth.getToken();
    if (!token) return;

    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
    this.http
      .get<Array<{ username: string; count: number }>>(`${environment.apiUrl}/api/private/unread-counts`, { headers })
      .subscribe({
        next: (counts) => this.applyUnreadCounts(counts || []),
        error: () => {}
      });
  }

  private applyUnreadCounts(counts: Array<{ username: string; count: number }>) {
    this.unreadCounts = {};
    counts.forEach((item) => {
      if (!item?.username) return;
      this.unreadCounts[item.username] = item.count || 0;
      if (!this.users.includes(item.username)) this.users.unshift(item.username);
    });
    if (this.selectedUser) this.unreadCounts[this.selectedUser] = 0;
  }

  // Utils
  private _stopPublicTypingIfActive() {
    if (this.publicTypingActive) {
      this.socket.typingPublicStop();
      this.publicTypingActive = false;
    }
  }

  private resetTypingIdleTimer() {
    this.clearTypingIdleTimer();
    this.typingIdleTimer = setTimeout(() => {
      if (!this.selectedUser) {
        this._stopPublicTypingIfActive();
        return;
      }

      if (this.privateTypingActiveFor === this.selectedUser) {
        this.socket.typingPrivateStop(this.selectedUser);
        this.privateTypingActiveFor = null;
      }
    }, 1600);
  }

  private clearTypingIdleTimer() {
    if (!this.typingIdleTimer) return;

    clearTimeout(this.typingIdleTimer);
    this.typingIdleTimer = null;
  }

  private refreshPublicTypingTimeout(username: string) {
    this.clearPublicTypingTimeout(username);

    const timeout = setTimeout(() => {
      this.isTypingPublic.delete(username);
      this.publicTypingTimeouts.delete(username);
    }, 3500);

    this.publicTypingTimeouts.set(username, timeout);
  }

  private clearPublicTypingTimeout(username: string) {
    const timeout = this.publicTypingTimeouts.get(username);
    if (!timeout) return;

    clearTimeout(timeout);
    this.publicTypingTimeouts.delete(username);
  }

  private refreshPrivateTypingTimeout(username: string) {
    this.clearPrivateTypingTimeout(username);

    const timeout = setTimeout(() => {
      this.isTypingMap[username] = false;
      this.privateTypingTimeouts.delete(username);
    }, 3500);

    this.privateTypingTimeouts.set(username, timeout);
  }

  private clearPrivateTypingTimeout(username: string) {
    const timeout = this.privateTypingTimeouts.get(username);
    if (!timeout) return;

    clearTimeout(timeout);
    this.privateTypingTimeouts.delete(username);
  }

  private loadPublicMessages(before?: string) {
    const token = this.auth.getToken();
    if (!token) return;

    this.publicLoading = true;
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });

    const params = new URLSearchParams();
    params.set('limit', '50');
    if (before) params.set('before', before);

    this.http
      .get<{ messages: ChatMessage[]; hasMore: boolean }>(
        `${environment.apiUrl}/api/public?${params.toString()}`,
        { headers }
      )
      .subscribe({
        next: (res) => {
          const page = (res?.messages || []).sort(
            (a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime()
          );

          if (before) {
            this.publicMessages = this.mergePublicMessages(page, this.publicMessages);
          } else {
            this.publicMessages = this.mergePublicMessages(this.publicMessages, page);
          }

          this.publicHasMore = !!res?.hasMore;
          this.publicLoading = false;
        },
        error: () => {
          this.publicLoading = false;
        }
      });
  }

  private appendPublicMessage(msg: ChatMessage) {
    this.publicMessages = this.mergePublicMessages(this.publicMessages, [msg]);
  }

  private mergePublicMessages(base: ChatMessage[], incoming: ChatMessage[]) {
    const merged = new Map<string, ChatMessage>();
    [...base, ...incoming].forEach((m) => {
      const key = m.id || `${m.from}|${m.timestamp}|${m.text}`;
      merged.set(key, m);
    });

    return Array.from(merged.values()).sort(
      (a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime()
    );
  }
}
