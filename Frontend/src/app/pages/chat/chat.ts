import { AfterViewChecked, Component, ElementRef, HostListener, TemplateRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpEventType, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';

import { SocketService } from '../../services/socket';
import { AuthService } from '../../services/auth';
import { environment } from '../../../environments/environment';
import { Attachment, ChatMessage } from '../../models/message.model';

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

const DRAFTS_STORAGE_KEY = 'chatroom:composerDrafts';

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
export class ChatComponent implements AfterViewChecked {
  // Composer
  message = '';
  pendingAttachments: Attachment[] = [];
  uploadingAttachment = false;
  uploadingAttachmentCount = 0;
  uploadErrors: string[] = [];
  uploadProgressItems: Array<{
    id: string;
    name: string;
    progress: number;
    status: 'uploading' | 'done' | 'failed' | 'cancelled';
    file: File;
    error?: string;
  }> = [];
  cancelUploadRequested = false;
  showPendingAttachmentsPanel = false;
  showUploadQueuePanel = false;
  uploadPolicy: { maxBytes: number; allowedMimePatterns: string[] } | null = null;
  hourglassTop = true;
  private hourglassTimer: ReturnType<typeof setInterval> | null = null;
  isDragAttachActive = false;
  private dragAttachDepth = 0;
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
  unreadMarkerByUser: Record<string, string> = {};
  pendingDeleteIds = new Set<string>();
  recentlyEditedIds = new Set<string>();
  draftsByContext: Record<string, string> = {};

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
    attachment: Attachment | null;
    scope: 'public' | 'private';
    sourceScope: 'public' | 'private';
    privatePeer: string | null;
  } | null = null;
  forwardCandidate: {
    messageId: string;
    from: string;
    text: string;
    scope: 'public' | 'private';
    attachment: Attachment | null;
  } | null = null;
  forwardSelectedUsers: string[] = [];
  forwardSearchTerm = '';
  forwardNote = '';

  private reactionPressTimer: ReturnType<typeof setTimeout> | null = null;
  private ignoreNextDocumentClick = false;
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private userChipStyleCache: Record<string, Record<string, string>> = {};
  searchOpen = false;

  // Dialog
  newUser = '';
  @ViewChild('startChatTpl') startChatTpl!: TemplateRef<any>;
  @ViewChild('confirmDeleteTpl') confirmDeleteTpl!: TemplateRef<any>;
  @ViewChild('forwardTpl') forwardTpl!: TemplateRef<any>;
  @ViewChild('imageViewerTpl') imageViewerTpl!: TemplateRef<any>;
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('attachmentInput') attachmentInput?: ElementRef<HTMLInputElement>;
  deleteCandidate: { id: string; scope: 'public' | 'private'; preview: string } | null = null;
  imageViewerTarget: {
    message: ChatMessage;
    scope: 'public' | 'private';
    media: Attachment[];
    index: number;
  } | null = null;
  attachmentMenuTarget: ChatMessage['attachment'] | null = null;
  viewerNotice = '';
  private pausedPreviewVideoKey: string | null = null;
  private lastPreviewKickAt = 0;
  private hiddenAttachmentPreviewKeys = new Set<string>();
  private temporaryExpandedAlbumKeys = new Set<string>();
  private albumCollapseTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
    this.loadUploadPolicy();
    this.loadDraftsFromStorage();
    this.message = this.draftForContext(null);
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
      if (m) {
        const normalized = this.normalizeMessage(m);
        this.appendPublicMessage(normalized);
        this.scheduleMediaAlbumCollapse(normalized, 'public');
      }
    });

    // === PRIVATE (incoming only; your own sends use privateAck) ===
    this.socket.getPrivateMessages().subscribe((messages: ChatMessage[]) => {
      const m = messages[messages.length - 1];
      if (!m) return;

      const me = this.myUsername;
      const other = m.from === me ? m.to! : m.from;
      if (!other) return;

      if (!this.privateChats[other]) this.privateChats[other] = [];
      const normalized = {
        ...this.normalizeMessage(m),
        status: (m.from === me ? 'sent' : m.status) as ChatMessage['status']
      };
      this.privateChats[other].push(normalized);
      this.scheduleMediaAlbumCollapse(normalized, 'private');

      if (!this.users.includes(other)) this.users.unshift(other);

      // Instant read if I'm viewing this thread and msg is from the other user
      if (m.from !== me && this.selectedUser === other && m.id) {
        this.socket.emitEvent('markAsRead', { id: m.id, from: m.from });
        this.updateMessageStatus(other, m.id, 'read');
      } else if (m.from !== me) {
        this.unreadCounts[other] = (this.unreadCounts[other] || 0) + 1;
        if (m.id && !this.unreadMarkerByUser[other]) {
          this.unreadMarkerByUser[other] = m.id;
        }
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
    this.albumCollapseTimers.forEach((t) => clearTimeout(t));
    this.albumCollapseTimers.clear();
    this.stopHourglassAnimation();
  }

  ngAfterViewChecked() {
    const now = Date.now();
    if (now - this.lastPreviewKickAt < 1200) return;
    this.lastPreviewKickAt = now;
    this.ensurePreviewVideosPlaying();
  }

  // ===== Public Chat =====
  sendPublic() {
    const text = this.message.trim();
    const attachments = this.pendingAttachments.slice();
    if (!text && !attachments.length) return;
    const replyTo = this.activeReplyPayload('public');
    this.socket.sendPublicMessage(text, replyTo, attachments);
    this.message = '';
    this.clearPendingAttachments();
    this.clearDraftForContext(null);
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
    this.saveDraftForContext(null, this.message);

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
    this.saveDraftForContext(this.selectedUser, this.message);
    this.clearPendingAttachments();
    const hadUnread = this.unreadCount(username) > 0;

    // switching views → stop public typing if active
    this._stopPublicTypingIfActive();

    // switching threads → stop previous private typing if active
    if (this.privateTypingActiveFor && this.privateTypingActiveFor !== username) {
      this.socket.typingPrivateStop(this.privateTypingActiveFor);
      this.privateTypingActiveFor = null;
    }

    this.selectedUser = username;
    this.message = this.draftForContext(username);
    if (this.replyingTo?.scope !== 'private' || this.replyingTo?.privatePeer !== username) this.replyingTo = null;
    this.refreshSearchForCurrentContext();

    if (!this.historyLoaded.has(username)) {
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

    const markerId = hadUnread
      ? (this.unreadMarkerByUser[username] || this.firstUnreadMessageId(username))
      : null;
    if (markerId) this.unreadMarkerByUser[username] = markerId;

    this.unreadCounts[username] = 0;
    this.markAllAsRead(username);

    if (markerId) {
      setTimeout(() => this.scrollToMessage(markerId), 60);
    }

    if (this.selectedUser === username) {
      setTimeout(() => {
        if (this.selectedUser === username) this.clearUnreadMarker(username);
      }, 8000);
    }
  }

  // Called on <input> for PRIVATE view
  onPrivateInput() {
    if (!this.selectedUser) return;
    this.saveDraftForContext(this.selectedUser, this.message);

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
    const attachments = this.pendingAttachments.slice();
    if ((!text && !attachments.length) || !this.selectedUser) return;

    const replyTo = this.activeReplyPayload('private');
    const forwardedFrom = null;

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const msg: ChatMessage = {
      id: tempId,
      from: this.myUsername!,
      to: this.selectedUser,
      text,
      replyTo,
      forwardedFrom,
      attachment: attachments[0] || null,
      attachments,
      timestamp: new Date().toISOString(),
      status: 'sent',
      reactions: []
    };

    if (!this.privateChats[this.selectedUser]) this.privateChats[this.selectedUser] = [];
    this.privateChats[this.selectedUser].push(msg);
    this.scheduleMediaAlbumCollapse(msg, 'private');

    this.socket.sendPrivateMessage(this.selectedUser, text, tempId, replyTo, forwardedFrom, attachments);
    this.message = '';
    this.clearPendingAttachments();
    this.clearDraftForContext(this.selectedUser);
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

    this.saveDraftForContext(this.selectedUser, this.message);
    this.clearTypingIdleTimer();
    this.selectedUser = null;
    this.replyingTo = null;
    this.clearPendingAttachments();
    this.message = this.draftForContext(null);
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

  openAttachmentPicker() {
    if (this.uploadingAttachment) return;
    this.attachmentInput?.nativeElement?.click();
  }

  onAttachmentSelected(event: Event) {
    const input = event.target as HTMLInputElement | null;
    const files = Array.from(input?.files || []);
    if (!files.length) return;
    this.uploadAttachmentFiles(files, input);
  }

  onComposerDragEnter(event: DragEvent) {
    if (!this.hasDraggedFiles(event)) return;
    event.preventDefault();
    this.dragAttachDepth += 1;
    this.isDragAttachActive = true;
  }

  onComposerDragOver(event: DragEvent) {
    if (!this.hasDraggedFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  onComposerDragLeave(event: DragEvent) {
    if (!this.hasDraggedFiles(event)) return;
    event.preventDefault();
    this.dragAttachDepth = Math.max(0, this.dragAttachDepth - 1);
    if (this.dragAttachDepth === 0) this.isDragAttachActive = false;
  }

  onComposerDrop(event: DragEvent) {
    if (!this.hasDraggedFiles(event)) return;
    event.preventDefault();

    this.dragAttachDepth = 0;
    this.isDragAttachActive = false;

    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;
    this.uploadAttachmentFiles(files);
  }

  private async uploadAttachmentFiles(files: File[], inputToClear?: HTMLInputElement | null) {
    const headers = this.getAuthHeaders();
    if (!headers) {
      this.pushUploadError('You are not authenticated. Please sign in again and retry.');
      if (inputToClear) inputToClear.value = '';
      return;
    }

    const eligibleFiles = files.filter((file) => this.validateUploadFile(file));
    if (!eligibleFiles.length) {
      if (inputToClear) inputToClear.value = '';
      return;
    }

    this.cancelUploadRequested = false;
    this.uploadingAttachment = true;
    this.uploadingAttachmentCount = eligibleFiles.length;
    this.startHourglassAnimation();

    for (const file of eligibleFiles) {
      if (this.cancelUploadRequested) break;

      const itemId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const item = {
        id: itemId,
        name: file.name,
        progress: 0,
        status: 'uploading' as const,
        file,
        error: ''
      };
      this.uploadProgressItems.unshift(item);

      try {
        const durationSeconds = await this.extractVideoDurationSeconds(file);
        const uploaded = await this.uploadSingleAttachment(file, headers, itemId, durationSeconds);

        if (uploaded?.url) {
          this.pendingAttachments.push({
              url: uploaded.url,
              name: uploaded.name || file.name,
              mimeType: uploaded.mimeType || file.type || 'application/octet-stream',
              size: Number(uploaded.size || file.size || 0),
              isImage: !!uploaded.isImage,
              durationSeconds: Number(uploaded.durationSeconds || durationSeconds || 0) || undefined,
              storageProvider: uploaded.storageProvider,
              objectKey: uploaded.objectKey
            });
          this.setUploadItemStatus(itemId, 'done', '');
        }
      } catch (error) {
        const reason = this.uploadFailureReason(error, file);
        this.pushUploadError(reason);
        this.setUploadItemStatus(itemId, 'failed', reason);
      } finally {
        this.uploadingAttachmentCount = Math.max(0, this.uploadingAttachmentCount - 1);
      }
    }

    if (this.cancelUploadRequested) {
      this.uploadProgressItems
        .filter((x) => x.status === 'uploading')
        .forEach((x) => {
          x.status = 'cancelled';
          x.error = 'Cancelled';
        });
    }

    this.uploadingAttachment = false;
    this.stopHourglassAnimation();
    if (inputToClear) inputToClear.value = '';
  }

  retryFailedUploads() {
    const failedFiles = this.uploadProgressItems
      .filter((x) => x.status === 'failed')
      .map((x) => x.file);
    if (!failedFiles.length || this.uploadingAttachment) return;
    this.uploadAttachmentFiles(failedFiles);
  }

  cancelAttachmentUploads() {
    this.cancelUploadRequested = true;
  }

  private uploadSingleAttachment(file: File, headers: HttpHeaders, itemId: string, durationSeconds?: number | null): Promise<Attachment> {
    const formData = new FormData();
    formData.append('file', file);
    if (Number(durationSeconds) > 0) {
      formData.append('durationSeconds', String(Math.round(Number(durationSeconds))));
    }

    return new Promise((resolve, reject) => {
      const sub = this.http.post<Attachment>(`${environment.apiUrl}/api/upload`, formData, {
        headers,
        reportProgress: true,
        observe: 'events'
      }).subscribe({
        next: (event) => {
          if (event.type === HttpEventType.UploadProgress) {
            const total = Number(event.total || 0);
            const progress = total > 0 ? Math.round((event.loaded / total) * 100) : 0;
            this.setUploadItemProgress(itemId, progress);
            if (this.cancelUploadRequested) {
              sub.unsubscribe();
              reject(new Error('cancelled'));
            }
          }

          if (event.type === HttpEventType.Response) {
            this.setUploadItemProgress(itemId, 100);
            resolve(event.body as Attachment);
          }
        },
        error: (err) => reject(err)
      });
    });
  }

  private extractVideoDurationSeconds(file: File): Promise<number | null> {
    if (!file.type.startsWith('video/')) return Promise.resolve(null);

    return new Promise((resolve) => {
      const media = document.createElement('video');
      const objectUrl = URL.createObjectURL(file);
      const cleanup = () => {
        URL.revokeObjectURL(objectUrl);
        media.removeAttribute('src');
        media.load();
      };

      media.preload = 'metadata';
      media.onloadedmetadata = () => {
        const value = Number(media.duration);
        cleanup();
        if (!Number.isFinite(value) || value <= 0) {
          resolve(null);
          return;
        }
        resolve(Math.round(value));
      };
      media.onerror = () => {
        cleanup();
        resolve(null);
      };
      media.src = objectUrl;
    });
  }

  private setUploadItemProgress(itemId: string, progress: number) {
    const item = this.uploadProgressItems.find((x) => x.id === itemId);
    if (!item) return;
    item.progress = Math.max(0, Math.min(100, progress));
  }

  private setUploadItemStatus(itemId: string, status: 'done' | 'failed' | 'cancelled', error: string) {
    const item = this.uploadProgressItems.find((x) => x.id === itemId);
    if (!item) return;
    item.status = status;
    item.error = error;

    if (status === 'done') {
      setTimeout(() => {
        this.uploadProgressItems = this.uploadProgressItems.filter((x) => x.id !== itemId);
      }, 900);
    }

    if (this.uploadProgressItems.length > 12) {
      this.uploadProgressItems = this.uploadProgressItems.slice(0, 12);
    }
  }

  private hasDraggedFiles(event: DragEvent): boolean {
    const types = event.dataTransfer?.types;
    if (!types) return false;
    return Array.from(types).includes('Files');
  }

  clearPendingAttachments() {
    this.pendingAttachments = [];
    this.showPendingAttachmentsPanel = false;
    const input = this.attachmentInput?.nativeElement;
    if (input) input.value = '';
  }

  removePendingAttachment(index: number) {
    if (index < 0 || index >= this.pendingAttachments.length) return;
    this.pendingAttachments.splice(index, 1);
    if (!this.pendingAttachments.length) this.showPendingAttachmentsPanel = false;
  }

  visibleUploadItems() {
    return this.uploadProgressItems.filter((x) => x.status !== 'done');
  }

  failedUploadItems() {
    return this.uploadProgressItems.filter((x) => x.status === 'failed');
  }

  uploadingItems() {
    return this.uploadProgressItems.filter((x) => x.status === 'uploading');
  }

  compactPendingTitle(): string {
    const count = this.pendingAttachments.length;
    if (!count) return 'No attachments';
    return `${count} attachment${count === 1 ? '' : 's'} ready`;
  }

  compactQueueTitle(): string {
    const uploading = this.uploadingItems().length;
    const failed = this.failedUploadItems().length;
    if (uploading) return `Uploading ${uploading} file${uploading === 1 ? '' : 's'}`;
    if (failed) return `${failed} failed upload${failed === 1 ? '' : 's'}`;
    return 'Upload queue';
  }

  clearUploadErrors() {
    this.uploadErrors = [];
  }

  private pushUploadError(message: string) {
    this.uploadErrors = [message, ...this.uploadErrors].slice(0, 4);
  }

  private uploadFailureReason(error: any, file: File): string {
    const serverMessage = String(error?.error?.error || '').trim();
    if (serverMessage) return `${file.name}: ${serverMessage}`;

    if (Number(error?.status) === 413) {
      return `${file.name}: file is too large.`;
    }

    return `${file.name}: upload failed. Please retry.`;
  }

  private startHourglassAnimation() {
    if (this.hourglassTimer) return;
    this.hourglassTimer = setInterval(() => {
      this.hourglassTop = !this.hourglassTop;
    }, 450);
  }

  private stopHourglassAnimation() {
    if (this.hourglassTimer) {
      clearInterval(this.hourglassTimer);
      this.hourglassTimer = null;
    }
    this.hourglassTop = true;
  }

  private loadUploadPolicy() {
    const headers = this.getAuthHeaders();
    if (!headers) return;

    this.http
      .get<{ maxBytes: number; allowedMimePatterns: string[] }>(`${environment.apiUrl}/api/upload/policy`, { headers })
      .subscribe({
        next: (policy) => {
          if (!policy) return;
          this.uploadPolicy = {
            maxBytes: Number(policy.maxBytes || 0),
            allowedMimePatterns: Array.isArray(policy.allowedMimePatterns) ? policy.allowedMimePatterns : []
          };
        },
        error: () => {
          this.uploadPolicy = null;
        }
      });
  }

  private validateUploadFile(file: File): boolean {
    const policy = this.uploadPolicy;
    if (!policy) return true;

    const size = Number(file.size || 0);
    if (policy.maxBytes > 0 && size > policy.maxBytes) {
      this.pushUploadError(`${file.name}: file exceeds max size of ${this.attachmentSizeLabel(policy.maxBytes)}.`);
      return false;
    }

    const mime = String(file.type || '').trim();
    if (mime && policy.allowedMimePatterns.length) {
      const allowed = policy.allowedMimePatterns.some((source) => {
        try {
          return new RegExp(source).test(mime);
        } catch {
          return false;
        }
      });

      if (!allowed) {
        this.pushUploadError(`${file.name}: unsupported type (${mime}).`);
        return false;
      }
    }

    return true;
  }

  replyToMessage(message: ChatMessage, scope: 'public' | 'private') {
    if (!message?.id || message.id.startsWith('temp-') || message.deletedAt) return;

    this.replyingTo = {
      messageId: message.id,
      from: message.from,
      text: this.messageReplySeedText(message),
      attachment: this.messageAttachments(message)[0] || null,
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

  openForwardDialog(message: ChatMessage, scope: 'public' | 'private') {
    if (!message?.id || message.id.startsWith('temp-') || message.deletedAt) return;

    this.forwardCandidate = {
      messageId: message.id,
      from: message.from,
      text: String(message.text || '').trim().slice(0, 160),
      scope,
      attachment: this.messageAttachments(message)[0] || null
    };
    this.forwardSelectedUsers = this.selectedUser ? [this.selectedUser] : [];
    this.forwardSearchTerm = '';
    this.forwardNote = '';

    const ref = this.dialog.open(this.forwardTpl, {
      width: '420px'
    });

    ref.afterClosed().subscribe(() => {
      this.forwardCandidate = null;
      this.forwardSelectedUsers = [];
      this.forwardSearchTerm = '';
      this.forwardNote = '';
    });
  }

  async confirmForward(dialogRef: MatDialogRef<any>) {
    const candidate = this.forwardCandidate;
    const recipients = this.forwardRecipients();
    if (!candidate || !recipients.length) return;

    const note = (this.forwardNote || '').trim();
    const text = note || 'Forwarded message';

    recipients.forEach((to) => {
      if (!this.users.includes(to)) this.users.unshift(to);
      if (!this.privateChats[to]) this.privateChats[to] = [];

      const tempId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      const msg: ChatMessage = {
        id: tempId,
        from: this.myUsername!,
        to,
        text,
        timestamp: new Date().toISOString(),
        status: 'sent',
        reactions: [],
        forwardedFrom: {
          messageId: candidate.messageId,
          from: candidate.from,
          text: candidate.text,
          scope: candidate.scope,
          attachment: candidate.attachment
        }
      };

      this.privateChats[to].push(msg);
      this.scheduleMediaAlbumCollapse(msg, 'private');

      this.socket.sendPrivateMessage(to, text, tempId, null, {
        messageId: candidate.messageId,
        from: candidate.from,
        text: candidate.text,
        scope: candidate.scope,
        attachment: candidate.attachment
      });
    });

    if (recipients.length === 1) {
      await this.openChat(recipients[0]);
    }

    this.forwardCandidate = null;
    this.forwardSelectedUsers = [];
    this.forwardSearchTerm = '';
    this.forwardNote = '';
    dialogRef.close();
  }

  forwardRecipientOptions(): string[] {
    const me = this.myUsername;
    const merged = new Set<string>([...this.users, ...this.onlineUsers]);
    const term = this.forwardSearchTerm.trim().toLowerCase();

    return Array.from(merged)
      .filter((u) => !!u && u !== me)
      .filter((u) => !term || u.toLowerCase().includes(term))
      .sort((a, b) => a.localeCompare(b));
  }

  forwardRecipientsLabel(): string {
    const count = this.forwardRecipients().length;
    if (!count) return 'No recipients selected';
    return `${count} recipient${count === 1 ? '' : 's'} selected`;
  }

  private forwardRecipients(): string[] {
    const me = this.myUsername;
    return Array.from(new Set((this.forwardSelectedUsers || []).map((u) => String(u || '').trim())))
      .filter((u) => !!u && u !== me);
  }

  async jumpToReplyTarget(message: ChatMessage) {
    await this.jumpToReference(message.replyTo || null);
  }

  async jumpToForwardTarget(message: ChatMessage) {
    await this.jumpToReference(message.forwardedFrom || null);
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

  attachmentUrl(attachment: ChatMessage['attachment']): string {
    if (!attachment?.url) return '';
    if (/^https?:\/\//i.test(attachment.url)) return attachment.url;
    return `${environment.apiUrl}${attachment.url}`;
  }

  messageAttachments(message: ChatMessage): Attachment[] {
    const fromArray = Array.isArray(message.attachments) ? message.attachments : [];
    const list = fromArray.length ? fromArray : (message.attachment ? [message.attachment] : []);
    if (list.length < 2) return list;

    const media = list.filter((a) => this.canPreviewMediaAttachment(a));
    const other = list.filter((a) => !this.canPreviewMediaAttachment(a));
    return [...media, ...other];
  }

  attachmentSizeLabel(size: number | null | undefined): string {
    const value = Number(size || 0);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  formatDuration(totalSeconds: number | null | undefined): string {
    const value = Math.floor(Number(totalSeconds || 0));
    if (!Number.isFinite(value) || value <= 0) return '0:00';
    const mins = Math.floor(value / 60);
    const secs = value % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  attachmentDurationLabel(attachment: ChatMessage['attachment']): string {
    return this.formatDuration(attachment?.durationSeconds);
  }

  googleImageSearchUrl(attachment: ChatMessage['attachment']): string {
    const imageUrl = this.attachmentUrl(attachment);
    if (!imageUrl) return 'https://images.google.com/';
    return `https://www.google.com/searchbyimage?image_url=${encodeURIComponent(imageUrl)}`;
  }

  isAudioAttachment(attachment: ChatMessage['attachment']): boolean {
    return !!attachment?.mimeType?.startsWith('audio/');
  }

  isVideoAttachment(attachment: ChatMessage['attachment']): boolean {
    return !!attachment?.mimeType?.startsWith('video/');
  }

  isTextAttachment(attachment: ChatMessage['attachment']): boolean {
    return !!attachment?.mimeType?.startsWith('text/');
  }

  isDocAttachment(attachment: ChatMessage['attachment']): boolean {
    const mime = String(attachment?.mimeType || '').toLowerCase();
    return mime.includes('msword') || mime.includes('officedocument') || mime.includes('application/pdf');
  }

  attachmentTypeLabel(attachment: ChatMessage['attachment']): string {
    const mime = String(attachment?.mimeType || '').toLowerCase();
    if (!mime) return 'File';
    if (mime.startsWith('audio/')) return mime.replace('audio/', '').toUpperCase();
    if (mime.startsWith('image/')) return mime.replace('image/', '').toUpperCase();
    if (mime === 'application/pdf') return 'PDF';
    if (mime.includes('msword')) return 'DOC';
    if (mime.includes('officedocument.wordprocessingml.document')) return 'DOCX';
    if (mime === 'text/plain') return 'TXT';
    if (mime === 'text/csv') return 'CSV';
    if (mime === 'application/vnd.ms-excel') return 'XLS';
    if (mime.includes('spreadsheetml')) return 'XLSX';
    if (mime.includes('presentationml')) return 'PPTX';
    if (mime.startsWith('text/')) return mime.replace('text/', '').toUpperCase();
    return mime.split('/').pop()?.toUpperCase() || 'File';
  }

  canOpenInGoogleDocs(attachment: ChatMessage['attachment']): boolean {
    const mime = String(attachment?.mimeType || '').toLowerCase();
    return (
      mime === 'application/pdf' ||
      mime === 'text/plain' ||
      mime === 'text/csv' ||
      mime.includes('msword') ||
      mime.includes('officedocument.wordprocessingml.document') ||
      mime === 'application/vnd.ms-excel' ||
      mime.includes('spreadsheetml') ||
      mime.includes('presentationml')
    );
  }

  googleDocsViewerUrl(attachment: ChatMessage['attachment']): string {
    const url = this.attachmentUrl(attachment);
    if (!url) return 'https://docs.google.com/';
    return `https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`;
  }

  openAttachmentMenuFor(attachment: ChatMessage['attachment']) {
    this.attachmentMenuTarget = attachment || null;
  }

  canSearchByImage(attachment: ChatMessage['attachment']): boolean {
    return !!attachment?.isImage;
  }

  viewerCurrentAttachment(): Attachment | null {
    const v = this.imageViewerTarget;
    if (!v) return null;
    return v.media[v.index] || null;
  }

  viewerHasPrev(): boolean {
    const v = this.imageViewerTarget;
    return !!v && v.index > 0;
  }

  viewerHasNext(): boolean {
    const v = this.imageViewerTarget;
    return !!v && v.index < v.media.length - 1;
  }

  viewerPrev() {
    if (!this.imageViewerTarget || !this.viewerHasPrev()) return;
    this.imageViewerTarget = {
      ...this.imageViewerTarget,
      index: this.imageViewerTarget.index - 1,
      message: { ...this.imageViewerTarget.message, attachment: this.imageViewerTarget.media[this.imageViewerTarget.index - 1] }
    };
  }

  viewerNext() {
    if (!this.imageViewerTarget || !this.viewerHasNext()) return;
    this.imageViewerTarget = {
      ...this.imageViewerTarget,
      index: this.imageViewerTarget.index + 1,
      message: { ...this.imageViewerTarget.message, attachment: this.imageViewerTarget.media[this.imageViewerTarget.index + 1] }
    };
  }

  albumMediaAttachments(message: ChatMessage): Attachment[] {
    return this.messageAttachments(message).filter((a) => this.canPreviewMediaAttachment(a));
  }

  nonAlbumAttachments(message: ChatMessage): Attachment[] {
    return this.messageAttachments(message).filter((a) => !this.canPreviewMediaAttachment(a));
  }

  hasAlbumMedia(message: ChatMessage): boolean {
    return this.albumMediaAttachments(message).length > 1;
  }

  albumCountLabel(message: ChatMessage): string {
    const count = this.albumMediaAttachments(message).length;
    return `+${Math.max(0, count - 1)} more`;
  }

  albumPreviewItems(message: ChatMessage): Attachment[] {
    return this.albumMediaAttachments(message).slice(0, 4);
  }

  albumMoreCount(message: ChatMessage): number {
    const count = this.albumMediaAttachments(message).length;
    return count > 4 ? count - 4 : 0;
  }

  isMediaAlbumCollapsed(message: ChatMessage, scope: 'public' | 'private'): boolean {
    if (!this.hasAlbumMedia(message)) return false;
    const key = this.mediaAlbumKey(message, scope);
    return !this.temporaryExpandedAlbumKeys.has(key);
  }

  expandMediaAlbum(message: ChatMessage, scope: 'public' | 'private', event?: Event) {
    event?.stopPropagation();
    const key = this.mediaAlbumKey(message, scope);
    this.temporaryExpandedAlbumKeys.add(key);
    this.scheduleMediaAlbumCollapse(message, scope, 5000);
  }

  canPreviewMediaAttachment(attachment: ChatMessage['attachment']): boolean {
    return !!attachment && (attachment.isImage || this.isVideoAttachment(attachment));
  }

  enforceMutedPreview(event: Event) {
    const video = event.target as HTMLVideoElement | null;
    if (!video) return;
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
    try {
      void video.play();
    } catch {
      // no-op
    }
  }

  openAttachmentInGoogleDocs(attachment: ChatMessage['attachment']) {
    const url = this.googleDocsViewerUrl(attachment);
    window.open(url, '_blank', 'noopener');
  }

  async downloadAttachment(attachment: ChatMessage['attachment']) {
    const url = this.attachmentUrl(attachment);
    if (!url) return;

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = attachment?.name || 'download';
      document.body.appendChild(a);
      a.click();
      a.remove();

      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(url, '_blank', 'noopener');
    }
  }

  openAttachmentViewer(message: ChatMessage, scope: 'public' | 'private', attachmentOverride?: Attachment | null) {
    const attachment = attachmentOverride || message?.attachment || this.messageAttachments(message)[0] || null;
    if (!attachment) return;
    if (!attachment.isImage && !this.isVideoAttachment(attachment)) return;

    this.pauseAttachmentPreviewVideo(this.attachmentPreviewKey(message, attachment, scope));

    const media = this.albumMediaAttachments(message);
    const mediaList = media.length ? media : [attachment];
    const index = Math.max(0, mediaList.findIndex((m) => m.url === attachment.url));

    this.imageViewerTarget = { message: { ...message, attachment }, scope, media: mediaList, index };
    const ref = this.dialog.open(this.imageViewerTpl, {
      width: 'min(920px, 96vw)',
      maxWidth: '96vw'
    });

    ref.afterClosed().subscribe(() => {
      this.imageViewerTarget = null;
      this.viewerNotice = '';
      this.resumeAttachmentPreviewVideo();
    });
  }

  attachmentPreviewKey(message: ChatMessage, attachment: Attachment, scope: 'public' | 'private'): string {
    return `${scope}|${message.id}|${attachment.url}`;
  }

  private mediaAlbumKey(message: ChatMessage, scope: 'public' | 'private'): string {
    return `${scope}|${message.id || message.timestamp || message.text}`;
  }

  private scheduleMediaAlbumCollapse(message: ChatMessage, scope: 'public' | 'private', ms = 3500) {
    if (!this.hasAlbumMedia(message)) return;
    const key = this.mediaAlbumKey(message, scope);
    this.temporaryExpandedAlbumKeys.add(key);

    const prev = this.albumCollapseTimers.get(key);
    if (prev) clearTimeout(prev);

    const timer = setTimeout(() => {
      this.temporaryExpandedAlbumKeys.delete(key);
      this.albumCollapseTimers.delete(key);
    }, ms);
    this.albumCollapseTimers.set(key, timer);
  }

  isAttachmentPreviewHidden(message: ChatMessage, attachment: Attachment, scope: 'public' | 'private'): boolean {
    return this.hiddenAttachmentPreviewKeys.has(this.attachmentPreviewKey(message, attachment, scope));
  }

  toggleAttachmentPreview(message: ChatMessage, attachment: Attachment, scope: 'public' | 'private', event?: Event) {
    event?.stopPropagation();
    const key = this.attachmentPreviewKey(message, attachment, scope);
    if (this.hiddenAttachmentPreviewKeys.has(key)) {
      this.hiddenAttachmentPreviewKeys.delete(key);
      this.resumeAttachmentPreviewVideo();
      return;
    }

    this.hiddenAttachmentPreviewKeys.add(key);
    this.pauseAttachmentPreviewVideo(key);
  }

  private pauseAttachmentPreviewVideo(previewKey: string) {
    const el = document.querySelector(`video[data-preview-key="${previewKey}"]`) as HTMLVideoElement | null;
    if (!el) return;
    try {
      el.pause();
      this.pausedPreviewVideoKey = previewKey;
    } catch {
      this.pausedPreviewVideoKey = null;
    }
  }

  private resumeAttachmentPreviewVideo() {
    if (!this.pausedPreviewVideoKey) return;
    const el = document.querySelector(`video[data-preview-key="${this.pausedPreviewVideoKey}"]`) as HTMLVideoElement | null;
    this.pausedPreviewVideoKey = null;
    if (!el) return;
    try {
      el.muted = true;
      void el.play();
    } catch {
      // no-op
    }
  }

  private ensurePreviewVideosPlaying() {
    const videos = Array.from(document.querySelectorAll('video[data-preview-key]')) as HTMLVideoElement[];
    videos.forEach((video) => {
      if (!video.paused) return;
      try {
        video.muted = true;
        video.defaultMuted = true;
        void video.play();
      } catch {
        // no-op
      }
    });
  }

  async replyPrivatelyToAttachment(dialogRef: MatDialogRef<any>) {
    const target = this.imageViewerTarget;
    if (!target) return;

    const message = target.message;
    if (target.scope === 'public') {
      if (!message.from || message.from === this.myUsername) return;
      this.menuPublicMessage = message;
      await this.startChatFromPublic(message.from, true);
      dialogRef.close();
      return;
    }

    const other = message.from === this.myUsername ? message.to : message.from;
    if (!other) return;
    await this.openChat(other);
    this.replyToMessage(message, 'private');
    dialogRef.close();
  }

  canReplyPrivatelyToAttachment(): boolean {
    const target = this.imageViewerTarget;
    if (!target) return false;
    if (target.scope === 'public') return target.message.from !== this.myUsername;
    return true;
  }

  reactFromAttachmentViewer(emoji: string) {
    const target = this.imageViewerTarget;
    if (!target?.message?.id) return;
    this.toggleReaction(target.message, target.scope, emoji);
  }

  reportAttachmentFromViewer() {
    const target = this.imageViewerTarget;
    const current = this.viewerCurrentAttachment();
    const messageId = target?.message?.id;
    const attachmentUrl = this.attachmentUrl(current);
    if (!target || !messageId || !attachmentUrl) return;

    const headers = this.getAuthHeaders();
    if (!headers) return;

    this.http.post(`${environment.apiUrl}/api/attachments/report`, {
      messageId,
      scope: target.scope,
      attachmentUrl,
      reason: 'User report from viewer'
    }, { headers }).subscribe({
      next: () => {
        this.viewerNotice = 'Report submitted. Thanks for helping keep chat safe.';
      },
      error: () => {
        this.viewerNotice = 'Could not submit report. Please retry.';
      }
    });
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
        text: this.messageReplySeedText(quoted),
        attachment: this.messageAttachments(quoted)[0] || null,
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

  draftPreview(u: string): string {
    const draft = this.draftForContext(u);
    if (!draft) return '';
    return draft.length > 26 ? `${draft.slice(0, 26)}...` : draft;
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
    const nowIso = new Date().toISOString();
    arr.forEach(m => {
      if (m.from !== this.myUsername && m.status !== 'read' && m.id) {
        this.socket.emitEvent('markAsRead', { id: m.id, from: m.from });
        m.status = 'read' as ChatMessage['status'];
        m.readAt = nowIso;
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
    delete this.unreadMarkerByUser[u];
    this.historyLoaded.delete(u);
    this.users = this.users.filter(user => user !== u);
    if (this.selectedUser === u) {
      this.selectedUser = null;
    }
  }

  unreadCount(u: string): number {
    return this.unreadCounts[u] || 0;
  }

  shouldShowUnreadDivider(message: ChatMessage): boolean {
    if (!this.selectedUser || !message?.id) return false;
    return this.unreadMarkerByUser[this.selectedUser] === message.id;
  }

  hasUnreadMarker(): boolean {
    if (!this.selectedUser) return false;
    return !!this.unreadMarkerByUser[this.selectedUser];
  }

  jumpToFirstUnread() {
    if (!this.selectedUser) return;
    const marker = this.unreadMarkerByUser[this.selectedUser];
    if (!marker) return;
    this.scrollToMessage(marker);
    setTimeout(() => this.clearUnreadMarker(this.selectedUser), 5000);
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

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent) {
    if (!this.imageViewerTarget) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.viewerPrev();
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.viewerNext();
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
    const hasUnread = new Set<string>();
    counts.forEach((item) => {
      if (!item?.username) return;
      this.unreadCounts[item.username] = item.count || 0;
      if ((item.count || 0) > 0) hasUnread.add(item.username);
      if (!this.users.includes(item.username)) this.users.unshift(item.username);
    });
    if (this.selectedUser) this.unreadCounts[this.selectedUser] = 0;

    Object.keys(this.unreadMarkerByUser).forEach((user) => {
      if (!hasUnread.has(user) || (this.selectedUser && user === this.selectedUser)) {
        delete this.unreadMarkerByUser[user];
      }
    });
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
          scope: message.replyTo.scope || 'private',
          attachment: message.replyTo.attachment?.url
            ? {
              url: message.replyTo.attachment.url,
              name: message.replyTo.attachment.name || 'Attachment',
              mimeType: message.replyTo.attachment.mimeType || 'application/octet-stream',
              size: Number(message.replyTo.attachment.size || 0),
              isImage: !!message.replyTo.attachment.isImage,
              durationSeconds: Number(message.replyTo.attachment.durationSeconds || 0) || undefined,
              storageProvider: message.replyTo.attachment.storageProvider,
              objectKey: message.replyTo.attachment.objectKey
            }
            : null
        }
        : null,
      forwardedFrom: message.forwardedFrom?.messageId
        ? {
          messageId: message.forwardedFrom.messageId,
          from: message.forwardedFrom.from || '',
          text: String(message.forwardedFrom.text || '').trim().slice(0, 160),
          scope: message.forwardedFrom.scope || 'private',
          attachment: message.forwardedFrom.attachment?.url
            ? {
              url: message.forwardedFrom.attachment.url,
              name: message.forwardedFrom.attachment.name || 'Attachment',
              mimeType: message.forwardedFrom.attachment.mimeType || 'application/octet-stream',
              size: Number(message.forwardedFrom.attachment.size || 0),
              isImage: !!message.forwardedFrom.attachment.isImage,
              durationSeconds: Number(message.forwardedFrom.attachment.durationSeconds || 0) || undefined,
              storageProvider: message.forwardedFrom.attachment.storageProvider,
              objectKey: message.forwardedFrom.attachment.objectKey
            }
            : null
        }
        : null,
      attachment: message.attachment?.url
        ? {
          url: message.attachment.url,
          name: message.attachment.name || 'Attachment',
          mimeType: message.attachment.mimeType || 'application/octet-stream',
          size: Number(message.attachment.size || 0),
          isImage: !!message.attachment.isImage,
          durationSeconds: Number(message.attachment.durationSeconds || 0) || undefined,
          storageProvider: message.attachment.storageProvider,
          objectKey: message.attachment.objectKey
        }
        : null,
      attachments: (
        (message.attachments && message.attachments.length)
          ? message.attachments
          : (message.attachment ? [message.attachment] : [])
      )
        .reduce((acc, a) => {
          if (!a?.url) return acc;
          acc.push({
            url: a.url,
            name: a.name || 'Attachment',
            mimeType: a.mimeType || 'application/octet-stream',
            size: Number(a.size || 0),
            isImage: !!a.isImage,
            durationSeconds: Number(a.durationSeconds || 0) || undefined,
            storageProvider: a.storageProvider,
            objectKey: a.objectKey
          });
          return acc;
        }, [] as Attachment[]),
      readAt: message.readAt || null,
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
          attachment: null,
          attachments: [],
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

  private contextKey(user: string | null): string {
    return user ? `dm:${user}` : 'public';
  }

  private firstUnreadMessageId(user: string): string | null {
    const me = this.myUsername;
    const arr = this.privateChats[user] || [];
    const first = arr.find((m) => m.from !== me && !m.readAt && !!m.id);
    return first?.id || null;
  }

  private messageReplySeedText(message: ChatMessage): string {
    const text = String(message.text || '').trim();
    if (text) return text.slice(0, 160);

    const attachmentName = String(this.messageAttachments(message)[0]?.name || '').trim();
    if (attachmentName) return `[Attachment] ${attachmentName}`.slice(0, 160);

    return '';
  }

  private clearUnreadMarker(user: string | null) {
    if (!user) return;
    if (!this.unreadMarkerByUser[user]) return;
    delete this.unreadMarkerByUser[user];
  }

  private draftForContext(user: string | null): string {
    return this.draftsByContext[this.contextKey(user)] || '';
  }

  private saveDraftForContext(user: string | null, value: string) {
    const key = this.contextKey(user);
    const next = String(value || '').slice(0, 1000);

    if (!next.trim()) {
      if (!this.draftsByContext[key]) return;
      delete this.draftsByContext[key];
      this.persistDraftsToStorage();
      return;
    }

    if (this.draftsByContext[key] === next) return;
    this.draftsByContext[key] = next;
    this.persistDraftsToStorage();
  }

  private clearDraftForContext(user: string | null) {
    const key = this.contextKey(user);
    if (!this.draftsByContext[key]) return;
    delete this.draftsByContext[key];
    this.persistDraftsToStorage();
  }

  private loadDraftsFromStorage() {
    try {
      const raw = localStorage.getItem(DRAFTS_STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') return;

      this.draftsByContext = Object.entries(parsed).reduce((acc, [k, v]) => {
        if (typeof v === 'string' && v.trim()) acc[k] = v.slice(0, 1000);
        return acc;
      }, {} as Record<string, string>);
    } catch {
      this.draftsByContext = {};
    }
  }

  private persistDraftsToStorage() {
    try {
      if (!Object.keys(this.draftsByContext).length) {
        localStorage.removeItem(DRAFTS_STORAGE_KEY);
        return;
      }

      localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(this.draftsByContext));
    } catch {
      // no-op
    }
  }

  private activeReplyPayload(scope: 'public' | 'private') {
    if (!this.replyingTo || this.replyingTo.scope !== scope) return null;
    if (scope === 'private' && this.replyingTo.privatePeer !== this.selectedUser) return null;
    return {
      messageId: this.replyingTo.messageId,
      from: this.replyingTo.from,
      text: String(this.replyingTo.text || '').trim().slice(0, 160),
      scope: this.replyingTo.sourceScope,
      attachment: this.replyingTo.attachment
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

  private async jumpToReference(ref: {
    messageId: string;
    scope?: 'public' | 'private';
  } | null) {
    const targetId = ref?.messageId;
    if (!targetId) return;

    const targetScope = ref?.scope || 'private';
    if (targetScope === 'public') {
      if (this.selectedUser) this.backToPublic();
      await this.ensurePublicMessageLoaded(targetId);
      setTimeout(() => this.scrollToMessage(targetId), 50);
      return;
    }

    const loadedChat = Object.keys(this.privateChats)
      .find((user) => (this.privateChats[user] || []).some((m) => m.id === targetId));

    if (loadedChat) {
      if (this.selectedUser !== loadedChat) await this.openChat(loadedChat);
      setTimeout(() => this.scrollToMessage(targetId), 50);
      return;
    }

    await this.ensurePrivateMessageLoaded(targetId);
    setTimeout(() => this.scrollToMessage(targetId), 50);
  }

  private async ensurePrivateMessageLoaded(messageId: string) {
    const headers = this.getAuthHeaders();
    if (!headers) return;

    try {
      const found = await this.http
        .get<ChatMessage>(`${environment.apiUrl}/api/private/by-id/${messageId}`, { headers })
        .toPromise();
      if (!found?.id) return;

      const normalized = this.normalizeMessage(found);
      const other = normalized.from === this.myUsername ? normalized.to : normalized.from;
      if (!other) return;

      if (!this.privateChats[other]) this.privateChats[other] = [];

      const merged = new Map<string, ChatMessage>();
      [...(this.privateChats[other] || []), normalized].forEach((m) => {
        const key = m.id || `${m.from}|${m.to}|${m.timestamp}|${m.text}`;
        merged.set(key, m);
      });

      this.privateChats[other] = Array.from(merged.values()).sort(
        (a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime()
      );

      if (!this.users.includes(other)) this.users.unshift(other);
      await this.openChat(other);
    } catch {
      // no-op
    }
  }
}
