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

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatSidenavModule, MatListModule, MatIconModule,
    MatButtonModule, MatInputModule, MatFormFieldModule,
    MatToolbarModule, MatMenuModule, MatDialogModule,
    MatDividerModule, MatCardModule
  ],
  templateUrl: './chat.html',
  styleUrls: ['./chat.css'],
})
export class ChatComponent {
  // Composer
  message = '';

  // Data
  publicMessages: ChatMessage[] = [];
  privateChats: Record<string, ChatMessage[]> = {};
  users: string[] = [];
  onlineUsers: string[] = [];

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

    // === PUBLIC ===
    this.socket.getMessages().subscribe((messages: ChatMessage[]) => {
      const m = messages[messages.length - 1];
      if (m) this.publicMessages.push(m);
    });

    // === PRIVATE (incoming only; your own sends use privateAck below) ===
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

      // ✅ Instant read if I'm viewing this thread and the msg is from the other user
      if (m.from !== me && this.selectedUser === other && m.id) {
        this.socket.emitEvent('markAsRead', { id: m.id, from: m.from });
        this.updateMessageStatus(other, m.id, 'read'); // blue ticks right away
      }
    });

    // === ACK: server maps tempId -> real DB id; set delivered ===
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
  }

  // ===== Public Chat =====
  sendPublic() {
    const text = this.message.trim();
    if (!text) return;
    this.socket.sendPublicMessage(text);
    this.message = '';
  }

  // ===== Private Chat =====
  async openChat(username: string) {
    this.selectedUser = username;

    // Mark all received messages in this thread as read immediately
    this.markAllAsRead(username);

    // If we already have history loaded, skip fetch
    if (this.privateChats[username]?.length) return;

    try {
      const token = this.auth.getToken()!;
      const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });

      const history = await this.http
        .get<ChatMessage[]>(`${environment.apiUrl}/api/private/${username}`, { headers })
        .toPromise();

      this.privateChats[username] = (history || [])
        .map((m) => ({
          ...m,
          status: (m.from === this.myUsername ? 'read' : undefined) as ChatMessage['status']
        }))
        .sort(
          (a, b) =>
            new Date(a.timestamp || 0).getTime() -
            new Date(b.timestamp || 0).getTime()
        );

      if (!this.users.includes(username)) this.users.unshift(username);
    } catch (e) {
      console.error('Failed to load chat history:', e);
      if (!this.privateChats[username]) this.privateChats[username] = [];
    }
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
  }

  backToPublic() {
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

  openAddUserDialog() {
    this.openStartChatDialog();
  }

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

  // Filtering
  applyFilter() {
    const term = this.searchTerm.toLowerCase();
    this.filteredOnlineUsers = this.onlineUsers.filter(u => u.toLowerCase().includes(term));
  }

  removePrivateChat(u: string) {
    delete this.privateChats[u];
    this.users = this.users.filter(user => user !== u);
    if (this.selectedUser === u) {
      this.selectedUser = null;
    }
  }
}
