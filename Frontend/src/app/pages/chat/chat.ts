import { Component, TemplateRef, ViewChild, OnDestroy } from '@angular/core';
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
export class ChatComponent implements OnDestroy {
  // Composer
  message = '';

  // Data
  publicMessages: ChatMessage[] = [];
  privateChats: Record<string, ChatMessage[]> = {};
  users: string[] = [];
  onlineUsers: string[] = [];

  // Typing (others)
  isTypingPublic = new Set<string>();
  isTypingMap: Record<string, boolean> = {};

  // Typing (we emit)
  private publicTypingActive = false;
  private privateTypingActiveFor: string | null = null;

  // Filtering
  searchTerm = '';
  filteredOnlineUsers: string[] = [];

  // View state
  selectedUser: string | null = null;
  menuUser: string | null = null;

  // Dialogs
  newUser = '';
  @ViewChild('startChatTpl') startChatTpl!: TemplateRef<any>;
  @ViewChild('voicePreviewTpl') voicePreviewTpl!: TemplateRef<any>;
  private voicePreviewRef?: MatDialogRef<any>;

  // Voice recording
  isRecording = false;
  private mediaRecorder!: MediaRecorder;
  private audioChunks: Blob[] = [];
  private recordStartTime = 0;
  previewBlob: Blob | null = null;
  previewUrl: string | null = null;
  previewDurationMs = 0;

  constructor(
    private socket: SocketService,
    private auth: AuthService,
    private http: HttpClient,
    public dialog: MatDialog
  ) {}

  // ---------- Helpers to avoid duplicates ----------
  private hasMsg(arr: ChatMessage[], id?: string): boolean {
    if (!id) return false;
    return arr.some(m => m.id === id);
  }
  private appendUnique(targetArr: ChatMessage[], m: ChatMessage) {
    if (m.id && !this.hasMsg(targetArr, m.id)) targetArr.push(m);
  }

  ngOnInit() {
    const token = this.auth.getToken();
    if (!token) {
      window.location.href = '/login';
      return;
    }

    this.socket.connect();

    // === PUBLIC (dedupe by id) ===
    this.socket.getMessages().subscribe((messages: ChatMessage[]) => {
      const m = messages[messages.length - 1];
      if (!m) return;
      if (!this.hasMsg(this.publicMessages, m.id)) {
        this.publicMessages = [...this.publicMessages, m];
      }
    });

    // === PRIVATE incoming (dedupe + auto-read when viewing) ===
    this.socket.getPrivateMessages().subscribe((messages: ChatMessage[]) => {
      const m = messages[messages.length - 1];
      if (!m) return;

      const me = this.myUsername;
      const other = m.from === me ? m.to! : m.from;
      if (!other) return;

      if (!this.privateChats[other]) this.privateChats[other] = [];
      if (!this.hasMsg(this.privateChats[other], m.id)) {
        this.privateChats[other].push({
          ...m,
          status: (m.from === me ? 'sent' : m.status) as ChatMessage['status']
        });
      }

      if (!this.users.includes(other)) this.users.unshift(other);

      // If I'm looking at that thread and it's an incoming message → mark read
      if (m.from !== me && this.selectedUser === other && m.id) {
        this.socket.emitEvent('markAsRead', { id: m.id, from: m.from });
        this.updateMessageStatus(other, m.id, 'read');
      }
    });

    // === ACK: tempId -> real id (convert the local echo) ===
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

    // === TYPING indicators ===
    this.socket.onEvent<{ from: string }>('typing:public')
      .subscribe((ev) => { if (ev?.from) this.isTypingPublic.add(ev.from); });

    this.socket.onEvent<{ from: string }>('typing:publicStop')
      .subscribe((ev) => { if (ev?.from) this.isTypingPublic.delete(ev.from); });

    this.socket.onEvent<{ from: string; to: string }>('typing:private')
      .subscribe((ev) => { if (this.selectedUser === ev.from) this.isTypingMap[ev.from] = true; });

    this.socket.onEvent<{ from: string; to: string }>('typing:privateStop')
      .subscribe((ev) => { if (this.selectedUser === ev.from) this.isTypingMap[ev.from] = false; });
  }

  ngOnDestroy(): void {
    this._stopAndReleaseStream();
    this._revokePreviewUrl();
  }

  // ===== Public Chat =====
  sendPublic() {
    const text = this.message.trim();
    if (!text) return;
    this.socket.sendPublicMessage(text);
    this.message = '';
    this._stopPublicTypingIfActive();
  }
  onPublicInput() {
    if (this.selectedUser) return;
    const hasText = this.message.trim().length > 0;
    if (hasText && !this.publicTypingActive) {
      this.socket.typingPublicStart();
      this.publicTypingActive = true;
    } else if (!hasText && this.publicTypingActive) {
      this._stopPublicTypingIfActive();
    }
  }

  // ===== Private Chat =====
  async openChat(username: string) {
    this._stopPublicTypingIfActive();

    if (this.privateTypingActiveFor && this.privateTypingActiveFor !== username) {
      this.socket.typingPrivateStop(this.privateTypingActiveFor);
      this.privateTypingActiveFor = null;
    }

    this.selectedUser = username;
    this.markAllAsRead(username);

    // Fetch history only once (preserve any voice/text already in memory)
    if (this.privateChats[username]?.length) return;

    try {
      const token = this.auth.getToken()!;
      const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });

      const history = await this.http
        .get<ChatMessage[]>(`${environment.apiUrl}/api/private/${username}`, { headers })
        .toPromise();

      const existing = this.privateChats[username] ?? [];
      const incoming = (history || [])
        .map((m) => ({
          ...m,
          status: (m.from === this.myUsername ? 'read' : m.status) as ChatMessage['status']
        }))
        .sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());

      // merge without duplicates
      const byId = new Map<string, ChatMessage>();
      for (const m of [...existing, ...incoming]) {
        if (m.id) byId.set(m.id, m);
        else byId.set(`${m.from}-${m.timestamp}-${m.text}`, m); // fallback
      }
      this.privateChats[username] = Array.from(byId.values());

      if (!this.users.includes(username)) this.users.unshift(username);
    } catch (e) {
      console.error('Failed to load chat history:', e);
      if (!this.privateChats[username]) this.privateChats[username] = [];
    }
  }

  onPrivateInput() {
    if (!this.selectedUser) return;
    const to = this.selectedUser;
    const hasText = this.message.trim().length > 0;
    if (hasText && this.privateTypingActiveFor !== to) {
      this.socket.typingPrivateStart(to);
      this.privateTypingActiveFor = to;
    } else if (!hasText && this.privateTypingActiveFor === to) {
      this.socket.typingPrivateStop(to);
      this.privateTypingActiveFor = null;
    }
  }
  onInputBlur() {
    if (!this.selectedUser) {
      this._stopPublicTypingIfActive();
    } else if (this.privateTypingActiveFor === this.selectedUser) {
      this.socket.typingPrivateStop(this.selectedUser);
      this.privateTypingActiveFor = null;
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
    this.appendUnique(this.privateChats[this.selectedUser], msg);

    this.socket.sendPrivateMessage(this.selectedUser, text, tempId);
    this.message = '';

    if (this.privateTypingActiveFor === this.selectedUser) {
      this.socket.typingPrivateStop(this.selectedUser);
      this.privateTypingActiveFor = null;
    }
  }

  // ===== Voice: tap-to-toggle + dialog preview =====
  async toggleRecording() {
    if (this.isRecording) {
      this.stopRecordingToPreview();
    } else {
      await this.startRecording();
    }
  }

  private async startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioChunks = [];
      this.recordStartTime = Date.now();

      this.mediaRecorder = new MediaRecorder(stream);
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.audioChunks.push(event.data);
      };
      this.mediaRecorder.onstop = () => {
        this.previewDurationMs = Date.now() - this.recordStartTime;
        this.previewBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        this._revokePreviewUrl();
        this.previewUrl = URL.createObjectURL(this.previewBlob);
        this.openVoicePreviewDialog();
      };

      this.mediaRecorder.start();
      this.isRecording = true;
    } catch (err) {
      console.error('🎤 Error starting recording', err);
      alert('Microphone access denied.');
    }
  }

  private stopRecordingToPreview() {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
      this._stopAndReleaseStream();
    }
  }

  private openVoicePreviewDialog() {
    if (!this.voicePreviewTpl) return;
    this.voicePreviewRef = this.dialog.open(this.voicePreviewTpl, {
      width: '440px',
      panelClass: 'voice-preview-dialog',
      autoFocus: false,
      restoreFocus: false
    });
  }

  cancelRecording() {
    this.clearPreview();
    this.voicePreviewRef?.close();
  }

  async sendRecorded() {
    if (!this.previewBlob) return;

    try {
      const formData = new FormData();
      formData.append('voice', this.previewBlob, `voice-${Date.now()}.webm`);
      formData.append('durationMs', String(this.previewDurationMs));

      const token = this.auth.getToken()!;
      const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });

      const res = await this.http
        .post<{ url: string }>(`${environment.apiUrl}/api/upload/voice`, formData, { headers })
        .toPromise();

      if (!res?.url) {
        console.error('Upload failed: No URL returned');
        return;
      }

      if (this.selectedUser) {
        const tempId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        const msg: ChatMessage = {
          id: tempId,
          from: this.myUsername!,
          to: this.selectedUser,
          kind: 'voice',
          mediaUrl: res.url,
          durationMs: this.previewDurationMs,
          timestamp: new Date().toISOString(),
          status: 'sent'
        };
        if (!this.privateChats[this.selectedUser]) this.privateChats[this.selectedUser] = [];
        this.appendUnique(this.privateChats[this.selectedUser], msg);
        this.socket.sendPrivateVoice(this.selectedUser, res.url, this.previewDurationMs, tempId);
      } else {
        this.socket.sendPublicVoice(res.url, this.previewDurationMs);
      }

      this.clearPreview();
      this.voicePreviewRef?.close();
    } catch (e) {
      console.error('Failed to upload/send voice', e);
    }
  }

  rerecord() {
    this.clearPreview();
    this.voicePreviewRef?.close();
    this.toggleRecording();
  }

  private clearPreview() {
    this.previewBlob = null;
    this.previewDurationMs = 0;
    this._revokePreviewUrl();
  }

  // ===== Navigation & dialogs =====
  backToPublic() {
    if (this.privateTypingActiveFor) {
      this.socket.typingPrivateStop(this.privateTypingActiveFor);
      this.privateTypingActiveFor = null;
    }
    this.selectedUser = null;
    this.message = '';
  }
  openDmFromSidebar(u: string) {
    if (!u) return;
    if (!this.users.includes(u)) this.users.unshift(u);
    if (!this.privateChats[u]) this.privateChats[u] = [];
    this.openChat(u);
  }
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

  // ===== Helpers =====
  get myUsername(): string | null { return this.auth.getUsername(); }
  get typingPublicList(): string[] { return Array.from(this.isTypingPublic); }

  lastText(u: string): string {
    const arr = this.privateChats[u] || [];
    if (!arr.length) return '';
    const last = arr[arr.length - 1];
    return last.kind === 'voice' ? '[Voice message]' : (last.text || '');
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
    this.users = this.users.filter(user => user !== u);
    if (this.selectedUser === u) this.selectedUser = null;
  }

  // ===== Internals =====
  private _stopPublicTypingIfActive() {
    if (this.publicTypingActive) {
      this.socket.typingPublicStop();
      this.publicTypingActive = false;
    }
  }
  private _stopAndReleaseStream() {
    try {
      const mr = this.mediaRecorder as any;
      const stream: MediaStream | undefined = mr?.stream;
      stream?.getTracks().forEach(t => t.stop());
    } catch {}
  }
  private _revokePreviewUrl() {
    if (this.previewUrl) {
      URL.revokeObjectURL(this.previewUrl);
      this.previewUrl = null;
    }
  }
}
