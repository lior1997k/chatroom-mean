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
const UPLOAD_UI_STORAGE_KEY = 'chatroom:uploadUiState';
const CHUNK_UPLOAD_RECOVERY_KEY = 'chatroom:chunkUploadRecovery';

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
  uploadQuality: 'original' | 'balanced' = 'original';
  autoplayMediaPreviews = true;
  autoOpenPrivateMediaTimeline = false;
  hideMediaPreviewsByDefault = false;
  uploadingAttachment = false;
  uploadingAttachmentCount = 0;
  uploadErrors: string[] = [];
  persistedFailedUploadNames: string[] = [];
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
  uploadChunkSize = 1024 * 1024;
  directUploadThreshold = 8 * 1024 * 1024;
  uploadResumeTtlMs = 24 * 60 * 60 * 1000;
  hourglassTop = true;
  private hourglassTimer: ReturnType<typeof setInterval> | null = null;
  isDragAttachActive = false;
  private dragAttachDepth = 0;
  readonly editWindowMs = 15 * 60 * 1000;

  // Data
  readonly messageReactions = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
  readonly composerEmojis = ['😀', '😁', '😂', '😊', '😍', '🤝', '👍', '🔥', '🎉', '💬'];
  messageSearchQuery = '';
  searchInputText = '';
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
  searchFilterMenuOpen = false;

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
  viewerZoom = 1;
  viewerZoomControlOpen = false;
  viewerZoomHudVisible = false;
  viewerPanX = 0;
  viewerPanY = 0;
  privateMediaTimelineFilter: 'all' | 'image' | 'video' = 'all';
  privateMediaTimelineOpen = false;
  privateMediaTimelineCollapsed = false;
  threadRenderLimit = 180;
  showViewerShortcutHints = false;
  readonly reportReasonOptions = [
    { key: 'spam', label: 'Spam / Scam', severity: 'medium' },
    { key: 'harassment', label: 'Harassment', severity: 'high' },
    { key: 'violence', label: 'Violence', severity: 'high' },
    { key: 'sexual', label: 'Sexual content', severity: 'high' },
    { key: 'copyright', label: 'Copyright', severity: 'medium' },
    { key: 'other', label: 'Other', severity: 'low' }
  ] as const;
  private pausedPreviewVideoKey: string | null = null;
  private lastPreviewKickAt = 0;
  private hiddenAttachmentPreviewKeys = new Set<string>();
  private shownAttachmentPreviewKeys = new Set<string>();
  private shownAlbumPreviewKeys = new Set<string>();
  private temporaryExpandedAlbumKeys = new Set<string>();
  private albumCollapseTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private durationRecheckTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private previewVisibilityObserver: IntersectionObserver | null = null;
  private observedPreviewVideos = new WeakSet<HTMLVideoElement>();
  private chunkRecovery: Record<string, {
    sessionId: string;
    fileName: string;
    size: number;
    mimeType: string;
    totalChunks: number;
    uploadedChunks: number[];
    failedChunks: number[];
    updatedAt: number;
  }> = {};
  private viewerDragging = false;
  private viewerDragOriginX = 0;
  private viewerDragOriginY = 0;
  private viewerPinchDistance = 0;
  private viewerPinchStartZoom = 1;
  private lastTapAt = 0;
  private lastTapX = 0;
  private lastTapY = 0;
  private viewerSwipeStartY = 0;
  private viewerSwipeStartX = 0;
  private viewerTouchLastY = 0;
  private viewerTouchLastX = 0;
  private viewerDragLastTs = 0;
  private viewerPanVx = 0;
  private viewerPanVy = 0;
  private viewerMomentumRaf: number | null = null;
  private viewerZoomHudTimer: ReturnType<typeof setTimeout> | null = null;
  private viewerDialogRef: MatDialogRef<any> | null = null;
  private lastPrefetchAt = 0;
  private timelineLastOpenAt = 0;
  private timelineLastOpenKey = '';
  private timelineThumbPointerDown: {
    key: string;
    pointerId: number;
    x: number;
    y: number;
    at: number;
  } | null = null;

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
    this.loadUploadUiState();
    this.loadChunkRecoveryState();
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
    this.durationRecheckTimers.forEach((t) => clearTimeout(t));
    this.durationRecheckTimers.clear();
    this.previewVisibilityObserver?.disconnect();
    this.previewVisibilityObserver = null;
    this.stopViewerMomentum();
    if (this.viewerZoomHudTimer) clearTimeout(this.viewerZoomHudTimer);
    this.stopHourglassAnimation();
  }

  ngAfterViewChecked() {
    this.registerPreviewVideosForProgressiveLoading();
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
    this.privateMediaTimelineOpen = this.autoOpenPrivateMediaTimeline;
    this.privateMediaTimelineCollapsed = false;
    this.threadRenderLimit = 180;
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
    this.privateMediaTimelineOpen = false;
    this.privateMediaTimelineCollapsed = false;
    this.threadRenderLimit = 180;
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

      const preparedFile = await this.prepareFileForUpload(file);

      const itemId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const item = {
        id: itemId,
        name: preparedFile.name,
        progress: 0,
        status: 'uploading' as const,
        file: preparedFile,
        error: ''
      };
      this.uploadProgressItems.unshift(item);

      try {
        const mediaMetadata = await this.extractMediaMetadata(preparedFile);
        const uploaded = preparedFile.size < this.directUploadThreshold
          ? await this.uploadSingleAttachment(preparedFile, headers, itemId, mediaMetadata)
          : await this.uploadLargeAttachmentInChunks(preparedFile, headers, itemId, mediaMetadata);

        if (uploaded?.url) {
          this.pendingAttachments.push({
              url: uploaded.url,
              name: uploaded.name || preparedFile.name,
              mimeType: uploaded.mimeType || preparedFile.type || 'application/octet-stream',
              size: Number(uploaded.size || preparedFile.size || 0),
              isImage: !!uploaded.isImage,
              durationSeconds: Number(uploaded.durationSeconds || mediaMetadata.durationSeconds || 0) || undefined,
              width: Number(uploaded.width || mediaMetadata.width || 0) || undefined,
              height: Number(uploaded.height || mediaMetadata.height || 0) || undefined,
              storageProvider: uploaded.storageProvider,
              objectKey: uploaded.objectKey
            });
          this.persistUploadUiState();
          this.setUploadItemStatus(itemId, 'done', '');
        }
      } catch (error) {
        const reason = this.uploadFailureReason(error, preparedFile);
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
    this.persistUploadUiState();
    if (inputToClear) inputToClear.value = '';
  }

  setUploadQuality(mode: 'original' | 'balanced') {
    if (this.uploadQuality === mode) return;
    this.uploadQuality = mode;
    this.persistUploadUiState();
  }

  private async prepareFileForUpload(file: File): Promise<File> {
    if (this.uploadQuality !== 'balanced') return file;
    if (!String(file.type || '').startsWith('image/')) return file;
    try {
      return await this.compressImageFile(file);
    } catch {
      return file;
    }
  }

  private async compressImageFile(file: File): Promise<File> {
    const image = await this.readImageElement(file);
    const maxEdge = 1920;
    const ratio = Math.min(1, maxEdge / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
    const width = Math.max(1, Math.round(image.naturalWidth * ratio));
    const height = Math.max(1, Math.round(image.naturalHeight * ratio));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(image, 0, 0, width, height);

    const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const quality = outputType === 'image/jpeg' ? 0.78 : undefined;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outputType, quality));
    if (!blob || blob.size >= file.size) return file;

    const ext = outputType === 'image/png' ? '.png' : '.jpg';
    const base = file.name.replace(/\.[^/.]+$/, '');
    return new File([blob], `${base}${ext}`, { type: outputType, lastModified: Date.now() });
  }

  private readImageElement(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Image decode failed'));
      };
      img.src = objectUrl;
    });
  }

  retryFailedUploads() {
    const failedFiles = this.uploadProgressItems
      .filter((x) => x.status === 'failed')
      .map((x) => x.file);
    if (!failedFiles.length || this.uploadingAttachment) {
      if (!failedFiles.length && this.persistedFailedUploadNames.length) {
        this.pushUploadError('Failed files from the previous session need to be reselected before retry.');
      }
      return;
    }
    this.uploadAttachmentFiles(failedFiles);
  }

  cancelAttachmentUploads() {
    this.cancelUploadRequested = true;
  }

  private uploadSingleAttachment(
    file: File,
    headers: HttpHeaders,
    itemId: string,
    metadata?: { durationSeconds?: number | null; width?: number | null; height?: number | null }
  ): Promise<Attachment> {
    const formData = new FormData();
    formData.append('file', file);
    if (Number(metadata?.durationSeconds) > 0) {
      formData.append('durationSeconds', String(Math.round(Number(metadata?.durationSeconds))));
    }
    if (Number(metadata?.width) > 0) {
      formData.append('width', String(Math.round(Number(metadata?.width))));
    }
    if (Number(metadata?.height) > 0) {
      formData.append('height', String(Math.round(Number(metadata?.height))));
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

  private async uploadLargeAttachmentInChunks(
    file: File,
    headers: HttpHeaders,
    itemId: string,
    metadata?: { durationSeconds?: number | null; width?: number | null; height?: number | null }
  ): Promise<Attachment> {
    const chunkSize = Math.max(256 * 1024, this.uploadChunkSize || (1024 * 1024));
    const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));
    const resumeKey = this.chunkResumeKeyForFile(file);

    const initPayload = await this.http.post<{
      sessionId: string;
      uploadedChunks: number[];
      totalChunks: number;
    }>(`${environment.apiUrl}/api/upload/chunk/init`, {
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      totalChunks,
      resumeKey
    }, { headers }).toPromise();

    if (!initPayload?.sessionId) throw new Error('Could not initialize chunk upload session');
    const sessionId = String(initPayload.sessionId);
    const uploadedSet = new Set<number>(Array.isArray(initPayload.uploadedChunks) ? initPayload.uploadedChunks : []);

    for (let index = 0; index < totalChunks; index += 1) {
      if (this.cancelUploadRequested) {
        await this.http.delete(`${environment.apiUrl}/api/upload/chunk/${sessionId}`, { headers }).toPromise().catch(() => null);
        throw new Error('cancelled');
      }
      if (uploadedSet.has(index)) {
        const progress = Math.round(((index + 1) / totalChunks) * 100);
        this.setUploadItemProgress(itemId, progress);
        continue;
      }

      const start = index * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const blob = file.slice(start, end);
      const formData = new FormData();
      formData.append('chunk', blob, `${file.name}.part`);
      formData.append('index', String(index));

      try {
        await this.http.post(`${environment.apiUrl}/api/upload/chunk/${sessionId}`, formData, { headers }).toPromise();
      } catch (error) {
        this.persistChunkRecovery(resumeKey, {
          sessionId,
          fileName: file.name,
          size: file.size,
          mimeType: file.type || 'application/octet-stream',
          totalChunks,
          uploadedChunks: Array.from(uploadedSet),
          failedChunks: [index],
          updatedAt: Date.now()
        });
        throw error;
      }
      uploadedSet.add(index);
      const progress = Math.round((uploadedSet.size / totalChunks) * 100);
      this.setUploadItemProgress(itemId, progress);
      this.persistChunkRecovery(resumeKey, {
        sessionId,
        fileName: file.name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        totalChunks,
        uploadedChunks: Array.from(uploadedSet),
        failedChunks: [],
        updatedAt: Date.now()
      });
    }

    const finalizePayload = await this.http.post<Attachment>(`${environment.apiUrl}/api/upload/chunk/${sessionId}/finalize`, {
      durationSeconds: Number(metadata?.durationSeconds || 0) || undefined,
      width: Number(metadata?.width || 0) || undefined,
      height: Number(metadata?.height || 0) || undefined
    }, { headers }).toPromise();

    this.clearChunkRecovery(resumeKey);
    if (!finalizePayload) throw new Error('Upload finalize failed');
    this.setUploadItemProgress(itemId, 100);
    return finalizePayload;
  }

  private chunkResumeKeyForFile(file: File): string {
    return `${file.name}|${file.size}|${file.lastModified}|${file.type || 'application/octet-stream'}`;
  }

  private extractMediaMetadata(file: File): Promise<{ durationSeconds?: number; width?: number; height?: number }> {
    if (!file.type.startsWith('video/') && !file.type.startsWith('image/')) {
      return Promise.resolve({});
    }

    return new Promise((resolve) => {
      const media = document.createElement(file.type.startsWith('video/') ? 'video' : 'img') as HTMLVideoElement | HTMLImageElement;
      const objectUrl = URL.createObjectURL(file);
      const cleanup = () => {
        URL.revokeObjectURL(objectUrl);
        media.removeAttribute('src');
        if (media instanceof HTMLVideoElement) media.load();
      };

      const done = (durationOverride?: number) => {
        const width = Number((media as any).videoWidth || (media as any).naturalWidth || 0);
        const height = Number((media as any).videoHeight || (media as any).naturalHeight || 0);
        const rawDuration = Number(durationOverride || (media instanceof HTMLVideoElement ? media.duration : 0));
        cleanup();
        resolve({
          durationSeconds: Number.isFinite(rawDuration) && rawDuration > 0 ? Math.floor(rawDuration) : undefined,
          width: Number.isFinite(width) && width > 0 ? Math.round(width) : undefined,
          height: Number.isFinite(height) && height > 0 ? Math.round(height) : undefined
        });
      };

      if (media instanceof HTMLVideoElement) {
        media.preload = 'metadata';
        media.onloadedmetadata = () => {
          const initialDuration = Number(media.duration);
          if (!Number.isFinite(initialDuration) || initialDuration <= 0) {
            done();
            return;
          }

          let settled = false;
          const fallbackTimer = setTimeout(() => {
            if (settled) return;
            settled = true;
            done(initialDuration);
          }, 850);

          const finalizeFromSeek = () => {
            if (settled) return;
            settled = true;
            clearTimeout(fallbackTimer);
            const corrected = Number(media.duration);
            done(Number.isFinite(corrected) && corrected > 0 ? corrected : initialDuration);
          };

          media.addEventListener('seeked', finalizeFromSeek, { once: true });
          try {
            media.currentTime = 1e9;
          } catch {
            settled = true;
            clearTimeout(fallbackTimer);
            done(initialDuration);
          }
        };
      } else {
        media.onload = () => done();
      }
      media.onerror = () => {
        cleanup();
        resolve({});
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

    if (status === 'failed' && item.name) {
      this.persistedFailedUploadNames = [item.name, ...this.persistedFailedUploadNames.filter((x) => x !== item.name)].slice(0, 8);
      this.persistUploadUiState();
    }

    if (status === 'done') {
      this.forgetFailedName(item.name);
      setTimeout(() => {
        this.uploadProgressItems = this.uploadProgressItems.filter((x) => x.id !== itemId);
      }, 900);
    }

    if (this.uploadProgressItems.length > 12) {
      this.uploadProgressItems = this.uploadProgressItems.slice(0, 12);
    }
  }

  private removeUploadProgressItem(itemId: string) {
    this.uploadProgressItems = this.uploadProgressItems.filter((x) => x.id !== itemId);
    this.persistUploadUiState();
  }

  private forgetFailedName(name: string) {
    if (!name) return;
    const next = this.persistedFailedUploadNames.filter((x) => x !== name);
    if (next.length === this.persistedFailedUploadNames.length) return;
    this.persistedFailedUploadNames = next;
    this.persistUploadUiState();
  }

  private hasDraggedFiles(event: DragEvent): boolean {
    const types = event.dataTransfer?.types;
    if (!types) return false;
    return Array.from(types).includes('Files');
  }

  clearPendingAttachments() {
    this.pendingAttachments = [];
    this.showPendingAttachmentsPanel = false;
    this.persistUploadUiState();
    const input = this.attachmentInput?.nativeElement;
    if (input) input.value = '';
  }

  removePendingAttachment(index: number) {
    if (index < 0 || index >= this.pendingAttachments.length) return;
    this.pendingAttachments.splice(index, 1);
    if (!this.pendingAttachments.length) this.showPendingAttachmentsPanel = false;
    this.persistUploadUiState();
  }

  retryUploadItem(itemId: string) {
    if (!itemId || this.uploadingAttachment) return;
    const item = this.uploadProgressItems.find((x) => x.id === itemId);
    if (!item || item.status !== 'failed') return;
    this.removeUploadProgressItem(itemId);
    this.forgetFailedName(item.name);
    this.uploadAttachmentFiles([item.file]);
  }

  dismissUploadItem(itemId: string) {
    if (!itemId) return;
    const item = this.uploadProgressItems.find((x) => x.id === itemId);
    if (!item) return;
    this.removeUploadProgressItem(itemId);
    if (item.status === 'failed') this.forgetFailedName(item.name);
  }

  trackByString(index: number, value: string): string {
    return `${index}:${value}`;
  }

  trackByTimelineItem(index: number, item: { message: ChatMessage; attachment: Attachment }): string {
    const messageKey = item?.message?.id || item?.message?.timestamp || `${index}`;
    const attachmentKey = item?.attachment?.url || item?.attachment?.name || `${index}`;
    return `${messageKey}|${attachmentKey}`;
  }

  trackByUploadItem(index: number, item: { id: string }): string {
    return item?.id || `${index}`;
  }

  trackByResumableItem(index: number, item: { key: string }): string {
    return item?.key || `${index}`;
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
    this.persistedFailedUploadNames = [];
    this.chunkRecovery = {};
    this.persistChunkRecoveryState();
    this.persistUploadUiState();
  }

  private pushUploadError(message: string) {
    this.uploadErrors = [message, ...this.uploadErrors].slice(0, 4);
    this.persistUploadUiState();
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
      .get<{
        maxBytes: number;
        allowedMimePatterns: string[];
        chunkSize?: number;
        directUploadThreshold?: number;
        resumeTtlMs?: number;
      }>(`${environment.apiUrl}/api/upload/policy`, { headers })
      .subscribe({
        next: (policy) => {
          if (!policy) return;
          this.uploadPolicy = {
            maxBytes: Number(policy.maxBytes || 0),
            allowedMimePatterns: Array.isArray(policy.allowedMimePatterns) ? policy.allowedMimePatterns : []
          };
          if (Number(policy.chunkSize) > 0) this.uploadChunkSize = Math.max(256 * 1024, Math.floor(Number(policy.chunkSize)));
          if (Number(policy.directUploadThreshold) > 0) this.directUploadThreshold = Math.floor(Number(policy.directUploadThreshold));
          if (Number(policy.resumeTtlMs) > 0) this.uploadResumeTtlMs = Math.floor(Number(policy.resumeTtlMs));
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
    return !!v && v.media.length > 1;
  }

  viewerHasNext(): boolean {
    const v = this.imageViewerTarget;
    return !!v && v.media.length > 1;
  }

  viewerPrev() {
    if (!this.imageViewerTarget || !this.viewerHasPrev()) return;
    const mediaCount = this.imageViewerTarget.media.length;
    const nextIndex = (this.imageViewerTarget.index - 1 + mediaCount) % mediaCount;
    this.imageViewerTarget = {
      ...this.imageViewerTarget,
      index: nextIndex,
      message: { ...this.imageViewerTarget.message, attachment: this.imageViewerTarget.media[nextIndex] }
    };
    this.resetViewerZoom();
    this.prefetchViewerNeighbors();
  }

  viewerNext() {
    if (!this.imageViewerTarget || !this.viewerHasNext()) return;
    const mediaCount = this.imageViewerTarget.media.length;
    const nextIndex = (this.imageViewerTarget.index + 1) % mediaCount;
    this.imageViewerTarget = {
      ...this.imageViewerTarget,
      index: nextIndex,
      message: { ...this.imageViewerTarget.message, attachment: this.imageViewerTarget.media[nextIndex] }
    };
    this.resetViewerZoom();
    this.prefetchViewerNeighbors();
  }

  viewerJumpTo(index: number) {
    if (!this.imageViewerTarget) return;
    if (index < 0 || index >= this.imageViewerTarget.media.length) return;
    this.imageViewerTarget = {
      ...this.imageViewerTarget,
      index,
      message: { ...this.imageViewerTarget.message, attachment: this.imageViewerTarget.media[index] }
    };
    this.resetViewerZoom();
    this.prefetchViewerNeighbors();
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

  onVideoPreviewMetadata(event: Event, attachment: ChatMessage['attachment']) {
    this.enforceMutedPreview(event);
    if (!attachment) return;

    const video = event.target as HTMLVideoElement | null;
    if (!video) return;

    const applyDuration = () => {
      const raw = Number(video.duration || 0);
      const duration = Math.floor(raw);
      if (!Number.isFinite(duration) || duration <= 0) return;
      const current = Number(attachment.durationSeconds || 0);
      if (!current || Math.abs(current - duration) >= 1) {
        attachment.durationSeconds = duration;
      }
    };

    applyDuration();
    video.addEventListener('durationchange', applyDuration, { once: true });
    video.addEventListener('canplay', applyDuration, { once: true });

    const key = String(attachment.url || '');
    const prev = this.durationRecheckTimers.get(key);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      applyDuration();
      this.durationRecheckTimers.delete(key);
    }, 1400);
    this.durationRecheckTimers.set(key, timer);

    if (!video.paused) {
      setTimeout(() => applyDuration(), 2200);
    }
  }

  onTimelineThumbVideoMetadata(event: Event) {
    const video = event.target as HTMLVideoElement | null;
    if (!video) return;
    try {
      video.currentTime = Math.min(0.2, Math.max(0, Number(video.duration || 0) * 0.1));
      video.pause();
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

  async downloadViewerAlbumAsZip() {
    const viewer = this.imageViewerTarget;
    if (!viewer || viewer.media.length < 2) return;

    const token = this.auth.getToken();
    if (!token) {
      this.viewerNotice = 'Session expired. Please sign in again to download the album.';
      return;
    }

    try {
      const response = await fetch(`${environment.apiUrl}/api/attachments/zip`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ attachments: viewer.media })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(String(payload?.error || 'Download failed'));
      }

      const blob = await response.blob();
      const disposition = String(response.headers.get('content-disposition') || '');
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const fileName = match?.[1] || `chat-album-${Date.now()}.zip`;

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      this.viewerNotice = 'Album download started.';
    } catch (error: any) {
      this.viewerNotice = String(error?.message || 'Could not download album zip.');
    }
  }

  openAttachmentViewer(message: ChatMessage, scope: 'public' | 'private', attachmentOverride?: Attachment | null): boolean {
    const attachment = attachmentOverride || message?.attachment || this.messageAttachments(message)[0] || null;
    if (!attachment) return false;
    if (!attachment.isImage && !this.isVideoAttachment(attachment)) return false;

    this.pauseAttachmentPreviewVideo(this.attachmentPreviewKey(message, attachment, scope));

    const media = this.albumMediaAttachments(message);
    const mediaList = media.length ? media : [attachment];
    const index = Math.max(0, mediaList.findIndex((m) => m.url === attachment.url));

    this.imageViewerTarget = { message: { ...message, attachment }, scope, media: mediaList, index };
    this.resetViewerZoom();
    this.prefetchViewerNeighbors();
    try {
      const ref = this.dialog.open(this.imageViewerTpl, {
        width: 'min(920px, 96vw)',
        maxWidth: '96vw'
      });
      this.viewerDialogRef = ref;
      this.showViewerShortcutHints = false;

      ref.afterClosed().subscribe(() => {
        this.imageViewerTarget = null;
        this.viewerNotice = '';
        this.viewerDialogRef = null;
        this.stopViewerMomentum();
        this.resumeAttachmentPreviewVideo();
      });
      return true;
    } catch (error: any) {
      return false;
    }
  }

  private prefetchViewerNeighbors() {
    const viewer = this.imageViewerTarget;
    if (!viewer || !viewer.media.length) return;
    const now = Date.now();
    if (now - this.lastPrefetchAt < 260) return;
    this.lastPrefetchAt = now;

    const next = viewer.media[(viewer.index + 1) % viewer.media.length];
    const prev = viewer.media[(viewer.index - 1 + viewer.media.length) % viewer.media.length];
    [next, prev].forEach((attachment) => {
      if (!this.shouldPrefetchAttachment(attachment)) return;
      const url = this.attachmentUrl(attachment);
      if (!url) return;

      if (attachment.isImage) {
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
        return;
      }

      if (this.isVideoAttachment(attachment)) {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.src = url;
      }
    });
  }

  private shouldPrefetchAttachment(attachment: Attachment | null | undefined): boolean {
    if (!attachment) return false;
    const size = Number(attachment.size || 0);
    if (size > 20 * 1024 * 1024) return false;
    return !!attachment.url;
  }

  attachmentPreviewKey(message: ChatMessage, attachment: Attachment, scope: 'public' | 'private'): string {
    return `${scope}|${message.id}|${attachment.url}`;
  }

  private albumPreviewKey(message: ChatMessage, scope: 'public' | 'private'): string {
    return `album|${scope}|${message.id || message.timestamp || message.text}`;
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
    const key = this.attachmentPreviewKey(message, attachment, scope);
    if (this.hideMediaPreviewsByDefault) {
      return !this.shownAttachmentPreviewKeys.has(key);
    }
    return this.hiddenAttachmentPreviewKeys.has(key);
  }

  toggleAttachmentPreview(message: ChatMessage, attachment: Attachment, scope: 'public' | 'private', event?: Event) {
    event?.stopPropagation();
    const key = this.attachmentPreviewKey(message, attachment, scope);
    if (this.hideMediaPreviewsByDefault) {
      if (this.shownAttachmentPreviewKeys.has(key)) {
        this.shownAttachmentPreviewKeys.delete(key);
        this.pauseAttachmentPreviewVideo(key);
      } else {
        this.shownAttachmentPreviewKeys.add(key);
        this.resumeAttachmentPreviewVideo();
      }
      return;
    }

    if (this.hiddenAttachmentPreviewKeys.has(key)) {
      this.hiddenAttachmentPreviewKeys.delete(key);
      this.resumeAttachmentPreviewVideo();
      return;
    }

    this.hiddenAttachmentPreviewKeys.add(key);
    this.pauseAttachmentPreviewVideo(key);
  }

  isAlbumPreviewHidden(message: ChatMessage, scope: 'public' | 'private'): boolean {
    if (!this.hideMediaPreviewsByDefault) return false;
    return !this.shownAlbumPreviewKeys.has(this.albumPreviewKey(message, scope));
  }

  showAlbumPreview(message: ChatMessage, scope: 'public' | 'private', event?: Event) {
    event?.stopPropagation();
    this.shownAlbumPreviewKeys.add(this.albumPreviewKey(message, scope));
  }

  private pauseAttachmentPreviewVideo(previewKey: string) {
    const el = this.findPreviewVideoByKey(previewKey);
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
    const el = this.findPreviewVideoByKey(this.pausedPreviewVideoKey);
    this.pausedPreviewVideoKey = null;
    if (!el) return;
    try {
      el.muted = true;
      void el.play();
    } catch {
      // no-op
    }
  }

  private findPreviewVideoByKey(previewKey: string): HTMLVideoElement | null {
    const videos = Array.from(document.querySelectorAll('video[data-preview-key]')) as HTMLVideoElement[];
    return videos.find((video) => video.getAttribute('data-preview-key') === previewKey) || null;
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

  private registerPreviewVideosForProgressiveLoading() {
    const videos = Array.from(document.querySelectorAll('video[data-preview-key]')) as HTMLVideoElement[];
    if (!videos.length) return;

    if (!this.previewVisibilityObserver && typeof IntersectionObserver !== 'undefined') {
      this.previewVisibilityObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const video = entry.target as HTMLVideoElement;
            if (!this.autoplayMediaPreviews) {
              try {
                video.pause();
              } catch {
                // no-op
              }
              return;
            }
            if (entry.isIntersecting && entry.intersectionRatio >= 0.25) {
              try {
                video.muted = true;
                video.defaultMuted = true;
                void video.play();
              } catch {
                // no-op
              }
            } else {
              try {
                video.pause();
              } catch {
                // no-op
              }
            }
          });
        },
        { threshold: [0, 0.25, 0.65] }
      );
    }

    if (!this.previewVisibilityObserver) {
      if (this.autoplayMediaPreviews) this.ensurePreviewVideosPlaying();
      return;
    }

    videos.forEach((video) => {
      if (this.observedPreviewVideos.has(video)) return;
      this.observedPreviewVideos.add(video);
      this.previewVisibilityObserver?.observe(video);
    });
  }

  private resetViewerZoom() {
    this.viewerZoom = 1;
    this.viewerZoomControlOpen = false;
    this.viewerPanX = 0;
    this.viewerPanY = 0;
    this.viewerDragging = false;
  }

  viewerZoomIn() {
    this.viewerZoom = Math.min(4, Number((this.viewerZoom + 0.2).toFixed(2)));
    if (this.viewerZoom > 1.01) this.viewerZoomControlOpen = true;
    this.showZoomHud();
  }

  viewerZoomOut() {
    this.viewerZoom = Math.max(1, Number((this.viewerZoom - 0.2).toFixed(2)));
    this.showZoomHud();
    if (this.viewerZoom <= 1.01) {
      this.resetViewerZoom();
    }
  }

  viewerZoomReset() {
    this.viewerZoom = 1;
    this.viewerZoomControlOpen = false;
    this.viewerPanX = 0;
    this.viewerPanY = 0;
  }

  toggleViewerZoomControl() {
    if (!this.viewerCurrentAttachment()?.isImage) return;

    if (this.viewerZoom > 1.01 || this.viewerZoomControlOpen) {
      this.viewerZoomReset();
      return;
    }

    this.viewerZoomControlOpen = true;
  }

  onViewerZoomSliderInput(value: number | string) {
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    this.viewerZoom = Math.max(1, Math.min(4, Number(next.toFixed(2))));
    this.showZoomHud();
    if (this.viewerZoom <= 1.01) {
      this.viewerPanX = 0;
      this.viewerPanY = 0;
    }
  }

  viewerZoomPercent(): string {
    return `${Math.round(this.viewerZoom * 100)}%`;
  }

  viewerImageStyle(): Record<string, string> {
    return {
      maxWidth: 'min(860px, 90vw)',
      maxHeight: '60vh',
      display: 'block',
      transform: `translate(${this.viewerPanX}px, ${this.viewerPanY}px) scale(${this.viewerZoom})`,
      transformOrigin: 'center center',
      transition: this.viewerDragging ? 'none' : 'transform 0.12s ease-out',
      cursor: this.viewerZoom > 1 ? (this.viewerDragging ? 'grabbing' : 'grab') : 'default',
      userSelect: 'none',
      WebkitUserDrag: 'none',
      objectFit: 'contain'
    };
  }

  onViewerImageDoubleClick(event: MouseEvent) {
    if (!this.viewerCurrentAttachment()?.isImage) return;
    const host = event.currentTarget as HTMLElement | null;
    if (!host) return;

    if (this.viewerZoom > 1.01) {
      this.viewerZoomReset();
      return;
    }

    this.zoomToPoint(event.clientX, event.clientY, 2, host);
    this.viewerZoomControlOpen = true;
    this.showZoomHud();
  }

  viewerImageStageStyle(): Record<string, string> {
    return {
      position: 'relative',
      maxWidth: 'min(860px, 90vw)',
      maxHeight: '60vh',
      borderRadius: '12px',
      overflow: 'hidden',
      border: '1px solid #d7e2f0',
      boxShadow: '0 12px 24px rgba(26, 48, 78, 0.15)',
      background: '#0d1726',
      touchAction: this.viewerCurrentAttachment()?.isImage ? 'none' : 'auto'
    };
  }

  onViewerImageWheel(event: WheelEvent) {
    if (!this.viewerCurrentAttachment()?.isImage) return;
    event.preventDefault();
    if (event.deltaY < 0) {
      this.viewerZoom = Math.min(4, Number((this.viewerZoom + 0.2).toFixed(2)));
      if (this.viewerZoom > 1.01) this.viewerZoomControlOpen = true;
      this.showZoomHud();
      return;
    }
    this.viewerZoomOut();
  }

  onViewerDragStart(event: MouseEvent) {
    if (!this.viewerCurrentAttachment()?.isImage || this.viewerZoom <= 1) return;
    event.preventDefault();
    this.viewerDragging = true;
    this.stopViewerMomentum();
    this.viewerDragOriginX = event.clientX - this.viewerPanX;
    this.viewerDragOriginY = event.clientY - this.viewerPanY;
    this.viewerDragLastTs = Date.now();
    this.viewerPanVx = 0;
    this.viewerPanVy = 0;
  }

  onViewerDragMove(event: MouseEvent) {
    if (!this.viewerDragging || this.viewerZoom <= 1) return;
    event.preventDefault();
    const host = event.currentTarget as HTMLElement | null;
    const nextX = event.clientX - this.viewerDragOriginX;
    const nextY = event.clientY - this.viewerDragOriginY;
    const now = Date.now();
    const dt = Math.max(1, now - this.viewerDragLastTs);
    this.viewerPanVx = (nextX - this.viewerPanX) / dt;
    this.viewerPanVy = (nextY - this.viewerPanY) / dt;
    this.viewerDragLastTs = now;
    this.applyViewerPan(nextX, nextY, host);
  }

  onViewerDragEnd() {
    if (this.viewerZoom > 1.01 && (Math.abs(this.viewerPanVx) > 0.05 || Math.abs(this.viewerPanVy) > 0.05)) {
      this.startViewerMomentum();
    }
    this.viewerDragging = false;
  }

  onViewerTouchStart(event: TouchEvent) {
    if (!this.viewerCurrentAttachment()?.isImage) return;

    if (event.touches.length === 1) {
      const touch = event.touches[0];
      this.viewerSwipeStartY = touch.clientY;
      this.viewerSwipeStartX = touch.clientX;
      this.viewerTouchLastY = touch.clientY;
      this.viewerTouchLastX = touch.clientX;
      const now = Date.now();
      const dt = now - this.lastTapAt;
      const dist = Math.hypot(touch.clientX - this.lastTapX, touch.clientY - this.lastTapY);
      if (dt > 0 && dt < 320 && dist < 24) {
        const host = event.currentTarget as HTMLElement | null;
        if (host) {
          event.preventDefault();
          if (this.viewerZoom > 1.01) {
            this.viewerZoomReset();
          } else {
            this.zoomToPoint(touch.clientX, touch.clientY, 2, host);
            this.viewerZoomControlOpen = true;
          }
        }
      }
      this.lastTapAt = now;
      this.lastTapX = touch.clientX;
      this.lastTapY = touch.clientY;
    }

    if (event.touches.length === 2) {
      event.preventDefault();
      this.viewerPinchDistance = this.touchDistance(event.touches[0], event.touches[1]);
      this.viewerPinchStartZoom = this.viewerZoom;
      this.viewerDragging = false;
      return;
    }

    if (event.touches.length === 1 && this.viewerZoom > 1) {
      event.preventDefault();
      const touch = event.touches[0];
      this.viewerDragging = true;
      this.stopViewerMomentum();
      this.viewerDragOriginX = touch.clientX - this.viewerPanX;
      this.viewerDragOriginY = touch.clientY - this.viewerPanY;
      this.viewerDragLastTs = Date.now();
      this.viewerPanVx = 0;
      this.viewerPanVy = 0;
    }
  }

  onViewerTouchMove(event: TouchEvent) {
    if (!this.viewerCurrentAttachment()?.isImage) return;
    const host = event.currentTarget as HTMLElement | null;

    if (event.touches.length === 2) {
      event.preventDefault();
      const distance = this.touchDistance(event.touches[0], event.touches[1]);
      if (this.viewerPinchDistance > 0) {
        const ratio = distance / this.viewerPinchDistance;
        const nextZoom = Math.max(1, Math.min(4, Number((this.viewerPinchStartZoom * ratio).toFixed(2))));
        this.viewerZoom = nextZoom;
        if (this.viewerZoom > 1.01) this.viewerZoomControlOpen = true;
        this.showZoomHud();
        this.applyViewerPan(this.viewerPanX, this.viewerPanY, host);
      }
      return;
    }

    if (event.touches.length === 1 && this.viewerDragging && this.viewerZoom > 1) {
      event.preventDefault();
      const touch = event.touches[0];
      this.viewerTouchLastY = touch.clientY;
      this.viewerTouchLastX = touch.clientX;
      const nextX = touch.clientX - this.viewerDragOriginX;
      const nextY = touch.clientY - this.viewerDragOriginY;
      const now = Date.now();
      const dt = Math.max(1, now - this.viewerDragLastTs);
      this.viewerPanVx = (nextX - this.viewerPanX) / dt;
      this.viewerPanVy = (nextY - this.viewerPanY) / dt;
      this.viewerDragLastTs = now;
      this.applyViewerPan(nextX, nextY, host);
    }
  }

  onViewerTouchEnd() {
    if (this.viewerDragging && this.viewerZoom > 1.01 && (Math.abs(this.viewerPanVx) > 0.05 || Math.abs(this.viewerPanVy) > 0.05)) {
      this.startViewerMomentum();
    }
    this.viewerDragging = false;
    this.viewerPinchDistance = 0;
    if (this.viewerZoom <= 1.01 && this.viewerDialogRef) {
      const dy = this.viewerTouchLastY - this.viewerSwipeStartY;
      const dx = Math.abs(this.viewerTouchLastX - this.viewerSwipeStartX);
      if (dy > 120 && dx < 80) {
        this.viewerDialogRef.close();
      }
    }
    if (this.viewerZoom <= 1.01) {
      this.resetViewerZoom();
    }
  }

  private startViewerMomentum() {
    const step = () => {
      if (!this.imageViewerTarget || this.viewerZoom <= 1.01) {
        this.stopViewerMomentum();
        return;
      }
      const host = document.querySelector('.cdk-overlay-pane [data-viewer-stage="true"]') as HTMLElement | null;
      if (!host) {
        this.stopViewerMomentum();
        return;
      }

      this.viewerPanVx *= 0.92;
      this.viewerPanVy *= 0.92;
      if (Math.abs(this.viewerPanVx) < 0.01 && Math.abs(this.viewerPanVy) < 0.01) {
        this.stopViewerMomentum();
        return;
      }

      this.applyViewerPan(
        this.viewerPanX + (this.viewerPanVx * 16),
        this.viewerPanY + (this.viewerPanVy * 16),
        host
      );
      this.viewerMomentumRaf = requestAnimationFrame(step);
    };

    this.stopViewerMomentum();
    this.viewerMomentumRaf = requestAnimationFrame(step);
  }

  private stopViewerMomentum() {
    if (!this.viewerMomentumRaf) return;
    cancelAnimationFrame(this.viewerMomentumRaf);
    this.viewerMomentumRaf = null;
  }

  private showZoomHud() {
    this.viewerZoomHudVisible = true;
    if (this.viewerZoomHudTimer) clearTimeout(this.viewerZoomHudTimer);
    this.viewerZoomHudTimer = setTimeout(() => {
      this.viewerZoomHudVisible = false;
      this.viewerZoomHudTimer = null;
    }, 900);
  }

  private applyViewerPan(nextX: number, nextY: number, host: HTMLElement | null) {
    if (!host || this.viewerZoom <= 1) {
      this.viewerPanX = 0;
      this.viewerPanY = 0;
      return;
    }

    const rect = host.getBoundingClientRect();
    const maxX = ((rect.width * this.viewerZoom) - rect.width) / 2;
    const maxY = ((rect.height * this.viewerZoom) - rect.height) / 2;
    this.viewerPanX = Math.max(-maxX, Math.min(maxX, nextX));
    this.viewerPanY = Math.max(-maxY, Math.min(maxY, nextY));
  }

  private zoomToPoint(clientX: number, clientY: number, nextZoom: number, host: HTMLElement) {
    const rect = host.getBoundingClientRect();
    const centerX = rect.left + (rect.width / 2);
    const centerY = rect.top + (rect.height / 2);
    const currentZoom = Math.max(1, this.viewerZoom);
    const imagePointX = (clientX - centerX - this.viewerPanX) / currentZoom;
    const imagePointY = (clientY - centerY - this.viewerPanY) / currentZoom;

    this.viewerZoom = Math.max(1, Math.min(4, Number(nextZoom.toFixed(2))));
    const panX = clientX - centerX - (imagePointX * this.viewerZoom);
    const panY = clientY - centerY - (imagePointY * this.viewerZoom);
    this.applyViewerPan(panX, panY, host);
  }

  private touchDistance(a: Touch, b: Touch): number {
    const dx = a.clientX - b.clientX;
    const dy = a.clientY - b.clientY;
    return Math.sqrt((dx * dx) + (dy * dy));
  }

  viewerMetadataChips(): string[] {
    const a = this.viewerCurrentAttachment();
    if (!a) return [];
    const chips: string[] = [];
    chips.push(this.attachmentTypeLabel(a));
    chips.push(this.attachmentSizeLabel(a.size));
    if (this.isVideoAttachment(a) && Number(a.durationSeconds) > 0) {
      chips.push(this.attachmentDurationLabel(a));
    }
    if (Number(a.width) > 0 && Number(a.height) > 0) {
      chips.push(`${a.width}x${a.height}`);
    }
    return chips;
  }

  privateMediaTimelineItems(): Array<{ message: ChatMessage; attachment: Attachment }> {
    if (!this.selectedUser) return [];
    const all = (this.privateChats[this.selectedUser] || [])
      .flatMap((message) => this.messageAttachments(message)
        .filter((attachment) => this.canPreviewMediaAttachment(attachment))
        .map((attachment) => ({ message, attachment }))
      )
      .reverse();

    const base = all.length > 300 ? all.slice(0, 300) : all;

    if (this.privateMediaTimelineFilter === 'all') return base;
    if (this.privateMediaTimelineFilter === 'image') {
      return base.filter((item) => !!item.attachment.isImage);
    }
    return base.filter((item) => this.isVideoAttachment(item.attachment));
  }

  privateMediaTimelineCount(): number {
    return this.privateMediaTimelineItems().length;
  }

  clearPrivateMediaTimelineFilter() {
    this.privateMediaTimelineFilter = 'all';
  }

  togglePrivateMediaTimelineCollapse() {
    this.privateMediaTimelineCollapsed = !this.privateMediaTimelineCollapsed;
  }

  privateMediaTimelineHiddenCount(): number {
    if (!this.selectedUser) return 0;
    const total = (this.privateChats[this.selectedUser] || [])
      .flatMap((message) => this.messageAttachments(message).filter((attachment) => this.canPreviewMediaAttachment(attachment)))
      .length;
    return Math.max(0, total - 300);
  }

  privateMediaTimelineGroups(): Array<{ label: string; items: Array<{ message: ChatMessage; attachment: Attachment }> }> {
    const items = this.privateMediaTimelineItems();
    if (!items.length) return [];

    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startYesterday = startToday - (24 * 60 * 60 * 1000);
    const groups = new Map<string, Array<{ message: ChatMessage; attachment: Attachment }>>();

    items.forEach((item) => {
      const ts = new Date(item.message.timestamp || 0).getTime();
      const label = ts >= startToday
        ? 'Today'
        : ts >= startYesterday
          ? 'Yesterday'
          : 'Older';
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(item);
    });

    return ['Today', 'Yesterday', 'Older']
      .map((label) => ({ label, items: groups.get(label) || [] }))
      .filter((group) => group.items.length > 0);
  }

  jumpToTimelineMessage(message: ChatMessage, event?: Event) {
    event?.stopPropagation();
    if (!message?.id) return;
    this.scrollToMessage(message.id);
  }

  openTimelineAttachment(item: { message: ChatMessage; attachment: Attachment }, event?: Event) {
    event?.preventDefault();
    event?.stopPropagation();
    if (!item?.message || !item?.attachment) {
      this.pushUploadError('Timeline open failed: invalid media item.');
      return;
    }

    const attachment = item.attachment;
    const mime = String(attachment.mimeType || '').toLowerCase();
    const isImageLike = !!attachment.isImage || mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(String(attachment.name || attachment.url || ''));
    const isVideoLike = this.isVideoAttachment(attachment) || /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(String(attachment.name || attachment.url || ''));
    if (!isImageLike && !isVideoLike) {
      this.pushUploadError(`Timeline open blocked: unsupported preview type (${attachment.mimeType || 'unknown'}).`);
      return;
    }

    const message = item.message;
    const openKey = `${message?.id || message?.timestamp || 'unknown'}|${attachment?.url || 'unknown'}`;
    const now = Date.now();
    if (this.timelineLastOpenKey === openKey && now - this.timelineLastOpenAt < 260) return;
    this.timelineLastOpenKey = openKey;
    this.timelineLastOpenAt = now;

    const media = this.messageAttachments(message).filter((a) => this.canPreviewMediaAttachment(a));
    const mediaList = media.length ? media : [{ ...attachment, isImage: isImageLike } as Attachment];
    const index = Math.max(0, mediaList.findIndex((m) => m.url === attachment.url));

    this.imageViewerTarget = {
      message: { ...message, attachment: { ...attachment, isImage: isImageLike } },
      scope: 'private',
      media: mediaList,
      index
    };
    this.resetViewerZoom();
    this.prefetchViewerNeighbors();

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

  onTimelineThumbPointerDown(item: { message: ChatMessage; attachment: Attachment }, event: PointerEvent) {
    if (!item?.message || !item?.attachment) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.timelineThumbPointerDown = {
      key: this.timelineAttachmentKey(item),
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      at: Date.now()
    };
  }

  onTimelineThumbPointerUp(item: { message: ChatMessage; attachment: Attachment }, event: PointerEvent) {
    const down = this.timelineThumbPointerDown;
    this.timelineThumbPointerDown = null;
    if (!down) return;
    if (down.pointerId !== event.pointerId) return;
    if (down.key !== this.timelineAttachmentKey(item)) return;

    const dx = Math.abs(event.clientX - down.x);
    const dy = Math.abs(event.clientY - down.y);
    const elapsed = Date.now() - down.at;
    const isTap = dx <= 8 && dy <= 8 && elapsed <= 700;
    if (!isTap) return;

    this.openTimelineAttachment(item, event);
  }

  onTimelineThumbClick(item: { message: ChatMessage; attachment: Attachment }, event: MouseEvent) {
    const detail = typeof event.detail === 'number' ? event.detail : 0;
    if (detail === 0) {
      this.openTimelineAttachment(item, event);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  }

  clearTimelineThumbPointerState() {
    this.timelineThumbPointerDown = null;
  }

  togglePrivateMediaTimeline() {
    if (!this.selectedUser) return;
    this.privateMediaTimelineOpen = !this.privateMediaTimelineOpen;
    if (!this.privateMediaTimelineOpen) this.privateMediaTimelineCollapsed = false;
  }

  private timelineAttachmentKey(item: { message: ChatMessage; attachment: Attachment }): string {
    const messageId = item?.message?.id || item?.message?.timestamp || 'unknown';
    const url = item?.attachment?.url || item?.attachment?.name || 'unknown';
    return `${messageId}|${url}`;
  }

  toggleAutoplayMediaPreviews() {
    this.autoplayMediaPreviews = !this.autoplayMediaPreviews;
    if (!this.autoplayMediaPreviews) {
      const videos = Array.from(document.querySelectorAll('video[data-preview-key]')) as HTMLVideoElement[];
      videos.forEach((video) => {
        try {
          video.pause();
        } catch {
          // no-op
        }
      });
    }
    this.persistUploadUiState();
  }

  toggleAutoOpenPrivateMediaTimeline() {
    this.autoOpenPrivateMediaTimeline = !this.autoOpenPrivateMediaTimeline;
    this.persistUploadUiState();
  }

  toggleHideMediaPreviewsByDefault() {
    this.hideMediaPreviewsByDefault = !this.hideMediaPreviewsByDefault;
    this.hiddenAttachmentPreviewKeys.clear();
    this.shownAttachmentPreviewKeys.clear();
    this.shownAlbumPreviewKeys.clear();
    this.persistUploadUiState();
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

  reportAttachmentFromViewer(reasonKey: string = 'other') {
    const target = this.imageViewerTarget;
    const current = this.viewerCurrentAttachment();
    const messageId = target?.message?.id;
    const attachmentUrl = this.attachmentUrl(current);
    if (!target || !messageId || !attachmentUrl) return;

    const headers = this.getAuthHeaders();
    if (!headers) return;

    const selected = this.reportReasonOptions.find((x) => x.key === reasonKey) || this.reportReasonOptions[this.reportReasonOptions.length - 1];
    const note = window.prompt('Optional note for moderation (leave blank to skip):', '') || '';

    this.http.post(`${environment.apiUrl}/api/attachments/report`, {
      messageId,
      scope: target.scope,
      attachmentUrl,
      reason: `User report: ${selected.label}`,
      category: selected.key,
      severity: selected.severity,
      note: String(note || '').trim().slice(0, 280)
    }, { headers }).subscribe({
      next: () => {
        this.viewerNotice = `Report submitted (${selected.label}). Thanks for helping keep chat safe.`;
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

    this.searchInputText = this.searchTextFromQuery(this.messageSearchQuery);
    setTimeout(() => this.searchInput?.nativeElement.focus(), 0);
  }

  onSearchTextInput(value: string) {
    const text = String(value || '');
    this.searchInputText = text;
    this.messageSearchQuery = this.composeSearchQuery(text, this.searchFilterChips());
    this.onMessageSearchInput();
  }

  onMessageSearchInput(autoJumpToFirstMatch = true) {
    if (!this.searchOpen) return;
    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);

    const q = this.messageSearchQuery.trim();
    if (!q) {
      this.searchMatchIds = [];
      this.currentSearchMatchIndex = -1;
      return;
    }

    this.searchDebounceTimer = setTimeout(() => {
      this.searchMessages(q, autoJumpToFirstMatch);
    }, 220);
  }

  clearMessageSearch() {
    this.searchInputText = '';
    this.messageSearchQuery = '';
    this.searchMatchIds = [];
    this.currentSearchMatchIndex = -1;
  }

  applySearchPresetFromMenu(preset: string) {
    const nextPreset = String(preset || '').trim().toLowerCase();
    if (!nextPreset) return;
    this.ignoreNextDocumentClick = true;
    this.searchOpen = true;
    this.messageSearchQuery = nextPreset;
    this.searchInputText = this.searchTextFromQuery(this.messageSearchQuery);
    this.onMessageSearchInput(false);
    setTimeout(() => this.searchInput?.nativeElement.focus(), 0);
  }

  applySearchFilterTokenFromMenu(token: string) {
    this.toggleSearchFilterTokenFromMenu(token);
  }

  toggleSearchFilterTokenFromMenu(token: string) {
    const nextToken = String(token || '').trim().toLowerCase();
    if (!nextToken) return;

    this.ignoreNextDocumentClick = true;
    this.searchOpen = true;

    const textPart = this.searchTextFromQuery(this.messageSearchQuery || this.searchInputText || '');
    this.searchInputText = textPart;
    const tokens = this.searchFilterChips();

    const alreadyActive = tokens.some((existing) => existing.toLowerCase() === nextToken);
    const nextTokens = alreadyActive
      ? tokens.filter((existing) => existing.toLowerCase() !== nextToken)
      : [...tokens.filter((existing) => this.isSearchTokenCompatible(existing, nextToken)), nextToken];

    this.messageSearchQuery = this.composeSearchQuery(textPart, nextTokens);
    this.onMessageSearchInput(false);
    setTimeout(() => this.searchInput?.nativeElement.focus(), 0);
  }

  resetSearchFilters() {
    this.ignoreNextDocumentClick = true;
    const textPart = this.searchTextFromQuery(this.messageSearchQuery || this.searchInputText || '');
    this.searchInputText = textPart;
    this.messageSearchQuery = this.composeSearchQuery(textPart, []);
    this.onMessageSearchInput(false);
    setTimeout(() => this.searchInput?.nativeElement.focus(), 0);
  }

  searchFilterCount(): number {
    return this.searchFilterChips().length;
  }

  hasSearchFilterToken(token: string): boolean {
    const normalized = String(token || '').trim().toLowerCase();
    if (!normalized) return false;
    return this.searchFilterChips().includes(normalized);
  }

  onSearchFilterMenuOpened() {
    this.searchFilterMenuOpen = true;
  }

  onSearchFilterMenuClosed() {
    this.searchFilterMenuOpen = false;
    this.ignoreNextDocumentClick = true;
  }

  searchFilterChips(): string[] {
    return String(this.messageSearchQuery || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => token.toLowerCase())
      .filter((token) =>
        token === 'has:media' ||
        token === 'has:attachment' ||
        token.startsWith('from:') ||
        token.startsWith('type:') ||
        token.startsWith('size:') ||
        token.startsWith('duration:')
      );
  }

  removeSearchFilterChip(chip: string) {
    const target = String(chip || '').trim().toLowerCase();
    if (!target) return;

    const textPart = this.searchTextFromQuery(this.messageSearchQuery || this.searchInputText || '');
    this.searchInputText = textPart;
    const tokens = this.searchFilterChips();
    let removed = false;
    const nextTokens = tokens.filter((token) => {
      if (!removed && token.toLowerCase() === target) {
        removed = true;
        return false;
      }
      return true;
    });

    if (!removed) return;
    this.messageSearchQuery = this.composeSearchQuery(textPart, nextTokens);
    if (this.searchOpen) this.onMessageSearchInput();
  }

  searchFilterIcon(token: string): string {
    const normalized = String(token || '').toLowerCase();
    if (normalized === 'has:media') return 'photo_library';
    if (normalized === 'has:attachment') return 'attach_file';
    if (normalized.startsWith('type:image')) return 'image';
    if (normalized.startsWith('type:video')) return 'movie';
    if (normalized.startsWith('type:audio')) return 'audiotrack';
    if (normalized.startsWith('type:document')) return 'description';
    if (normalized.startsWith('from:')) return 'person';
    if (normalized.startsWith('size:')) return 'straighten';
    if (normalized.startsWith('duration:')) return 'timer';
    return 'tune';
  }

  searchFilterLabel(token: string): string {
    const normalized = String(token || '').toLowerCase();
    if (normalized === 'has:media') return 'Filter: has media';
    if (normalized === 'has:attachment') return 'Filter: has attachment';
    if (normalized.startsWith('type:')) return `Filter: ${normalized.replace('type:', '')}`;
    if (normalized.startsWith('from:')) return `Filter: sender ${normalized.replace('from:', '')}`;
    if (normalized.startsWith('size:')) return `Filter: size ${normalized.replace('size:', '')}`;
    if (normalized.startsWith('duration:')) return `Filter: duration ${normalized.replace('duration:', '')}`;
    return `Filter: ${normalized}`;
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
    const q = this.parseSearchQuery(this.messageSearchQuery).text;
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

  displayedThreadMessages(): ChatMessage[] {
    const thread = this.currentThread();
    if (thread.length <= this.threadRenderLimit) return thread;
    return thread.slice(thread.length - this.threadRenderLimit);
  }

  hiddenThreadMessageCount(): number {
    const total = this.currentThread().length;
    return Math.max(0, total - this.displayedThreadMessages().length);
  }

  loadMoreThreadMessages() {
    this.threadRenderLimit = Math.min(1200, this.threadRenderLimit + 120);
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
      !this.searchFilterMenuOpen &&
      !target.closest('.searchShell') &&
      !target.closest('.searchPresetMenuPanel')
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
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      this.viewerZoomIn();
    }
    if (event.key === '-') {
      event.preventDefault();
      this.viewerZoomOut();
    }
    if (event.key.toLowerCase() === '0') {
      event.preventDefault();
      this.viewerZoomReset();
    }
    if (event.key === '?' && this.imageViewerTarget) {
      event.preventDefault();
      this.showViewerShortcutHints = !this.showViewerShortcutHints;
    }
  }

  @HostListener('document:visibilitychange')
  onDocumentVisibilityChange() {
    if (document.visibilityState !== 'hidden') return;
    const videos = Array.from(document.querySelectorAll('video[data-preview-key]')) as HTMLVideoElement[];
    videos.forEach((video) => {
      try {
        video.pause();
      } catch {
        // no-op
      }
    });
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
              width: Number(message.replyTo.attachment.width || 0) || undefined,
              height: Number(message.replyTo.attachment.height || 0) || undefined,
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
              width: Number(message.forwardedFrom.attachment.width || 0) || undefined,
              height: Number(message.forwardedFrom.attachment.height || 0) || undefined,
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
          width: Number(message.attachment.width || 0) || undefined,
          height: Number(message.attachment.height || 0) || undefined,
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
            width: Number(a.width || 0) || undefined,
            height: Number(a.height || 0) || undefined,
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

  private searchMessages(query: string, autoJumpToFirstMatch = true) {
    const parsed = this.parseSearchQuery(query);
    const q = parsed.text.toLowerCase();
    this.searchMatchIds = this.currentThread()
      .filter((m) => !!m.id)
      .filter((m) => {
        const textMatch = !q || String(m.text ?? '').toLowerCase().includes(q);
        return textMatch && this.messageMatchesSearchFilters(m, parsed);
      })
      .map((m) => m.id);

    if (!this.searchMatchIds.length) {
      this.currentSearchMatchIndex = -1;
      return;
    }

    this.currentSearchMatchIndex = 0;
    if (autoJumpToFirstMatch) {
      this.scrollToMessage(this.searchMatchIds[0]);
    }
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

  private parseSearchQuery(raw: string): {
    text: string;
    hasMedia: boolean;
    hasAttachment: boolean;
    types: Array<'image' | 'video' | 'audio' | 'document'>;
    fromUser: string;
    minSizeBytes: number;
    minDurationSeconds: number;
  } {
    const tokens = String(raw || '').trim().split(/\s+/).filter(Boolean);
    const textParts: string[] = [];
    let hasMedia = false;
    let hasAttachment = false;
    let fromUser = '';
    let minSizeBytes = 0;
    let minDurationSeconds = 0;
    const types = new Set<'image' | 'video' | 'audio' | 'document'>();

    tokens.forEach((token) => {
      const normalized = token.toLowerCase();
      if (normalized === 'has:media') {
        hasMedia = true;
        return;
      }
      if (normalized === 'has:attachment') {
        hasAttachment = true;
        return;
      }
      if (normalized.startsWith('from:')) {
        fromUser = normalized.slice(5);
        return;
      }
      if (normalized.startsWith('type:')) {
        const value = normalized.slice(5);
        if (value === 'image' || value === 'video' || value === 'audio' || value === 'document') {
          types.add(value);
          return;
        }
      }
      if (normalized.startsWith('size:')) {
        minSizeBytes = this.parseSizeFilter(normalized.slice(5));
        return;
      }
      if (normalized.startsWith('duration:')) {
        minDurationSeconds = this.parseDurationFilter(normalized.slice(9));
        return;
      }
      textParts.push(token);
    });

    return {
      text: textParts.join(' ').trim(),
      hasMedia,
      hasAttachment,
      types: Array.from(types),
      fromUser,
      minSizeBytes,
      minDurationSeconds
    };
  }

  private messageMatchesSearchFilters(
    message: ChatMessage,
    filters: {
      hasMedia: boolean;
      hasAttachment: boolean;
      types: Array<'image' | 'video' | 'audio' | 'document'>;
      fromUser: string;
      minSizeBytes: number;
      minDurationSeconds: number;
    }
  ): boolean {
    if (filters.fromUser && String(message.from || '').toLowerCase() !== filters.fromUser) return false;

    const attachments = this.messageAttachments(message);
    if (!attachments.length) return !filters.hasMedia && !filters.hasAttachment && !filters.types.length && !filters.minSizeBytes && !filters.minDurationSeconds;

    const hasMediaAttachment = attachments.some((a) => a.isImage || this.isVideoAttachment(a));
    if (filters.hasMedia && !hasMediaAttachment) return false;
    if (filters.hasAttachment && !attachments.length) return false;
    if (filters.minSizeBytes > 0 && !attachments.some((a) => Number(a.size || 0) >= filters.minSizeBytes)) return false;
    if (filters.minDurationSeconds > 0 && !attachments.some((a) => Number(a.durationSeconds || 0) >= filters.minDurationSeconds)) return false;
    if (!filters.types.length) return true;

    return attachments.some((attachment) => {
      if (filters.types.includes('image') && attachment.isImage) return true;
      if (filters.types.includes('video') && this.isVideoAttachment(attachment)) return true;
      if (filters.types.includes('audio') && this.isAudioAttachment(attachment)) return true;
      if (
        filters.types.includes('document') &&
        !attachment.isImage &&
        !this.isVideoAttachment(attachment) &&
        !this.isAudioAttachment(attachment)
      ) {
        return true;
      }
      return false;
    });
  }

  private parseSizeFilter(raw: string): number {
    const match = String(raw || '').trim().match(/^>?\s*(\d+(?:\.\d+)?)(kb|mb|gb|b)?$/i);
    if (!match) return 0;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) return 0;
    const unit = String(match[2] || 'b').toLowerCase();
    if (unit === 'kb') return Math.round(value * 1024);
    if (unit === 'mb') return Math.round(value * 1024 * 1024);
    if (unit === 'gb') return Math.round(value * 1024 * 1024 * 1024);
    return Math.round(value);
  }

  private parseDurationFilter(raw: string): number {
    const match = String(raw || '').trim().match(/^>?\s*(\d+(?:\.\d+)?)(s|m)?$/i);
    if (!match) return 0;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value <= 0) return 0;
    const unit = String(match[2] || 's').toLowerCase();
    if (unit === 'm') return Math.round(value * 60);
    return Math.round(value);
  }

  private searchTextFromQuery(query: string): string {
    return this.parseSearchQuery(query).text;
  }

  private composeSearchQuery(text: string, tokens: string[]): string {
    const cleanText = String(text || '').trim();
    const cleanTokens = (tokens || [])
      .map((token) => String(token || '').trim().toLowerCase())
      .filter(Boolean);
    return [cleanText, ...cleanTokens].filter(Boolean).join(' ').trim();
  }

  private isSearchTokenCompatible(existingToken: string, incomingToken: string): boolean {
    const existing = String(existingToken || '').toLowerCase();
    const incoming = String(incomingToken || '').toLowerCase();
    if (!existing || !incoming) return true;
    if (existing === incoming) return false;
    if (incoming.startsWith('from:') && existing.startsWith('from:')) return false;
    if (incoming.startsWith('type:') && existing.startsWith('type:')) return false;
    if (incoming.startsWith('size:') && existing.startsWith('size:')) return false;
    if (incoming.startsWith('duration:') && existing.startsWith('duration:')) return false;
    return true;
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

  private loadUploadUiState() {
    try {
      const raw = localStorage.getItem(UPLOAD_UI_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        uploadQuality?: 'original' | 'balanced';
        autoplayMediaPreviews?: boolean;
        autoOpenPrivateMediaTimeline?: boolean;
        hideMediaPreviewsByDefault?: boolean;
        pendingAttachments?: Attachment[];
        uploadErrors?: string[];
        failedNames?: string[];
      };

      if (parsed.uploadQuality === 'original' || parsed.uploadQuality === 'balanced') {
        this.uploadQuality = parsed.uploadQuality;
      }
      if (typeof parsed.autoplayMediaPreviews === 'boolean') {
        this.autoplayMediaPreviews = parsed.autoplayMediaPreviews;
      }
      if (typeof parsed.autoOpenPrivateMediaTimeline === 'boolean') {
        this.autoOpenPrivateMediaTimeline = parsed.autoOpenPrivateMediaTimeline;
      }
      if (typeof parsed.hideMediaPreviewsByDefault === 'boolean') {
        this.hideMediaPreviewsByDefault = parsed.hideMediaPreviewsByDefault;
      }

      if (Array.isArray(parsed.pendingAttachments)) {
        this.pendingAttachments = parsed.pendingAttachments
          .map((a) => {
            if (!a?.url) return null;
            return {
              url: a.url,
              name: a.name || 'Attachment',
              mimeType: a.mimeType || 'application/octet-stream',
              size: Number(a.size || 0),
              isImage: !!a.isImage,
              durationSeconds: Number(a.durationSeconds || 0) || undefined,
              width: Number(a.width || 0) || undefined,
              height: Number(a.height || 0) || undefined,
              storageProvider: a.storageProvider,
              objectKey: a.objectKey
            } as Attachment;
          })
          .filter((x): x is Attachment => !!x)
          .slice(0, 20);
      }

      if (Array.isArray(parsed.uploadErrors)) {
        this.uploadErrors = parsed.uploadErrors.filter((x) => typeof x === 'string').slice(0, 4);
      }

      if (Array.isArray(parsed.failedNames)) {
        this.persistedFailedUploadNames = parsed.failedNames.filter((x) => typeof x === 'string').slice(0, 8);
      }
    } catch {
      // no-op
    }
  }

  private persistUploadUiState() {
    try {
      const payload = {
        uploadQuality: this.uploadQuality,
        autoplayMediaPreviews: this.autoplayMediaPreviews,
        autoOpenPrivateMediaTimeline: this.autoOpenPrivateMediaTimeline,
        hideMediaPreviewsByDefault: this.hideMediaPreviewsByDefault,
        pendingAttachments: this.pendingAttachments.slice(0, 20),
        uploadErrors: this.uploadErrors.slice(0, 4),
        failedNames: this.persistedFailedUploadNames.slice(0, 8)
      };
      localStorage.setItem(UPLOAD_UI_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // no-op
    }
  }

  private loadChunkRecoveryState() {
    try {
      const raw = localStorage.getItem(CHUNK_UPLOAD_RECOVERY_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, any>;
      if (!parsed || typeof parsed !== 'object') return;

      const now = Date.now();
      this.chunkRecovery = Object.entries(parsed).reduce((acc, [k, v]) => {
        if (!v || typeof v !== 'object') return acc;
        const updatedAt = Number(v.updatedAt || 0);
        if (!updatedAt || now - updatedAt > this.uploadResumeTtlMs) return acc;
        acc[k] = {
          sessionId: String(v.sessionId || ''),
          fileName: String(v.fileName || ''),
          size: Number(v.size || 0),
          mimeType: String(v.mimeType || 'application/octet-stream'),
          totalChunks: Number(v.totalChunks || 0),
          uploadedChunks: Array.isArray(v.uploadedChunks) ? v.uploadedChunks.map((x: any) => Number(x)).filter((x: number) => Number.isInteger(x) && x >= 0) : [],
          failedChunks: Array.isArray(v.failedChunks) ? v.failedChunks.map((x: any) => Number(x)).filter((x: number) => Number.isInteger(x) && x >= 0) : [],
          updatedAt
        };
        return acc;
      }, {} as typeof this.chunkRecovery);

      this.persistChunkRecoveryState();
      const recovered = Object.values(this.chunkRecovery)
        .filter((x) => x.fileName)
        .map((x) => `${x.fileName}${x.failedChunks.length ? ` (failed chunk ${x.failedChunks[0] + 1})` : ''}`);
      if (recovered.length) {
        this.pushUploadError('Recovered interrupted large uploads. Re-select those files to resume.');
        this.persistedFailedUploadNames = Array.from(new Set([...recovered, ...this.persistedFailedUploadNames])).slice(0, 8);
      }
    } catch {
      this.chunkRecovery = {};
    }
  }

  private persistChunkRecovery(key: string, value: {
    sessionId: string;
    fileName: string;
    size: number;
    mimeType: string;
    totalChunks: number;
    uploadedChunks: number[];
    failedChunks: number[];
    updatedAt: number;
  }) {
    this.chunkRecovery[key] = value;
    this.persistChunkRecoveryState();
  }

  private clearChunkRecovery(key: string) {
    if (!this.chunkRecovery[key]) return;
    delete this.chunkRecovery[key];
    this.persistChunkRecoveryState();
  }

  private persistChunkRecoveryState() {
    try {
      const entries = Object.entries(this.chunkRecovery)
        .filter(([, v]) => Date.now() - Number(v.updatedAt || 0) <= this.uploadResumeTtlMs);
      if (!entries.length) {
        localStorage.removeItem(CHUNK_UPLOAD_RECOVERY_KEY);
        return;
      }
      localStorage.setItem(CHUNK_UPLOAD_RECOVERY_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
      // no-op
    }
  }

  resumableUploadsList(): Array<{ key: string; fileName: string; failedChunks: number[]; uploadedChunks: number[]; totalChunks: number; updatedAt: number }> {
    return Object.entries(this.chunkRecovery)
      .map(([key, value]) => ({ key, value }))
      .filter(({ value }) => !!value?.fileName && !!value?.sessionId && Number(value.totalChunks || 0) > 0)
      .sort((a, b) => Number(b.value.updatedAt || 0) - Number(a.value.updatedAt || 0))
      .map(({ key, value }) => ({
        key,
        fileName: String(value.fileName || ''),
        failedChunks: this.uniqueChunkIndexes(value.failedChunks || []),
        uploadedChunks: this.uniqueChunkIndexes(value.uploadedChunks || []),
        totalChunks: Math.max(1, Number(value.totalChunks || 0)),
        updatedAt: Number(value.updatedAt || 0)
      }));
  }

  resumableProgressPercent(uploadedChunks: number[], totalChunks: number): number {
    const total = Math.max(1, Number(totalChunks || 0));
    const uploaded = this.uniqueChunkIndexes(uploadedChunks).length;
    return Math.max(0, Math.min(100, Math.round((uploaded / total) * 100)));
  }

  formatChunkIndexes(chunks: number[]): string {
    return this.uniqueChunkIndexes(chunks)
      .map((index) => String(index + 1))
      .join(', ');
  }

  removeResumableUpload(key: string) {
    if (!key) return;
    this.clearChunkRecovery(key);
  }

  clearResumableUploadsList() {
    this.chunkRecovery = {};
    this.persistChunkRecoveryState();
  }

  private uniqueChunkIndexes(chunks: number[]): number[] {
    return Array.from(new Set((chunks || []).filter((x) => Number.isInteger(x) && x >= 0))).sort((a, b) => a - b);
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
