import { Component, ElementRef, HostListener, TemplateRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';

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
  readonly editWindowMs = 15 * 60 * 1000;

  // Data
  readonly messageReactions = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
  readonly composerEmojis = ['😀', '😁', '😂', '😊', '😍', '🤝', '👍', '🔥', '🎉', '💬'];
  messageSearchQuery = '';
  searchMatchIds: string[] = [];
  currentSearchMatchIndex = -1;
  publicMessages: ChatMessage[] = [];
  publicHasMore = true;
  publicLoading = false;
  privateChats: Record<string, ChatMessage[]> = {};
  users: string[] = [];
  onlineUsers: string[] = [];
  unreadCounts: Record<string, number> = {};
  pendingDeleteIds = new Set<string>();
  recentlyEditedIds = new Set<string>();

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
  private hasSocketConnected = false;

  // Filtering
  searchTerm = '';
  filteredOnlineUsers: string[] = [];

  // View state
  selectedUser: string | null = null;
  menuUser: string | null = null;
  menuPublicMessage: ChatMessage | null = null;
  showEmojiPicker = false;
  reactionPicker: { messageId: string; scope: 'public' | 'private' } | null = null;
  editingMessage: { id: string; scope: 'public' | 'private'; text: string } | null = null;
  replyingTo: {
    messageId: string;
    from: string;
    text: string;
    scope: 'public' | 'private';
    sourceScope: 'public' | 'private';
    privatePeer: string | null;
  } | null = null;

  private reactionPressTimer: ReturnType<typeof setTimeout> | null = null;
  private ignoreNextDocumentClick = false;
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private userChipStyleCache: Record<string, Record<string, string>> = {};
  searchOpen = false;

  // Dialog
  newUser = '';
  @ViewChild('startChatTpl') startChatTpl!: TemplateRef<any>;
  @ViewChild('confirmDeleteTpl') confirmDeleteTpl!: TemplateRef<any>;
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;
  deleteCandidate: { id: string; scope: 'public' | 'private'; preview: string } | null = null;

  constructor(
    private socket: SocketService,
    private auth: AuthService,
    private http: HttpClient,
    private router: Router,
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

    this.socket.onEvent('connect').subscribe(() => {
      if (!this.hasSocketConnected) {
        this.hasSocketConnected = true;
        return;
      }

      this.recoverMissedMessages();
      this.loadUnreadCounts();
    });

    // === PUBLIC ===
    this.socket.getMessages().subscribe((messages: ChatMessage[]) => {
      const m = messages[messages.length - 1];
      if (m) this.appendPublicMessage(this.normalizeMessage(m));
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
        ...this.normalizeMessage(m),
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

    this.socket.onEvent<{ scope: 'public' | 'private'; messageId: string; reactions: Array<{ emoji: string; users: string[] }> }>('messageReactionUpdated')
      .subscribe((payload) => {
        if (!payload?.messageId) return;
        this.applyReactionUpdate(payload.scope, payload.messageId, payload.reactions || []);
      });

    this.socket.onEvent<{ scope: 'public' | 'private'; messageId: string; text: string; editedAt: string }>('messageEdited')
      .subscribe((payload) => {
        if (!payload?.messageId) return;
        this.applyEditUpdate(payload.scope, payload.messageId, payload.text, payload.editedAt);
      });

    this.socket.onEvent<{ scope: 'public' | 'private'; messageId: string; deletedAt: string }>('messageDeleted')
      .subscribe((payload) => {
        if (!payload?.messageId) return;
        this.applyDeleteUpdate(payload.scope, payload.messageId, payload.deletedAt);
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
    this.cancelReactionPress();
    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
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
    const replyTo = this.activeReplyPayload('public');
    this.socket.sendPublicMessage(text, replyTo);
    this.message = '';
    this.replyingTo = null;
    this.showEmojiPicker = false;
    this.reactionPicker = null;
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
    if (this.replyingTo?.scope !== 'private' || this.replyingTo?.privatePeer !== username) this.replyingTo = null;
    this.unreadCounts[username] = 0;
    this.markAllAsRead(username);
    this.refreshSearchForCurrentContext();

    if (this.historyLoaded.has(username)) return;

    try {
      const token = this.auth.getToken()!;
      const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });

      const history = await this.http
        .get<ChatMessage[]>(`${environment.apiUrl}/api/private/${username}`, { headers })
        .toPromise();

      const loaded = (history || [])
        .map((m) => ({
          ...this.normalizeMessage(m),
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

    const replyTo = this.activeReplyPayload('private');

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const msg: ChatMessage = {
      id: tempId,
      from: this.myUsername!,
      to: this.selectedUser,
      text,
      replyTo,
      timestamp: new Date().toISOString(),
      status: 'sent',
      reactions: []
    };

    if (!this.privateChats[this.selectedUser]) this.privateChats[this.selectedUser] = [];
    this.privateChats[this.selectedUser].push(msg);

    this.socket.sendPrivateMessage(this.selectedUser, text, tempId, replyTo);
    this.message = '';
    this.replyingTo = null;
    this.showEmojiPicker = false;
    this.reactionPicker = null;

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
    this.replyingTo = null;
    this.message = '';
    this.showEmojiPicker = false;
    this.reactionPicker = null;
    this.refreshSearchForCurrentContext();
  }

  toggleEmojiPicker() {
    this.showEmojiPicker = !this.showEmojiPicker;
  }

  addEmoji(emoji: string) {
    this.message += emoji;
    if (this.selectedUser) {
      this.onPrivateInput();
    } else {
      this.onPublicInput();
    }
  }

  replyToMessage(message: ChatMessage, scope: 'public' | 'private') {
    if (!message?.id || message.id.startsWith('temp-') || message.deletedAt) return;

    this.replyingTo = {
      messageId: message.id,
      from: message.from,
      text: String(message.text || '').trim().slice(0, 160),
      scope,
      sourceScope: scope,
      privatePeer: scope === 'private' ? this.selectedUser : null
    };

    setTimeout(() => {
      const input = document.querySelector('.composer input') as HTMLInputElement | null;
      input?.focus();
    }, 0);
  }

  quickReplyFromMessage(message: ChatMessage, scope: 'public' | 'private', event?: Event) {
    if (!message?.id || message.id.startsWith('temp-') || message.deletedAt) return;
    if (message.from === this.myUsername) return;
    if (this.isEditingMessage(message, scope)) return;

    event?.stopPropagation();
    this.replyToMessage(message, scope);
  }

  clearReplyTarget() {
    this.replyingTo = null;
  }

  async jumpToReplyTarget(message: ChatMessage) {
    const targetId = message.replyTo?.messageId;
    if (!targetId) return;

    const targetScope = message.replyTo?.scope || 'private';
    if (targetScope === 'public') {
      if (this.selectedUser) this.backToPublic();
      await this.ensurePublicMessageLoaded(targetId);
      setTimeout(() => this.scrollToMessage(targetId), 50);
      return;
    }

    this.scrollToMessage(targetId);
  }

  replyAuthorLabel(from: string): string {
    if (!from) return 'Unknown';
    return from === this.myUsername ? 'You' : from;
  }

  replyPreviewText(text: string): string {
    const trimmed = String(text || '').trim();
    if (!trimmed) return 'Message unavailable';
    return trimmed.length > 70 ? `${trimmed.slice(0, 70)}...` : trimmed;
  }

  userChipStyle(username: string | null | undefined): Record<string, string> {
    const key = String(username || 'unknown');
    if (this.userChipStyleCache[key]) return this.userChipStyleCache[key];

    let hash = 0;
    for (let i = 0; i < key.length; i += 1) {
      hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    }

    const hue = hash % 360;
    const style = {
      color: `hsl(${hue}, 52%, 30%)`,
      background: `hsl(${hue}, 72%, 92%)`,
      border: `1px solid hsl(${hue}, 52%, 80%)`
    };

    this.userChipStyleCache[key] = style;
    return style;
  }

  startReactionPress(message: ChatMessage, scope: 'public' | 'private', event: Event) {
    if (!message?.id || message.id.startsWith('temp-') || message.deletedAt) return;
    if (this.isEditingMessage(message, scope)) return;

    const target = event.target as HTMLElement | null;
    if (target?.closest('.messageActions') || target?.closest('.editInline')) return;

    this.cancelReactionPress();
    this.reactionPressTimer = setTimeout(() => {
      this.reactionPicker = { messageId: message.id, scope };
      this.ignoreNextDocumentClick = true;
      event.preventDefault();
    }, 420);
  }

  cancelReactionPress() {
    if (!this.reactionPressTimer) return;
    clearTimeout(this.reactionPressTimer);
    this.reactionPressTimer = null;
  }

  isReactionPickerOpen(message: ChatMessage, scope: 'public' | 'private'): boolean {
    return this.reactionPicker?.messageId === message.id && this.reactionPicker?.scope === scope;
  }

  visibleReactions(message: ChatMessage): Array<{ emoji: string; users: string[] }> {
    if (message.deletedAt) return [];
    return (message.reactions || []).filter((r) => (r.users?.length || 0) > 0);
  }

  canManageMessage(message: ChatMessage): boolean {
    return message.from === this.myUsername && !message.deletedAt;
  }

  canEditMessage(message: ChatMessage): boolean {
    if (!this.canManageMessage(message) || !message.timestamp) return false;
    return Date.now() - new Date(message.timestamp).getTime() <= this.editWindowMs;
  }

  editMessage(message: ChatMessage, scope: 'public' | 'private') {
    if (!this.canEditMessage(message)) return;

    this.editingMessage = {
      id: message.id,
      scope,
      text: message.text || ''
    };
  }

  deleteMessage(message: ChatMessage, scope: 'public' | 'private') {
    if (!this.canManageMessage(message)) return;

    this.deleteCandidate = {
      id: message.id,
      scope,
      preview: (message.text || '').trim().slice(0, 120)
    };

    const ref = this.dialog.open(this.confirmDeleteTpl, {
      width: '360px',
      panelClass: 'confirmDeleteDialog'
    });

    ref.afterClosed().subscribe((confirmed: boolean) => {
      if (!confirmed || !this.deleteCandidate) {
        this.deleteCandidate = null;
        return;
      }

      this.socket.deleteMessage(this.deleteCandidate.scope, this.deleteCandidate.id);
      this.deleteCandidate = null;
    });
  }

  isPendingDelete(message: ChatMessage): boolean {
    return !!message?.id && this.pendingDeleteIds.has(message.id);
  }

  isEditingMessage(message: ChatMessage, scope: 'public' | 'private'): boolean {
    return this.editingMessage?.id === message.id && this.editingMessage?.scope === scope;
  }

  saveMessageEdit(message: ChatMessage, scope: 'public' | 'private') {
    if (!this.editingMessage || this.editingMessage.id !== message.id || this.editingMessage.scope !== scope) {
      return;
    }

    const nextText = this.editingMessage.text.trim();
    if (!nextText || nextText === (message.text || '').trim()) {
      this.cancelMessageEdit();
      return;
    }

    this.socket.editMessage(scope, message.id, nextText);
    this.editingMessage = null;
  }

  cancelMessageEdit() {
    this.editingMessage = null;
  }

  isRecentlyEdited(message: ChatMessage): boolean {
    return !!message?.id && this.recentlyEditedIds.has(message.id);
  }

  signOut() {
    this.socket.disconnect();
    this.auth.logout();
    this.router.navigate(['/login']);
  }

  toggleSearch() {
    this.searchOpen = !this.searchOpen;
    if (!this.searchOpen) {
      this.clearMessageSearch();
      return;
    }

    setTimeout(() => this.searchInput?.nativeElement.focus(), 0);
  }

  onMessageSearchInput() {
    if (!this.searchOpen) return;
    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);

    const q = this.messageSearchQuery.trim();
    if (!q) {
      this.searchMatchIds = [];
      this.currentSearchMatchIndex = -1;
      return;
    }

    this.searchDebounceTimer = setTimeout(() => {
      this.searchMessages(q);
    }, 220);
  }

  clearMessageSearch() {
    this.messageSearchQuery = '';
    this.searchMatchIds = [];
    this.currentSearchMatchIndex = -1;
  }

  nextSearchMatch() {
    if (!this.searchMatchIds.length) return;
    this.currentSearchMatchIndex = (this.currentSearchMatchIndex + 1) % this.searchMatchIds.length;
    this.scrollToMessage(this.searchMatchIds[this.currentSearchMatchIndex]);
  }

  prevSearchMatch() {
    if (!this.searchMatchIds.length) return;
    this.currentSearchMatchIndex = (this.currentSearchMatchIndex - 1 + this.searchMatchIds.length) % this.searchMatchIds.length;
    this.scrollToMessage(this.searchMatchIds[this.currentSearchMatchIndex]);
  }

  currentSearchPositionLabel(): string {
    if (!this.searchMatchIds.length || this.currentSearchMatchIndex < 0) return '0/0';
    return `${this.currentSearchMatchIndex + 1}/${this.searchMatchIds.length}`;
  }

  isCurrentSearchMatch(message: ChatMessage): boolean {
    if (!message?.id || this.currentSearchMatchIndex < 0) return false;
    return this.searchMatchIds[this.currentSearchMatchIndex] === message.id;
  }

  highlightText(text: string): string {
    const safe = this.escapeHtml(text || '');
    const q = this.messageSearchQuery.trim();
    if (q.length < 2) return safe;

    const re = new RegExp(this.escapeRegex(q), 'gi');
    return safe.replace(re, (m) => `<mark>${m}</mark>`);
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

  async startChatFromPublic(username: string | null, withReply = false) {
    if (!username || username === this.myUsername) return;
    const quoted = withReply ? this.menuPublicMessage : null;
    this.menuPublicMessage = null;

    if (!this.users.includes(username)) this.users.unshift(username);
    if (!this.privateChats[username]) this.privateChats[username] = [];
    await this.openChat(username);

    if (quoted?.id && !quoted.deletedAt) {
      this.replyingTo = {
        messageId: quoted.id,
        from: quoted.from,
        text: String(quoted.text || '').trim().slice(0, 160),
        scope: 'private',
        sourceScope: 'public',
        privatePeer: username
      };

      setTimeout(() => {
        const input = document.querySelector('.composer input') as HTMLInputElement | null;
        input?.focus();
      }, 0);
    }
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

  reactToMessage(message: ChatMessage, scope: 'public' | 'private') {
    if (!message?.id || message.id.startsWith('temp-')) return;
    if (!this.messageReactions.length) return;

    const emoji = this.messageReactions[0];
    this.socket.reactToMessage(scope, message.id, emoji);
  }

  toggleReaction(message: ChatMessage, scope: 'public' | 'private', emoji: string) {
    if (!message?.id || message.id.startsWith('temp-') || message.deletedAt) return;
    this.socket.reactToMessage(scope, message.id, emoji);
  }

  reactionCount(message: ChatMessage, emoji: string): number {
    const item = (message.reactions || []).find((r) => r.emoji === emoji);
    return item?.users?.length || 0;
  }

  hasReactionByMe(message: ChatMessage, emoji: string): boolean {
    const me = this.myUsername;
    if (!me) return false;
    const item = (message.reactions || []).find((r) => r.emoji === emoji);
    return !!item?.users?.includes(me);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event) {
    if (this.ignoreNextDocumentClick) {
      this.ignoreNextDocumentClick = false;
      return;
    }

    const target = event.target as HTMLElement | null;
    if (!target) return;

    if (!target.closest('.emojiPicker') && !target.closest('.emojiTrigger')) {
      this.showEmojiPicker = false;
    }

    if (!target.closest('.reactionPicker')) {
      this.reactionPicker = null;
    }

    if (
      this.searchOpen &&
      !target.closest('.searchShell')
    ) {
      this.searchOpen = false;
      this.clearMessageSearch();
    }
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
          const normalizedPage = page.map((m) => this.normalizeMessage(m));

          if (before) {
            this.publicMessages = this.mergePublicMessages(normalizedPage, this.publicMessages);
          } else {
            this.publicMessages = this.mergePublicMessages(this.publicMessages, normalizedPage);
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

  private normalizeMessage(message: ChatMessage): ChatMessage {
    return {
      ...message,
      replyTo: message.replyTo?.messageId
        ? {
          messageId: message.replyTo.messageId,
          from: message.replyTo.from || '',
          text: String(message.replyTo.text || '').trim().slice(0, 160),
          scope: message.replyTo.scope || 'private'
        }
        : null,
      editedAt: message.editedAt || null,
      deletedAt: message.deletedAt || null,
      reactions: (message.reactions || []).map((r) => ({
        emoji: r.emoji,
        users: Array.from(new Set(r.users || []))
      }))
    };
  }

  private applyReactionUpdate(
    scope: 'public' | 'private',
    messageId: string,
    reactions: Array<{ emoji: string; users: string[] }>
  ) {
    const normalized = (reactions || []).map((r) => ({
      emoji: r.emoji,
      users: Array.from(new Set(r.users || []))
    }));

    if (scope === 'public') {
      this.publicMessages = this.publicMessages.map((msg) =>
        msg.id === messageId ? { ...msg, reactions: normalized } : msg
      );
      return;
    }

    Object.keys(this.privateChats).forEach((user) => {
      this.privateChats[user] = (this.privateChats[user] || []).map((msg) =>
        msg.id === messageId ? { ...msg, reactions: normalized } : msg
      );
    });
  }

  private applyEditUpdate(scope: 'public' | 'private', messageId: string, text: string, editedAt: string) {
    const patch = (msg: ChatMessage): ChatMessage => {
      if (msg.id !== messageId) return msg;
      this.flagEditedAnimation(messageId);
      return { ...msg, text, editedAt };
    };

    if (scope === 'public') {
      this.publicMessages = this.publicMessages.map(patch);
      if (this.editingMessage?.id === messageId && this.editingMessage.scope === 'public') {
        this.editingMessage = null;
      }
      return;
    }

    Object.keys(this.privateChats).forEach((user) => {
      this.privateChats[user] = (this.privateChats[user] || []).map(patch);
    });

    if (this.editingMessage?.id === messageId && this.editingMessage.scope === 'private') {
      this.editingMessage = null;
    }
  }

  private applyDeleteUpdate(scope: 'public' | 'private', messageId: string, deletedAt: string) {
    this.pendingDeleteIds.add(messageId);
    if (this.reactionPicker?.messageId === messageId) this.reactionPicker = null;
    if (this.replyingTo?.messageId === messageId && this.replyingTo.scope === scope) {
      this.replyingTo = null;
    }

    setTimeout(() => {
      const patch = (msg: ChatMessage): ChatMessage => {
        if (msg.id !== messageId) return msg;
        return {
          ...msg,
          text: '',
          reactions: [],
          deletedAt,
          editedAt: msg.editedAt || null
        };
      };

      if (scope === 'public') {
        this.publicMessages = this.publicMessages.map(patch);
      } else {
        Object.keys(this.privateChats).forEach((user) => {
          this.privateChats[user] = (this.privateChats[user] || []).map(patch);
        });
      }

      this.pendingDeleteIds.delete(messageId);
    }, 260);
  }

  private flagEditedAnimation(messageId: string) {
    this.recentlyEditedIds.add(messageId);
    setTimeout(() => this.recentlyEditedIds.delete(messageId), 1100);
  }

  private recoverMissedMessages() {
    this.recoverPublicMessages();

    Array.from(this.historyLoaded).forEach((username) => {
      this.recoverPrivateMessages(username);
    });
  }

  private recoverPublicMessages() {
    const since = this.publicMessages[this.publicMessages.length - 1]?.timestamp;
    if (!since) {
      this.loadPublicMessages();
      return;
    }

    const headers = this.getAuthHeaders();
    if (!headers) return;

    const params = new URLSearchParams();
    params.set('since', since);

    this.http
      .get<{ messages: ChatMessage[] }>(`${environment.apiUrl}/api/public?${params.toString()}`, { headers })
      .subscribe({
        next: (res) => {
          const incoming = res?.messages || [];
          this.publicMessages = this.mergePublicMessages(
            this.publicMessages,
            incoming.map((m) => this.normalizeMessage(m))
          );
        },
        error: () => {}
      });
  }

  private recoverPrivateMessages(username: string) {
    const arr = this.privateChats[username] || [];
    const since = arr[arr.length - 1]?.timestamp;

    const headers = this.getAuthHeaders();
    if (!headers) return;

    const params = new URLSearchParams();
    if (since) params.set('since', since);
    const query = params.toString();
    const url = query
      ? `${environment.apiUrl}/api/private/${username}?${query}`
      : `${environment.apiUrl}/api/private/${username}`;

    this.http
      .get<ChatMessage[]>(url, { headers })
      .subscribe({
        next: (incoming) => {
          const merged = new Map<string, ChatMessage>();
          [...arr, ...((incoming || []).map((m) => this.normalizeMessage(m)))].forEach((m) => {
            const key = m.id || `${m.from}|${m.to}|${m.timestamp}|${m.text}`;
            merged.set(key, m);
          });

          this.privateChats[username] = Array.from(merged.values()).sort(
            (a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime()
          );

          if (!this.users.includes(username)) this.users.unshift(username);
        },
        error: () => {}
      });
  }

  private getAuthHeaders(): HttpHeaders | null {
    const token = this.auth.getToken();
    if (!token) return null;

    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  private searchMessages(query: string) {
    const q = query.toLowerCase();
    this.searchMatchIds = this.currentThread()
      .filter((m) => !!m.id)
      .filter((m) => String(m.text ?? '').toLowerCase().includes(q))
      .map((m) => m.id);

    if (!this.searchMatchIds.length) {
      this.currentSearchMatchIndex = -1;
      return;
    }

    this.currentSearchMatchIndex = 0;
    this.scrollToMessage(this.searchMatchIds[0]);
  }

  private refreshSearchForCurrentContext() {
    if (!this.searchOpen) return;
    const q = this.messageSearchQuery.trim();
    if (!q) {
      this.searchMatchIds = [];
      this.currentSearchMatchIndex = -1;
      return;
    }

    this.searchMessages(q);
  }

  private scrollToMessage(messageId: string) {
    const container = document.querySelector('.messages') as HTMLElement | null;
    if (!container) return;

    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(messageId) : messageId;
    const el = container.querySelector(`[data-msg-id="${escaped}"]`) as HTMLElement | null;
    if (!el) return;

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('jumpFlash');
    setTimeout(() => el.classList.remove('jumpFlash'), 1000);
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private activeReplyPayload(scope: 'public' | 'private') {
    if (!this.replyingTo || this.replyingTo.scope !== scope) return null;
    if (scope === 'private' && this.replyingTo.privatePeer !== this.selectedUser) return null;
    return {
      messageId: this.replyingTo.messageId,
      from: this.replyingTo.from,
      text: String(this.replyingTo.text || '').trim().slice(0, 160),
      scope: this.replyingTo.sourceScope
    };
  }

  private async ensurePublicMessageLoaded(messageId: string) {
    if (this.publicMessages.some((m) => m.id === messageId)) return;

    const headers = this.getAuthHeaders();
    if (!headers) return;

    try {
      const found = await this.http
        .get<ChatMessage>(`${environment.apiUrl}/api/public/${messageId}`, { headers })
        .toPromise();

      if (!found) return;
      this.publicMessages = this.mergePublicMessages(this.publicMessages, [this.normalizeMessage(found)]);
    } catch {
      // no-op
    }
  }
}
