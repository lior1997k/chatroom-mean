import { AfterViewChecked, Component, ElementRef, HostListener, TemplateRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpEventType, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import { SocketService } from '../../services/socket';
import { AuthService } from '../../services/auth';
import { environment } from '../../../environments/environment';
import { Attachment, ChatMessage } from '../../models/message.model';
import { ProfilePreviewComponent } from '../../components/profile-preview.component';

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
const VOICE_CACHE_INDEX_STORAGE_KEY = 'chatroom:voiceCacheIndex';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatSidenavModule, MatListModule, MatIconModule,
    MatButtonModule, MatInputModule, MatFormFieldModule,
    MatToolbarModule, MatMenuModule, MatDialogModule,
    MatDividerModule, MatCardModule, MatTooltipModule,
    ProfilePreviewComponent
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
  dateFormat: 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD' = 'MM/DD/YYYY';
  
  formatDate(date: Date | string | undefined): string {
    if (!date) return '';
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    
    switch (this.dateFormat) {
      case 'DD/MM/YYYY':
        return `${day}/${month}/${year}`;
      case 'YYYY-MM-DD':
        return `${year}-${month}-${day}`;
      default:
        return `${month}/${day}/${year}`;
    }
  }
  
  uploadingAttachment = false;
  uploadingAttachmentCount = 0;
  isRecordingVoice = false;
  voiceRecordingSeconds = 0;
  voiceDraft: {
    blob: Blob;
    mimeType: string;
    durationSeconds: number;
    trimStartSeconds: number;
    trimEndSeconds: number;
    normalize: boolean;
    waveform: number[];
    sampleRateHz?: number;
    channels?: number;
    bitrateKbps?: number;
  } | null = null;
  voiceDraftPreviewUrl: string | null = null;
  voiceDraftPreviewCurrentTime = 0;
  voiceDraftPreviewPlaying = false;
  voiceDraftProcessing = false;
  voiceKeyboardControlsEnabled = true;
  offlineVoiceCacheEnabled = true;
  private voiceDraftTrimDrag: {
    pointerId: number;
    handle: 'start' | 'end';
    host: HTMLElement | null;
  } | null = null;
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

  // Pinned users
  pinnedUsers: string[] = [];

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
    attachments: Attachment[];
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
    attachments: Attachment[];
  } | null = null;
  forwardSelectedUsers: string[] = [];
  forwardSearchTerm = '';
  forwardNote = '';

  private reactionPressTimer: ReturnType<typeof setTimeout> | null = null;
  private ignoreNextDocumentClick = false;
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private userChipStyleCache: Record<string, Record<string, string>> = {};
  userAvatarUrlByUsername: Record<string, string> = {};
  userPublicProfileByUsername: Record<string, any> = {};
  private userProfileLookupBusy = new Set<string>();
  userProfileCardOpen = false;
  userProfileCardLoading = false;
  userProfileCardUsername = '';
  userProfileCardData: any = null;
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
  @ViewChild('voiceDraftAudio') voiceDraftAudio?: ElementRef<HTMLAudioElement>;
  deleteCandidate: { id: string; scope: 'public' | 'private'; preview: string } | null = null;
  imageViewerTarget: {
    message: ChatMessage;
    scope: 'public' | 'private';
    media: Attachment[];
    index: number;
  } | null = null;
  attachmentMenuTarget: ChatMessage['attachment'] | null = null;
  voiceMenuTarget: ChatMessage['attachment'] | null = null;
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
  private voicePlaybackRateByKey: Record<string, number> = {};
  private voiceUiStateByKey: Record<string, { currentTime: number; duration: number; playing: boolean; muted: boolean; volume: number }> = {};
  private voiceWaveformByKey: Record<string, number[]> = {};
  private voiceWaveformQualityByKey: Record<string, 'real' | 'fallback'> = {};
  private voiceWaveformLoading = new Set<string>();
  private voiceWaveformZoomByKey: Record<string, number> = {};
  private voiceDurationResolveLoading = new Set<string>();
  private voiceLastNonZeroVolumeByKey: Record<string, number> = {};
  private voiceAutoPlayNext = true;
  private voiceSilenceSkipEnabled = false;
  private voiceInsightsByKey: Record<string, { bitrateKbps?: number; sampleRateHz?: number; channels?: number }> = {};
  private voiceInsightsLoading = new Set<string>();
  private voiceSilenceRangesByKey: Record<string, Array<{ start: number; end: number }>> = {};
  private voiceLastSilenceSkipAtByKey: Record<string, number> = {};
  private activeVoiceKey: string | null = null;
  private voiceAttachmentByKey: Record<string, Attachment> = {};
  private referenceAudioIndexByKey: Record<string, number> = {};
  private readonly defaultVoiceWaveform = [4, 5, 6, 7, 8, 10, 11, 9, 8, 7, 6, 5, 4, 6, 8, 10, 12, 11, 9, 8, 6, 5, 4, 4, 5, 6, 7, 8, 9, 11, 12, 10, 8, 7, 6, 5, 4, 5, 6, 8, 9, 11, 10, 8, 7, 6, 5, 4];
  private voiceRecorder: MediaRecorder | null = null;
  private voiceRecorderStream: MediaStream | null = null;
  private voiceRecorderChunks: BlobPart[] = [];
  private voiceRecordingTimer: ReturnType<typeof setInterval> | null = null;
  private voiceRecordingCancelled = false;
  private voiceRecordingStartedAt = 0;
  private voiceWaveformScrub: { pointerId: number; key: string; host: HTMLElement | null } | null = null;
  private voicePendingSeekRatioByKey: Record<string, number> = {};
  private voiceProgressTimers = new Map<string, ReturnType<typeof setInterval>>();
  private voiceVolumeHoverKey: string | null = null;
  private voiceAudioElementByKey = new Map<string, HTMLAudioElement>();
  private voiceOfflineCacheIndex: Array<{ url: string; cachedAt: number }> = [];
  private voiceOfflineCachedUrlSet = new Set<string>();
  private voiceOfflineBlobUrlBySource: Record<string, string> = {};
  private voiceOfflineCacheLoading = new Set<string>();
  private voicePlaybackEmitStateByMessageId: Record<string, { at: number; progress: number }> = {};
  private readonly voiceOfflineCacheStore = 'chatroom-voice-audio-v1';
  private readonly voiceOfflineCacheLimit = 36;
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
    public dialog: MatDialog,
    private sanitizer: DomSanitizer
  ) {}

  getUserSocialSvgSafe(platform: string): SafeHtml {
    const svg = this.getUserSocialSvg(platform);
    return this.sanitizer.bypassSecurityTrustHtml(svg);
  }

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
    this.loadVoiceOfflineCacheIndex();
    this.loadUserPreferences();
    this.message = this.draftForContext(null);
    this.loadUnreadCounts();
    this.loadPublicMessages();
    this.ensureUserProfile(this.myUsername);

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
        this.ensureUserProfile(normalized.from);
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
      this.ensureUserProfile(normalized.from);
      this.ensureUserProfile(normalized.to);
      this.ensureUserProfile(other);

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

    this.socket.onEvent<{
      id: string;
      by: string;
      progress: number;
      currentTimeSeconds?: number;
      durationSeconds?: number;
      attachmentKey?: string;
      listenedAt?: string | null;
    }>('privateAudioPlayback').subscribe((payload) => {
      this.applyPrivateAudioPlaybackReceipt(payload);
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
      this.onlineUsers.forEach((u) => this.ensureUserProfile(u));
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
    this.stopVoiceRecording(true);
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
    this.voiceProgressTimers.forEach((t) => clearInterval(t));
    this.voiceProgressTimers.clear();
    this.discardVoiceDraft();
    this.previewVisibilityObserver?.disconnect();
    this.previewVisibilityObserver = null;
    this.stopViewerMomentum();
    if (this.viewerZoomHudTimer) clearTimeout(this.viewerZoomHudTimer);
    this.stopHourglassAnimation();
    Object.values(this.voiceOfflineBlobUrlBySource).forEach((blobUrl) => {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch {
        // no-op
      }
    });
    this.voiceOfflineBlobUrlBySource = {};
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
    this.ensureUserProfile(username);
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
        this.privateChats[username].forEach((m) => {
          this.ensureUserProfile(m.from);
          this.ensureUserProfile(m.to);
        });
        this.ensureUserProfile(username);
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

  async toggleVoiceRecording() {
    if (this.isRecordingVoice) {
      this.stopVoiceRecording(false);
      return;
    }
    if (this.voiceDraft && !this.voiceDraftProcessing) {
      this.discardVoiceDraft();
    }
    await this.startVoiceRecording();
  }

  private async startVoiceRecording() {
    if (this.uploadingAttachment || this.isRecordingVoice) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      this.pushUploadError('Voice recording is not supported in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = this.preferredVoiceMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      this.voiceRecorderChunks = [];
      this.voiceRecorder = recorder;
      this.voiceRecorderStream = stream;
      this.voiceRecordingCancelled = false;
      this.voiceRecordingStartedAt = Date.now();
      this.isRecordingVoice = true;
      this.voiceRecordingSeconds = 0;

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) this.voiceRecorderChunks.push(event.data);
      };

      recorder.onstop = () => {
        void this.finishVoiceRecording();
      };

      recorder.start(250);
      this.voiceRecordingTimer = setInterval(() => {
        this.voiceRecordingSeconds += 1;
      }, 1000);
    } catch {
      this.pushUploadError('Microphone permission is required to record voice notes.');
      this.cleanupVoiceRecordingResources();
    }
  }

  stopVoiceRecording(cancel = false) {
    if (!this.voiceRecorder) return;

    this.voiceRecordingCancelled = cancel;
    this.isRecordingVoice = false;
    if (this.voiceRecordingTimer) {
      clearInterval(this.voiceRecordingTimer);
      this.voiceRecordingTimer = null;
    }

    if (this.voiceRecorder.state !== 'inactive') {
      this.voiceRecorder.stop();
    } else {
      this.cleanupVoiceRecordingResources();
    }
  }

  voiceRecordingLabel(): string {
    return this.formatDuration(this.voiceRecordingSeconds);
  }

  private async finishVoiceRecording() {
    const elapsedSeconds = this.voiceRecordingStartedAt > 0
      ? Math.max(1, Math.round((Date.now() - this.voiceRecordingStartedAt) / 1000))
      : Math.max(1, Math.round(this.voiceRecordingSeconds));
    const recorder = this.voiceRecorder;
    const chunks = this.voiceRecorderChunks.slice();
    const cancelled = this.voiceRecordingCancelled;
    const mimeType = String(recorder?.mimeType || 'audio/webm').trim() || 'audio/webm';
    this.cleanupVoiceRecordingResources();

    if (cancelled) return;
    if (!chunks.length) {
      this.pushUploadError('No audio captured. Please try recording again.');
      return;
    }

    const blob = new Blob(chunks, { type: mimeType });
    if (blob.size < 1200) {
      this.pushUploadError('Voice note is too short. Hold the button a bit longer.');
      return;
    }

    await this.openVoiceDraft(blob, mimeType, elapsedSeconds);
  }

  private async openVoiceDraft(blob: Blob, mimeType: string, durationHintSeconds = 0) {
    this.discardVoiceDraft();
    const decoded = await this.decodeAudioBufferFromBlob(blob);
    const decodedDuration = Number(decoded?.duration || 0);
    const durationSeconds = Number.isFinite(decodedDuration) && decodedDuration > 0
      ? decodedDuration
      : Math.max(1, Number(durationHintSeconds || 0));
    const firstChannel = decoded && decoded.numberOfChannels > 0 ? decoded.getChannelData(0) : null;
    const waveform = firstChannel?.length
      ? this.buildWaveformFromChannelData(firstChannel, 96)
      : this.defaultVoiceWaveform;
    const bitrateKbps = this.approximateAudioBitrateKbps(Number(blob.size || 0), durationSeconds);

    this.voiceDraft = {
      blob,
      mimeType: String(mimeType || 'audio/webm').trim() || 'audio/webm',
      durationSeconds,
      trimStartSeconds: 0,
      trimEndSeconds: durationSeconds,
      normalize: true,
      waveform,
      sampleRateHz: Number(decoded?.sampleRate || 0) || undefined,
      channels: Number(decoded?.numberOfChannels || 0) || undefined,
      bitrateKbps: bitrateKbps || undefined
    };
    this.voiceDraftPreviewCurrentTime = 0;
    this.voiceDraftPreviewPlaying = false;
    this.voiceDraftPreviewUrl = URL.createObjectURL(blob);
  }

  discardVoiceDraft() {
    this.voiceDraftTrimDrag = null;
    const audio = this.voiceDraftAudioElement();
    if (audio) {
      audio.pause();
      try {
        audio.currentTime = 0;
      } catch {
        // no-op
      }
    }
    this.voiceDraft = null;
    this.voiceDraftPreviewCurrentTime = 0;
    this.voiceDraftPreviewPlaying = false;
    this.voiceDraftProcessing = false;
    if (this.voiceDraftPreviewUrl) {
      URL.revokeObjectURL(this.voiceDraftPreviewUrl);
      this.voiceDraftPreviewUrl = null;
    }
  }

  voiceDraftTrimDurationLabel(): string {
    if (!this.voiceDraft) return '0:00';
    const seconds = Math.max(0.1, Number(this.voiceDraft.trimEndSeconds || 0) - Number(this.voiceDraft.trimStartSeconds || 0));
    return this.formatDuration(Math.max(1, Math.round(seconds)));
  }

  voiceDraftSelectionStartPercent(): number {
    if (!this.voiceDraft) return 0;
    const duration = Math.max(0.1, Number(this.voiceDraft.durationSeconds || 0));
    return Math.max(0, Math.min(100, (Number(this.voiceDraft.trimStartSeconds || 0) / duration) * 100));
  }

  voiceDraftSelectionWidthPercent(): number {
    if (!this.voiceDraft) return 0;
    const duration = Math.max(0.1, Number(this.voiceDraft.durationSeconds || 0));
    const width = Math.max(0, Number(this.voiceDraft.trimEndSeconds || 0) - Number(this.voiceDraft.trimStartSeconds || 0));
    return Math.max(0, Math.min(100, (width / duration) * 100));
  }

  voiceDraftSelectionEndPercent(): number {
    if (!this.voiceDraft) return 100;
    const duration = Math.max(0.1, Number(this.voiceDraft.durationSeconds || 0));
    return Math.max(0, Math.min(100, (Number(this.voiceDraft.trimEndSeconds || duration) / duration) * 100));
  }

  startVoiceDraftTrimDrag(handle: 'start' | 'end', event: PointerEvent, host?: HTMLElement | null) {
    if (!this.voiceDraft) return;
    event.stopPropagation();
    event.preventDefault();

    const dragHost = host || (event.currentTarget as HTMLElement | null);
    this.voiceDraftTrimDrag = {
      pointerId: event.pointerId,
      handle,
      host: dragHost
    };

    if (dragHost?.setPointerCapture) {
      try {
        dragHost.setPointerCapture(event.pointerId);
      } catch {
        // no-op
      }
    }

    this.updateVoiceDraftTrimFromPointer(event, handle, dragHost);
  }

  onVoiceDraftTrimPointerMove(event: PointerEvent) {
    if (!this.voiceDraftTrimDrag) return;
    if (event.pointerId !== this.voiceDraftTrimDrag.pointerId) return;
    this.updateVoiceDraftTrimFromPointer(event, this.voiceDraftTrimDrag.handle, this.voiceDraftTrimDrag.host || null);
  }

  finishVoiceDraftTrimDrag(event?: PointerEvent) {
    if (!this.voiceDraftTrimDrag) return;
    if (event && event.pointerId !== this.voiceDraftTrimDrag.pointerId) return;

    if (event && this.voiceDraftTrimDrag.host?.releasePointerCapture) {
      try {
        this.voiceDraftTrimDrag.host.releasePointerCapture(event.pointerId);
      } catch {
        // no-op
      }
    }

    this.voiceDraftTrimDrag = null;
  }

  private updateVoiceDraftTrimFromPointer(
    event: PointerEvent,
    handle: 'start' | 'end',
    host: HTMLElement | null
  ) {
    if (!this.voiceDraft || !host) return;
    const rect = host.getBoundingClientRect();
    if (!rect.width) return;

    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const duration = Math.max(0.1, Number(this.voiceDraft.durationSeconds || 0));
    const seconds = ratio * duration;

    if (handle === 'start') {
      this.setVoiceDraftTrimStart(seconds);
      return;
    }

    this.setVoiceDraftTrimEnd(seconds);
  }

  setVoiceDraftTrimStart(value: number | string) {
    if (!this.voiceDraft) return;
    const duration = Math.max(0.1, Number(this.voiceDraft.durationSeconds || 0));
    const end = Math.max(0.1, Number(this.voiceDraft.trimEndSeconds || duration));
    const next = Math.max(0, Math.min(duration - 0.1, Number(value || 0)));
    this.voiceDraft.trimStartSeconds = Math.min(next, Math.max(0, end - 0.1));
    this.syncVoiceDraftPreviewBounds();
  }

  setVoiceDraftTrimEnd(value: number | string) {
    if (!this.voiceDraft) return;
    const duration = Math.max(0.1, Number(this.voiceDraft.durationSeconds || 0));
    const start = Math.max(0, Number(this.voiceDraft.trimStartSeconds || 0));
    const next = Math.max(0.1, Math.min(duration, Number(value || duration)));
    this.voiceDraft.trimEndSeconds = Math.max(next, Math.min(duration, start + 0.1));
    this.syncVoiceDraftPreviewBounds();
  }

  toggleVoiceDraftNormalize() {
    if (!this.voiceDraft) return;
    this.voiceDraft.normalize = !this.voiceDraft.normalize;
  }

  async rerecordVoiceDraft() {
    if (this.voiceDraftProcessing || this.uploadingAttachment || this.isRecordingVoice) return;
    this.discardVoiceDraft();
    await this.startVoiceRecording();
  }

  toggleVoiceDraftPreviewPlay() {
    const draft = this.voiceDraft;
    const audio = this.voiceDraftAudioElement();
    if (!draft || !audio) return;

    const start = Math.max(0, Number(draft.trimStartSeconds || 0));
    const end = Math.max(start + 0.05, Number(draft.trimEndSeconds || draft.durationSeconds || 0));

    if (audio.paused) {
      const current = Number(audio.currentTime || 0);
      if (!Number.isFinite(current) || current < start || current >= end - 0.02) {
        try {
          audio.currentTime = start;
        } catch {
          // no-op
        }
      }
      this.voiceDraftPreviewPlaying = true;
      void audio.play();
      return;
    }

    audio.pause();
    this.voiceDraftPreviewPlaying = false;
  }

  onVoiceDraftPreviewMetadata(event: Event) {
    const audio = event.target as HTMLAudioElement | null;
    if (!audio || !this.voiceDraft) return;

    const start = Math.max(0, Number(this.voiceDraft.trimStartSeconds || 0));
    try {
      audio.currentTime = start;
    } catch {
      // no-op
    }
    this.voiceDraftPreviewCurrentTime = start;
  }

  onVoiceDraftPreviewTimeUpdate(event: Event) {
    const audio = event.target as HTMLAudioElement | null;
    if (!audio || !this.voiceDraft) return;

    const start = Math.max(0, Number(this.voiceDraft.trimStartSeconds || 0));
    const end = Math.max(start + 0.05, Number(this.voiceDraft.trimEndSeconds || this.voiceDraft.durationSeconds || 0));
    const current = Number(audio.currentTime || 0);

    if (current >= end - 0.02) {
      audio.pause();
      try {
        audio.currentTime = start;
      } catch {
        // no-op
      }
      this.voiceDraftPreviewCurrentTime = start;
      this.voiceDraftPreviewPlaying = false;
      return;
    }

    this.voiceDraftPreviewCurrentTime = Math.max(start, current);
  }

  onVoiceDraftPreviewPlay() {
    this.voiceDraftPreviewPlaying = true;
  }

  onVoiceDraftPreviewPause() {
    this.voiceDraftPreviewPlaying = false;
  }

  voiceDraftPreviewPlayIcon(): string {
    return this.voiceDraftPreviewPlaying ? 'pause' : 'play_arrow';
  }

  voiceDraftPreviewCurrentLabel(): string {
    if (!this.voiceDraft) return '0:00';
    const start = Math.max(0, Number(this.voiceDraft.trimStartSeconds || 0));
    const current = Math.max(start, Number(this.voiceDraftPreviewCurrentTime || start));
    return this.formatDuration(current - start);
  }

  voiceDraftPreviewProgressPercent(): number {
    if (!this.voiceDraft) return 0;
    const start = Math.max(0, Number(this.voiceDraft.trimStartSeconds || 0));
    const end = Math.max(start + 0.05, Number(this.voiceDraft.trimEndSeconds || this.voiceDraft.durationSeconds || 0));
    const current = Math.max(start, Number(this.voiceDraftPreviewCurrentTime || start));
    const relative = Math.max(0, Math.min(1, (current - start) / Math.max(0.05, end - start)));
    const startPct = this.voiceDraftSelectionStartPercent() / 100;
    const widthPct = this.voiceDraftSelectionWidthPercent() / 100;
    return Math.max(0, Math.min(100, (startPct + (relative * widthPct)) * 100));
  }

  voiceDraftInsightsLabel(): string {
    if (!this.voiceDraft) return '';
    const codec = String(this.voiceDraft.mimeType || 'audio').replace('audio/', '').toUpperCase();
    const parts: string[] = [];
    if (codec) parts.push(codec);
    if (Number(this.voiceDraft.bitrateKbps || 0) > 0) parts.push(`~${Math.round(Number(this.voiceDraft.bitrateKbps))} kbps`);
    if (Number(this.voiceDraft.sampleRateHz || 0) > 0) parts.push(`${(Number(this.voiceDraft.sampleRateHz) / 1000).toFixed(1)} kHz`);
    if (Number(this.voiceDraft.channels || 0) > 0) parts.push(Number(this.voiceDraft.channels) === 1 ? 'mono' : Number(this.voiceDraft.channels) === 2 ? 'stereo' : `${Math.round(Number(this.voiceDraft.channels))}ch`);
    return parts.join(' • ');
  }

  private syncVoiceDraftPreviewBounds() {
    if (!this.voiceDraft) return;
    const audio = this.voiceDraftAudioElement();
    if (!audio) return;

    const start = Math.max(0, Number(this.voiceDraft.trimStartSeconds || 0));
    const end = Math.max(start + 0.05, Number(this.voiceDraft.trimEndSeconds || this.voiceDraft.durationSeconds || 0));
    const current = Number(audio.currentTime || 0);

    if (current < start || current > end) {
      try {
        audio.currentTime = start;
      } catch {
        // no-op
      }
      this.voiceDraftPreviewCurrentTime = start;
    }
  }

  private voiceDraftAudioElement(): HTMLAudioElement | null {
    return this.voiceDraftAudio?.nativeElement || null;
  }

  async commitVoiceDraft() {
    if (!this.voiceDraft || this.voiceDraftProcessing || this.uploadingAttachment) return;
    const previewAudio = this.voiceDraftAudioElement();
    if (previewAudio && !previewAudio.paused) previewAudio.pause();
    this.voiceDraftPreviewPlaying = false;
    this.voiceDraftProcessing = true;

    try {
      const processed = await this.buildVoiceDraftFile(this.voiceDraft);
      await this.uploadAttachmentFiles([processed]);
      this.discardVoiceDraft();
    } catch {
      this.pushUploadError('Could not process this voice note. Try recording again.');
    } finally {
      this.voiceDraftProcessing = false;
    }
  }

  private cleanupVoiceRecordingResources() {
    if (this.voiceRecordingTimer) {
      clearInterval(this.voiceRecordingTimer);
      this.voiceRecordingTimer = null;
    }

    if (this.voiceRecorderStream) {
      this.voiceRecorderStream.getTracks().forEach((track) => track.stop());
      this.voiceRecorderStream = null;
    }

    this.voiceRecorder = null;
    this.voiceRecorderChunks = [];
    this.isRecordingVoice = false;
    this.voiceRecordingCancelled = false;
    this.voiceRecordingSeconds = 0;
    this.voiceRecordingStartedAt = 0;
  }

  private preferredVoiceMimeType(): string {
    const candidates = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'];
    for (const candidate of candidates) {
      try {
        if (MediaRecorder.isTypeSupported(candidate)) return candidate;
      } catch {
        // no-op
      }
    }
    return '';
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
        const audioKind = this.audioKindForFile(preparedFile);
        const uploadMetadata = {
          ...mediaMetadata,
          audioKind
        };
        const uploaded = preparedFile.size < this.directUploadThreshold
          ? await this.uploadSingleAttachment(preparedFile, headers, itemId, uploadMetadata)
          : await this.uploadLargeAttachmentInChunks(preparedFile, headers, itemId, uploadMetadata);

        if (uploaded?.url) {
          const inferredAudioKind = this.audioKindForFile(preparedFile);
          const pendingAttachment: Attachment = {
            url: uploaded.url,
            name: uploaded.name || preparedFile.name,
            mimeType: uploaded.mimeType || preparedFile.type || 'application/octet-stream',
            size: Number(uploaded.size || preparedFile.size || 0),
            isImage: !!uploaded.isImage,
            durationSeconds: Number(uploaded.durationSeconds || mediaMetadata.durationSeconds || 0) || undefined,
            waveform: Array.isArray(uploaded.waveform) && uploaded.waveform.length
              ? uploaded.waveform
              : Array.isArray(mediaMetadata.waveform) && mediaMetadata.waveform.length
                ? mediaMetadata.waveform
                : undefined,
            audioKind: uploaded.audioKind || inferredAudioKind,
            width: Number(uploaded.width || mediaMetadata.width || 0) || undefined,
            height: Number(uploaded.height || mediaMetadata.height || 0) || undefined,
            storageProvider: uploaded.storageProvider,
            objectKey: uploaded.objectKey
          };
          this.pendingAttachments.push(pendingAttachment);
          this.ensureVoiceInsightsKnown(pendingAttachment, mediaMetadata.audioInsights);
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
    metadata?: {
      durationSeconds?: number | null;
      waveform?: number[] | null;
      audioKind?: 'voice-note' | 'uploaded-audio' | null;
      width?: number | null;
      height?: number | null;
    }
  ): Promise<Attachment> {
    const formData = new FormData();
    formData.append('file', file);
    if (Number(metadata?.durationSeconds) > 0) {
      formData.append('durationSeconds', String(Math.round(Number(metadata?.durationSeconds))));
    }
    if (Array.isArray(metadata?.waveform) && metadata!.waveform!.length) {
      formData.append('waveform', JSON.stringify(metadata!.waveform));
    }
    if (metadata?.audioKind) {
      formData.append('audioKind', metadata.audioKind);
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
    metadata?: {
      durationSeconds?: number | null;
      waveform?: number[] | null;
      audioKind?: 'voice-note' | 'uploaded-audio' | null;
      width?: number | null;
      height?: number | null;
    }
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
      waveform: Array.isArray(metadata?.waveform) && metadata!.waveform!.length ? metadata!.waveform : undefined,
      audioKind: metadata?.audioKind || undefined,
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

  private extractMediaMetadata(file: File): Promise<{
    durationSeconds?: number;
    waveform?: number[];
    width?: number;
    height?: number;
    audioInsights?: { sampleRateHz?: number; channels?: number; bitrateKbps?: number };
  }> {
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    const isAudio = file.type.startsWith('audio/');
    const durationHint = Number((file as any).__durationSecondsHint || 0);
    const waveformHint = Array.isArray((file as any).__waveformHint)
      ? (file as any).__waveformHint.map((x: unknown) => Number(x)).filter((x: number) => Number.isFinite(x) && x > 0).slice(0, 96)
      : [];
    const audioInsightsHintRaw = (file as any).__audioInsightsHint || null;
    const audioInsightsHint = audioInsightsHintRaw && typeof audioInsightsHintRaw === 'object'
      ? {
        sampleRateHz: Number(audioInsightsHintRaw.sampleRateHz || 0) || undefined,
        channels: Number(audioInsightsHintRaw.channels || 0) || undefined,
        bitrateKbps: Number(audioInsightsHintRaw.bitrateKbps || 0) || undefined
      }
      : undefined;
    if (!isVideo && !isImage && !isAudio) {
      return Promise.resolve({});
    }

    return new Promise((resolve) => {
      const media = document.createElement(isVideo ? 'video' : isAudio ? 'audio' : 'img') as HTMLVideoElement | HTMLAudioElement | HTMLImageElement;
      const objectUrl = URL.createObjectURL(file);
      const cleanup = () => {
        URL.revokeObjectURL(objectUrl);
        media.removeAttribute('src');
        if (media instanceof HTMLVideoElement || media instanceof HTMLAudioElement) media.load();
      };

      const done = (
        durationOverride?: number,
        waveformOverride?: number[],
        insightsOverride?: { sampleRateHz?: number; channels?: number; bitrateKbps?: number }
      ) => {
        const width = Number((media as any).videoWidth || (media as any).naturalWidth || 0);
        const height = Number((media as any).videoHeight || (media as any).naturalHeight || 0);
        const rawDuration = Number(durationOverride || (media instanceof HTMLVideoElement || media instanceof HTMLAudioElement ? media.duration : 0));
        const roundedDuration = Number.isFinite(rawDuration) && rawDuration > 0 ? Math.max(1, Math.round(rawDuration)) : undefined;
        const finalDuration = roundedDuration || (Number.isFinite(durationHint) && durationHint > 0 ? Math.max(1, Math.round(durationHint)) : undefined);
        const finalWaveform = Array.isArray(waveformOverride) && waveformOverride.length
          ? waveformOverride
          : waveformHint.length
            ? waveformHint
          : isAudio
            ? this.defaultVoiceWaveform
            : undefined;
        const bitrateKbps = this.approximateAudioBitrateKbps(Number(file.size || 0), Number(finalDuration || 0));
        const finalInsights = isAudio
          ? {
            sampleRateHz: Number(insightsOverride?.sampleRateHz || audioInsightsHint?.sampleRateHz || 0) || undefined,
            channels: Number(insightsOverride?.channels || audioInsightsHint?.channels || 0) || undefined,
            bitrateKbps: Number(insightsOverride?.bitrateKbps || audioInsightsHint?.bitrateKbps || bitrateKbps || 0) || undefined
          }
          : undefined;
        cleanup();
        resolve({
          durationSeconds: finalDuration,
          waveform: finalWaveform,
          audioInsights: finalInsights,
          width: Number.isFinite(width) && width > 0 ? Math.round(width) : undefined,
          height: Number.isFinite(height) && height > 0 ? Math.round(height) : undefined
        });
      };

      if (media instanceof HTMLVideoElement || media instanceof HTMLAudioElement) {
        media.preload = 'metadata';
        media.onloadedmetadata = async () => {
          const initialDuration = Number(media.duration);
          if (Number.isFinite(initialDuration) && initialDuration > 0) {
            done(initialDuration);
            return;
          }

          let settled = false;
          const fallbackTimer = setTimeout(() => {
            if (settled) return;
            settled = true;
            done();
          }, 850);

          const finalizeFromSeek = async () => {
            if (settled) return;
            settled = true;
            clearTimeout(fallbackTimer);
            const corrected = Number(media.duration);
            if (Number.isFinite(corrected) && corrected > 0) {
              done(corrected);
              return;
            }

            if (isAudio) {
              const decoded = await this.decodeAudioAnalysisFromFile(file);
              done(decoded.duration, decoded.waveform, {
                sampleRateHz: decoded.sampleRateHz,
                channels: decoded.channels,
                bitrateKbps: this.approximateAudioBitrateKbps(Number(file.size || 0), Number(decoded.duration || 0))
              });
              return;
            }

            done();
          };

          media.addEventListener('seeked', finalizeFromSeek, { once: true });
          try {
            media.currentTime = 1e9;
          } catch {
            settled = true;
            clearTimeout(fallbackTimer);
            if (isAudio) {
              this.decodeAudioAnalysisFromFile(file).then((decoded) => done(decoded.duration, decoded.waveform, {
                sampleRateHz: decoded.sampleRateHz,
                channels: decoded.channels,
                bitrateKbps: this.approximateAudioBitrateKbps(Number(file.size || 0), Number(decoded.duration || 0))
              }));
            } else {
              done();
            }
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

  private async decodeAudioAnalysisFromFile(file: File): Promise<{
    duration?: number;
    waveform?: number[];
    sampleRateHz?: number;
    channels?: number;
  }> {
    if (!file.type.startsWith('audio/')) return {};
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return {};

    try {
      const context = new AudioCtx();
      try {
        const buffer = await file.arrayBuffer();
        const decoded = await context.decodeAudioData(buffer.slice(0));
        const duration = Number(decoded?.duration || 0);
        const channelData = decoded?.numberOfChannels ? decoded.getChannelData(0) : null;
        return {
          duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
          waveform: channelData?.length ? this.buildWaveformFromChannelData(channelData, 48) : undefined,
          sampleRateHz: Number(decoded?.sampleRate || 0) || undefined,
          channels: Number(decoded?.numberOfChannels || 0) || undefined
        };
      } finally {
        await context.close();
      }
    } catch {
      return {};
    }
  }

  private async decodeAudioBufferFromBlob(blob: Blob): Promise<AudioBuffer | null> {
    if (!blob || !blob.size) return null;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return null;

    try {
      const context = new AudioCtx();
      try {
        const buffer = await blob.arrayBuffer();
        return await context.decodeAudioData(buffer.slice(0));
      } finally {
        await context.close();
      }
    } catch {
      return null;
    }
  }

  private async buildVoiceDraftFile(draft: NonNullable<ChatComponent['voiceDraft']>): Promise<File> {
    const source = await this.decodeAudioBufferFromBlob(draft.blob);
    const durationHint = Math.max(1, Math.round(Number(draft.trimEndSeconds || 0) - Number(draft.trimStartSeconds || 0)));

    if (!source) {
      const fallbackExt = this.extensionForMimeType(draft.mimeType || draft.blob.type || 'audio/webm');
      const stamp = new Date().toISOString().replace(/[.:]/g, '-');
      const fallback = new File([draft.blob], `voice-note-${stamp}.${fallbackExt}`, {
        type: draft.mimeType || draft.blob.type || 'audio/webm',
        lastModified: Date.now()
      });
      (fallback as any).__durationSecondsHint = durationHint;
      (fallback as any).__audioKind = 'voice-note';
      (fallback as any).__waveformHint = draft.waveform;
      return fallback;
    }

    const processed = this.trimAndNormalizeAudioBuffer(
      source,
      Number(draft.trimStartSeconds || 0),
      Number(draft.trimEndSeconds || source.duration || 0),
      !!draft.normalize
    );

    const wavBlob = this.encodeAudioBufferToWav(processed.buffer);
    const stamp = new Date().toISOString().replace(/[.:]/g, '-');
    const file = new File([wavBlob], `voice-note-${stamp}.wav`, {
      type: 'audio/wav',
      lastModified: Date.now()
    });

    const durationSeconds = Number(processed.buffer.duration || 0);
    const firstChannel = processed.buffer.numberOfChannels > 0 ? processed.buffer.getChannelData(0) : null;
    const waveform = firstChannel?.length ? this.buildWaveformFromChannelData(firstChannel, 96) : this.defaultVoiceWaveform;
    const bitrateKbps = this.approximateAudioBitrateKbps(Number(file.size || 0), durationSeconds);

    (file as any).__durationSecondsHint = Number.isFinite(durationSeconds) && durationSeconds > 0
      ? Math.max(1, Math.round(durationSeconds))
      : durationHint;
    (file as any).__audioKind = 'voice-note';
    (file as any).__waveformHint = waveform;
    (file as any).__audioInsightsHint = {
      sampleRateHz: Number(processed.buffer.sampleRate || 0) || undefined,
      channels: Number(processed.buffer.numberOfChannels || 0) || undefined,
      bitrateKbps: bitrateKbps || undefined
    };

    return file;
  }

  private trimAndNormalizeAudioBuffer(
    source: AudioBuffer,
    startSeconds: number,
    endSeconds: number,
    normalize: boolean
  ): { buffer: AudioBuffer; gainApplied: number } {
    const sampleRate = Math.max(1, Number(source.sampleRate || 44100));
    const duration = Math.max(0.1, Number(source.duration || (source.length / sampleRate) || 0));
    const start = Math.max(0, Math.min(duration - 0.05, Number(startSeconds || 0)));
    const end = Math.max(start + 0.05, Math.min(duration, Number(endSeconds || duration)));
    const startFrame = Math.max(0, Math.floor(start * sampleRate));
    const endFrame = Math.max(startFrame + 1, Math.min(source.length, Math.ceil(end * sampleRate)));
    const frameLength = Math.max(1, endFrame - startFrame);
    const channels = Math.max(1, Number(source.numberOfChannels || 1));

    const OfflineCtx = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
    const working = OfflineCtx
      ? new OfflineCtx(channels, frameLength, sampleRate).createBuffer(channels, frameLength, sampleRate)
      : new AudioBuffer({ length: frameLength, numberOfChannels: channels, sampleRate });

    for (let channel = 0; channel < channels; channel += 1) {
      const sourceData = source.getChannelData(channel).subarray(startFrame, endFrame);
      working.copyToChannel(new Float32Array(sourceData), channel, 0);
    }

    let peak = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const data = working.getChannelData(channel);
      for (let i = 0; i < data.length; i += 1) {
        const value = Math.abs(data[i]);
        if (value > peak) peak = value;
      }
    }

    let gainApplied = 1;
    if (normalize && peak > 0.0001) {
      const targetPeak = 0.92;
      gainApplied = Math.max(0.3, Math.min(2.4, targetPeak / peak));
      if (Math.abs(gainApplied - 1) > 0.01) {
        for (let channel = 0; channel < channels; channel += 1) {
          const data = working.getChannelData(channel);
          for (let i = 0; i < data.length; i += 1) {
            const scaled = data[i] * gainApplied;
            data[i] = Math.max(-1, Math.min(1, scaled));
          }
        }
      }
    }

    return { buffer: working, gainApplied };
  }

  private encodeAudioBufferToWav(buffer: AudioBuffer): Blob {
    const channels = Math.max(1, Number(buffer.numberOfChannels || 1));
    const sampleRate = Math.max(1, Number(buffer.sampleRate || 44100));
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const dataLength = buffer.length * blockAlign;
    const wavLength = 44 + dataLength;
    const output = new ArrayBuffer(wavLength);
    const view = new DataView(output);

    this.writeWavString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    this.writeWavString(view, 8, 'WAVE');
    this.writeWavString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    this.writeWavString(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    const channelData = Array.from({ length: channels }, (_, i) => buffer.getChannelData(i));
    let offset = 44;
    for (let frame = 0; frame < buffer.length; frame += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const sample = Math.max(-1, Math.min(1, Number(channelData[channel][frame] || 0)));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }

    return new Blob([output], { type: 'audio/wav' });
  }

  private writeWavString(view: DataView, offset: number, value: string) {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  }

  private extensionForMimeType(mimeType: string): string {
    const normalized = String(mimeType || '').toLowerCase();
    if (normalized.includes('ogg')) return 'ogg';
    if (normalized.includes('mp4') || normalized.includes('aac') || normalized.includes('m4a')) return 'm4a';
    if (normalized.includes('wav')) return 'wav';
    if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3';
    return 'webm';
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
    const referenceAttachments = this.messageAttachments(message);

    this.replyingTo = {
      messageId: message.id,
      from: message.from,
      text: this.messageReplySeedText(message),
      attachment: this.preferredReferenceAttachment(referenceAttachments),
      attachments: referenceAttachments,
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
    const referenceAttachments = this.messageAttachments(message);

    this.forwardCandidate = {
      messageId: message.id,
      from: message.from,
      text: this.messageReplySeedText(message),
      scope,
      attachment: this.preferredReferenceAttachment(referenceAttachments),
      attachments: referenceAttachments
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
    const text = note;
    const forwardedAttachments = this.referenceAttachments(candidate);
    const forwardedPrimary = this.preferredReferenceAttachment(forwardedAttachments) || candidate.attachment || null;

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
          attachment: forwardedPrimary,
          attachments: forwardedAttachments
        }
      };

      this.privateChats[to].push(msg);
      this.scheduleMediaAlbumCollapse(msg, 'private');

      this.socket.sendPrivateMessage(to, text, tempId, null, {
        messageId: candidate.messageId,
        from: candidate.from,
        text: candidate.text,
        scope: candidate.scope,
        attachment: forwardedPrimary,
        attachments: forwardedAttachments
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

  replyPreviewText(text: string, attachment?: ChatMessage['attachment'], attachments?: Attachment[] | null): string {
    const list = this.referenceAttachments({ attachment: attachment || null, attachments: attachments || [] });
    const trimmed = String(text || '').trim();
    if (!trimmed) {
      if (list.length > 1) return `${list.length} attachments`;
      if (attachment) {
        if (this.isAudioAttachment(attachment)) return this.audioAttachmentLabel(attachment);
        if (this.isVideoAttachment(attachment)) return 'Video attachment';
        if (attachment.isImage) return 'Image attachment';
        const attachmentName = String(attachment.name || '').trim();
        if (attachmentName) return `[Attachment] ${attachmentName}`;
        return 'Attachment';
      }
      return 'Message unavailable';
    }
    if (/^\[attachment\]\s+/i.test(trimmed) && list.length > 1) {
      return `${list.length} attachments`;
    }
    return trimmed.length > 70 ? `${trimmed.slice(0, 70)}...` : trimmed;
  }

  messageBodyText(message: ChatMessage): string {
    const text = String(message?.text || '').trim();
    if (!text) return '';
    if (message?.forwardedFrom?.messageId && /^forwarded message$/i.test(text)) return '';
    return text;
  }

  attachmentUrl(attachment: ChatMessage['attachment']): string {
    if (!attachment?.url) return '';
    if (/^https?:\/\//i.test(attachment.url)) return attachment.url;
    return `${environment.apiUrl}${attachment.url}`;
  }

  avatarUrl(username: string | null | undefined): string {
    const key = String(username || '').trim().toLowerCase();
    if (!key) return '';
    const raw = String(this.userAvatarUrlByUsername[key] || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    return `${environment.apiUrl}${raw}`;
  }

  userDisplayName(username: string | null | undefined): string {
    const key = String(username || '').trim().toLowerCase();
    if (!key) return '';
    const displayName = String(this.userPublicProfileByUsername[key]?.displayName || '').trim();
    return displayName || key;
  }

  userRole(username: string | null | undefined): string {
    const key = String(username || '').trim().toLowerCase();
    if (!key) return 'user';
    return String(this.userPublicProfileByUsername[key]?.role || 'user');
  }

  userStatusText(username: string | null | undefined): string {
    const key = String(username || '').trim().toLowerCase();
    if (!key) return '';
    return String(this.userPublicProfileByUsername[key]?.statusText || '').trim();
  }

  isPinnedUser(username: string): boolean {
    return this.pinnedUsers.includes(username.toLowerCase());
  }

  togglePinnedUser(username: string): void {
    const key = username.toLowerCase();
    if (this.isPinnedUser(key)) {
      this.pinnedUsers = this.pinnedUsers.filter(u => u !== key);
    } else {
      this.pinnedUsers = [key, ...this.pinnedUsers];
    }
  }

  getUserActivityStatus(username: string): 'typing' | 'in-public' | 'online' | 'away' {
    const key = username.toLowerCase();
    if (this.isTypingMap[key]) return 'typing';
    if (this.isTypingPublic.has(key)) return 'typing';
    if (this.onlineUsers.includes(username)) return 'online';
    return 'away';
  }

  getUserActivityText(username: string): string {
    const status = this.getUserActivityStatus(username);
    switch (status) {
      case 'typing': return 'Typing...';
      case 'in-public': return 'In public chat';
      case 'online': return 'Online';
      case 'away': return 'Away';
      default: return '';
    }
  }

  get filteredPinnedUsers(): string[] {
    return this.pinnedUsers.filter(u => 
      this.onlineUsers.some(ou => ou.toLowerCase() === u) &&
      (this.searchTerm ? u.includes(this.searchTerm.toLowerCase()) : true)
    );
  }

  get filteredOnlineNotPinned(): string[] {
    const pinnedLower = this.pinnedUsers.map(u => u.toLowerCase());
    return this.filteredOnlineUsers.filter(u => !pinnedLower.includes(u.toLowerCase()));
  }

  hasUserSocialLinks(): boolean {
    const links = this.userProfileCardData?.socialLinks;
    if (!links) return false;
    return !!(links.facebook || links.instagram || links.tiktok || links.twitter || links.website);
  }

  // Official brand logos from simpleicons.org (MIT License)
  getUserSocialSvg(platform: string): string {
    const logos: { [key: string]: string } = {
      facebook: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="#1877F2" d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"/></svg>`,
      instagram: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="#E4405F" d="M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077"/></svg>`,
      tiktok: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="#000000" d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>`,
      twitter: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="#000000" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>`,
      website: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="#3e82f7" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`
    };
    return logos[platform] || '';
  }

  messageAttachments(message: ChatMessage): Attachment[] {
    const fromArray = Array.isArray(message.attachments) ? message.attachments : [];
    const list = fromArray.length ? fromArray : (message.attachment ? [message.attachment] : []);
    if (list.length < 2) return list;

    const media = list.filter((a) => this.canPreviewMediaAttachment(a));
    const other = list.filter((a) => !this.canPreviewMediaAttachment(a));
    return [...media, ...other];
  }

  referenceAttachments(ref: { attachment?: Attachment | null; attachments?: Attachment[] } | null | undefined): Attachment[] {
    const fromArray = Array.isArray(ref?.attachments)
      ? ref!.attachments!.filter((a) => !!a?.url)
      : [];
    if (fromArray.length) return fromArray;
    const single = ref?.attachment?.url ? [ref.attachment] : [];
    return single as Attachment[];
  }

  referenceAttachmentCount(ref: { attachment?: Attachment | null; attachments?: Attachment[] } | null | undefined): number {
    return this.referenceAttachments(ref).length;
  }

  preferredReferenceAttachment(list: Attachment[]): Attachment | null {
    const attachments = Array.isArray(list) ? list.filter((a) => !!a?.url) : [];
    if (!attachments.length) return null;
    return attachments.find((a) => this.isAudioAttachment(a))
      || attachments.find((a) => this.canPreviewMediaAttachment(a))
      || attachments[0]
      || null;
  }

  referenceMediaAttachments(ref: { attachment?: Attachment | null; attachments?: Attachment[] } | null | undefined): Attachment[] {
    return this.referenceAttachments(ref).filter((a) => this.canPreviewMediaAttachment(a));
  }

  referenceAlbumPreviewItems(ref: { attachment?: Attachment | null; attachments?: Attachment[] } | null | undefined): Attachment[] {
    return this.referenceMediaAttachments(ref).slice(0, 4);
  }

  referenceAlbumMoreCount(ref: { attachment?: Attachment | null; attachments?: Attachment[] } | null | undefined): number {
    const count = this.referenceMediaAttachments(ref).length;
    return count > 4 ? count - 4 : 0;
  }

  referenceAudioAttachments(ref: { attachment?: Attachment | null; attachments?: Attachment[] } | null | undefined): Attachment[] {
    return this.referenceAttachments(ref).filter((a) => this.isAudioAttachment(a));
  }

  referenceAudioAttachmentCount(ref: { attachment?: Attachment | null; attachments?: Attachment[] } | null | undefined): number {
    return this.referenceAudioAttachments(ref).length;
  }

  referenceAudioIndex(ref: { messageId?: string; scope?: 'public' | 'private' } | null | undefined): number {
    const total = this.referenceAudioAttachmentCount(ref as any);
    if (!total) return 0;
    const key = this.referenceIdentity(ref);
    const value = Number(this.referenceAudioIndexByKey[key] || 0);
    if (!Number.isInteger(value) || value < 0 || value >= total) return 0;
    return value;
  }

  referenceAudioCurrentAttachment(ref: { attachment?: Attachment | null; attachments?: Attachment[]; messageId?: string; scope?: 'public' | 'private' } | null | undefined): Attachment | null {
    const list = this.referenceAudioAttachments(ref);
    if (!list.length) return null;
    return list[this.referenceAudioIndex(ref)] || list[0] || null;
  }

  prevReferenceAudio(ref: { attachment?: Attachment | null; attachments?: Attachment[]; messageId?: string; scope?: 'public' | 'private' } | null | undefined, event?: Event) {
    const total = this.referenceAudioAttachmentCount(ref);
    if (total <= 1) {
      event?.stopPropagation();
      return;
    }
    this.setReferenceAudioIndex(ref, this.referenceAudioIndex(ref) - 1, event);
  }

  nextReferenceAudio(ref: { attachment?: Attachment | null; attachments?: Attachment[]; messageId?: string; scope?: 'public' | 'private' } | null | undefined, event?: Event) {
    const total = this.referenceAudioAttachmentCount(ref);
    if (total <= 1) {
      event?.stopPropagation();
      return;
    }
    this.setReferenceAudioIndex(ref, this.referenceAudioIndex(ref) + 1, event);
  }

  private tryAutoAdvanceReferenceAudio(endedAttachment: ChatMessage['attachment']): boolean {
    const endedKey = this.voiceAttachmentKey(endedAttachment);
    if (!endedKey) return false;

    const refs = this.referenceCandidatesForAudioAdvance();
    for (const ref of refs) {
      const list = this.referenceAudioAttachments(ref);
      if (list.length < 2) continue;
      const index = this.referenceAudioIndex(ref);
      const current = list[index] || list[0];
      if (!current || this.voiceAttachmentKey(current) !== endedKey) continue;
      if (index >= list.length - 1) continue;

      this.setReferenceAudioIndex(ref, index + 1);
      setTimeout(() => {
        const nextAttachment = this.referenceAudioCurrentAttachment(ref);
        if (!nextAttachment) return;
        const nextKey = this.voiceAttachmentKey(nextAttachment);
        const nextAudio = this.resolveVoiceAudioElement(nextKey, null);
        if (!nextAudio) return;
        this.pauseAllVoicePlayersExcept(nextKey);
        const rate = this.voicePlaybackRate(nextAttachment);
        nextAudio.playbackRate = rate;
        nextAudio.defaultPlaybackRate = rate;
        this.activeVoiceKey = nextKey;
        void nextAudio.play();
      }, 70);
      return true;
    }

    return false;
  }

  private referenceCandidatesForAudioAdvance(): Array<{
    messageId?: string;
    scope?: 'public' | 'private';
    attachment?: Attachment | null;
    attachments?: Attachment[];
  }> {
    const refs: Array<{ messageId?: string; scope?: 'public' | 'private'; attachment?: Attachment | null; attachments?: Attachment[] }> = [];

    this.publicMessages.forEach((message) => {
      if (message.replyTo?.messageId) refs.push(message.replyTo);
      if (message.forwardedFrom?.messageId) refs.push(message.forwardedFrom);
    });

    Object.values(this.privateChats || {}).forEach((messages) => {
      (messages || []).forEach((message) => {
        if (message.replyTo?.messageId) refs.push(message.replyTo);
        if (message.forwardedFrom?.messageId) refs.push(message.forwardedFrom);
      });
    });

    return refs;
  }

  referenceMetaLabel(ref: { attachment?: Attachment | null; attachments?: Attachment[] } | null | undefined): string {
    const list = this.referenceAttachments(ref);
    if (!list.length) return '';

    const totalBytes = list.reduce((sum, a) => {
      const size = Number(a?.size || 0);
      return sum + (Number.isFinite(size) && size > 0 ? size : 0);
    }, 0);

    const audio = this.referenceAudioAttachments(ref);
    const totalAudioSeconds = audio.reduce((sum, a) => {
      const seconds = Number(a?.durationSeconds || 0);
      return sum + (Number.isFinite(seconds) && seconds > 0 ? seconds : 0);
    }, 0);

    const parts = [`${list.length} attachment${list.length === 1 ? '' : 's'}`];
    if (totalBytes > 0) parts.push(this.attachmentSizeLabel(totalBytes));
    if (audio.length) parts.push(`audio ${this.formatDuration(totalAudioSeconds)}`);

    const mediaCount = this.referenceMediaAttachments(ref).length;
    if (mediaCount > 1) parts.push(`album ${mediaCount}`);
    return parts.join(' • ');
  }

  async jumpToReferenceAttachment(
    ref: { messageId: string; scope?: 'public' | 'private' } | null | undefined,
    attachment?: Attachment | null,
    event?: Event
  ) {
    event?.stopPropagation();
    if (!ref?.messageId) return;

    await this.jumpToReference({ messageId: ref.messageId, scope: ref.scope || 'private' });
    if (!attachment) return;

    const scope = ref.scope || 'private';
    const message = this.findReferencedMessage(scope, ref.messageId);
    if (!message) return;

    const target = this.matchReferenceAttachmentInMessage(message, attachment);
    if (!target || !this.canPreviewMediaAttachment(target)) return;
    setTimeout(() => this.openAttachmentViewer(message, scope, target), 70);
  }

  private setReferenceAudioIndex(
    ref: { messageId?: string; scope?: 'public' | 'private' } | null | undefined,
    index: number,
    event?: Event
  ) {
    event?.stopPropagation();
    const total = this.referenceAudioAttachmentCount(ref as any);
    if (!total) return;
    const key = this.referenceIdentity(ref);
    const normalized = ((Math.floor(index) % total) + total) % total;
    this.referenceAudioIndexByKey[key] = normalized;
  }

  private referenceIdentity(ref: { messageId?: string; scope?: 'public' | 'private' } | null | undefined): string {
    return `ref:${ref?.scope || 'private'}:${ref?.messageId || 'none'}`;
  }

  private findReferencedMessage(scope: 'public' | 'private', messageId: string): ChatMessage | null {
    if (!messageId) return null;
    if (scope === 'public') {
      return this.publicMessages.find((m) => m.id === messageId) || null;
    }

    const users = Object.keys(this.privateChats || {});
    for (const user of users) {
      const hit = (this.privateChats[user] || []).find((m) => m.id === messageId);
      if (hit) return hit;
    }
    return null;
  }

  private matchReferenceAttachmentInMessage(message: ChatMessage, attachment: Attachment): Attachment | null {
    const list = this.messageAttachments(message);
    if (!list.length) return null;

    const targetUrl = String(attachment?.url || '').trim();
    if (targetUrl) {
      const byUrl = list.find((a) => String(a?.url || '').trim() === targetUrl);
      if (byUrl) return byUrl;
    }

    const targetKey = String(attachment?.objectKey || '').trim();
    if (targetKey) {
      const byObjectKey = list.find((a) => String(a?.objectKey || '').trim() === targetKey);
      if (byObjectKey) return byObjectKey;
    }

    const targetName = String(attachment?.name || '').trim().toLowerCase();
    const targetSize = Number(attachment?.size || 0);
    if (targetName) {
      const byName = list.find((a) => {
        const name = String(a?.name || '').trim().toLowerCase();
        const size = Number(a?.size || 0);
        return name === targetName && size === targetSize;
      });
      if (byName) return byName;
    }

    return this.preferredReferenceAttachment(list);
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
    const mime = String(attachment?.mimeType || '').trim().toLowerCase();
    if (mime.startsWith('audio/')) return true;
    const name = String(attachment?.name || '').toLowerCase();
    return /\.(webm|ogg|mp3|m4a|wav|aac|flac|opus)$/i.test(name);
  }

  isVoiceNoteAttachment(attachment: ChatMessage['attachment']): boolean {
    if (!this.isAudioAttachment(attachment)) return false;
    if (attachment?.audioKind === 'voice-note') return true;
    if (attachment?.audioKind === 'uploaded-audio') return false;
    return /^voice-note-[^\s]+\.(ogg|webm|m4a|mp3|wav)$/i.test(String(attachment?.name || ''));
  }

  audioAttachmentLabel(attachment: ChatMessage['attachment']): string {
    return this.isVoiceNoteAttachment(attachment) ? 'Voice note' : 'Audio file';
  }

  private audioKindForFile(file: File): 'voice-note' | 'uploaded-audio' | undefined {
    if (!String(file?.type || '').startsWith('audio/')) return undefined;
    if ((file as any)?.__audioKind === 'voice-note') return 'voice-note';
    return 'uploaded-audio';
  }

  voiceAttachmentKey(attachment: ChatMessage['attachment']): string {
    if (!attachment) return 'voice:none';
    const key = attachment.url
      ? `voice:${attachment.url}`
      : `voice:${attachment.name || 'audio'}:${attachment.size || 0}`;
    this.voiceAttachmentByKey[key] = attachment as Attachment;
    return key;
  }

  private voiceWaveformSourceBars(attachment: ChatMessage['attachment']): number[] {
    const key = this.voiceAttachmentKey(attachment);
    const cached = this.voiceWaveformByKey[key];
    if (cached?.length) return cached;

    const fromAttachment = Array.isArray(attachment?.waveform)
      ? attachment!.waveform!
          .map((x) => Number(x))
          .filter((x) => Number.isFinite(x) && x > 0)
          .slice(0, 96)
      : [];
    if (fromAttachment.length) {
      this.voiceWaveformByKey[key] = fromAttachment;
      this.voiceWaveformQualityByKey[key] = 'real';
      return fromAttachment;
    }

    if (attachment?.url && this.isAudioAttachment(attachment) && !this.voiceWaveformLoading.has(key)) {
      this.voiceWaveformLoading.add(key);
      const sourceUrl = this.attachmentUrl(attachment);
      void this.generateVoiceWaveform(sourceUrl, attachment)
        .then((bars) => {
          this.voiceWaveformByKey[key] = bars.length ? bars : this.defaultVoiceWaveform;
          this.voiceWaveformQualityByKey[key] = bars.length ? 'real' : 'fallback';
          this.voiceSilenceRangesByKey[key] = [];
        })
        .catch(() => {
          this.voiceWaveformByKey[key] = this.defaultVoiceWaveform;
          this.voiceWaveformQualityByKey[key] = 'fallback';
          this.voiceSilenceRangesByKey[key] = [];
        })
        .finally(() => {
          this.voiceWaveformLoading.delete(key);
        });
    }

    return this.defaultVoiceWaveform;
  }

  voiceWaveformBars(attachment: ChatMessage['attachment']): number[] {
    const source = this.voiceWaveformSourceBars(attachment);
    const zoom = this.voiceWaveformZoom(attachment);
    if (zoom <= 1 || source.length <= 8) return source;

    const { start, span } = this.voiceWaveformWindow(attachment);
    const displayBars = Math.max(24, Math.min(96, source.length));
    const bars: number[] = [];
    for (let i = 0; i < displayBars; i += 1) {
      const point = displayBars <= 1 ? start : start + (i / (displayBars - 1)) * span;
      const index = Math.max(0, Math.min(source.length - 1, Math.round(point * (source.length - 1))));
      bars.push(source[index]);
    }
    return bars;
  }

  voiceWaveformZoom(attachment: ChatMessage['attachment']): number {
    const key = this.voiceAttachmentKey(attachment);
    const raw = Number(this.voiceWaveformZoomByKey[key] || 1);
    if (raw >= 4) return 4;
    if (raw >= 2) return 2;
    return 1;
  }

  voiceWaveformZoomLabel(attachment: ChatMessage['attachment']): string {
    return `${this.voiceWaveformZoom(attachment)}x`;
  }

  canZoomVoiceWaveform(attachment: ChatMessage['attachment']): boolean {
    const bars = this.voiceWaveformSourceBars(attachment);
    const duration = Math.max(0, Number(this.voiceUiState(attachment).duration || attachment?.durationSeconds || 0));
    return bars.length >= 32 || duration >= 60;
  }

  zoomInVoiceWaveform(attachment: ChatMessage['attachment'], event?: Event) {
    event?.stopPropagation();
    if (!attachment) return;
    const key = this.voiceAttachmentKey(attachment);
    const current = this.voiceWaveformZoom(attachment);
    this.voiceWaveformZoomByKey[key] = current >= 4 ? 4 : current >= 2 ? 4 : 2;
  }

  zoomOutVoiceWaveform(attachment: ChatMessage['attachment'], event?: Event) {
    event?.stopPropagation();
    if (!attachment) return;
    const key = this.voiceAttachmentKey(attachment);
    const current = this.voiceWaveformZoom(attachment);
    this.voiceWaveformZoomByKey[key] = current <= 1 ? 1 : current <= 2 ? 1 : 2;
  }

  toggleVoiceAutoPlayNext() {
    this.voiceAutoPlayNext = !this.voiceAutoPlayNext;
    this.persistUploadUiState();
  }

  isVoiceAutoPlayNextEnabled(): boolean {
    return !!this.voiceAutoPlayNext;
  }

  toggleVoiceSilenceSkip() {
    this.voiceSilenceSkipEnabled = !this.voiceSilenceSkipEnabled;
    this.persistUploadUiState();
  }

  isVoiceSilenceSkipEnabled(): boolean {
    return !!this.voiceSilenceSkipEnabled;
  }

  toggleVoiceKeyboardControls() {
    this.voiceKeyboardControlsEnabled = !this.voiceKeyboardControlsEnabled;
    this.persistUploadUiState();
  }

  toggleOfflineVoiceCache() {
    this.offlineVoiceCacheEnabled = !this.offlineVoiceCacheEnabled;
    this.persistUploadUiState();
  }

  isVoiceOfflineCached(attachment: ChatMessage['attachment']): boolean {
    if (!attachment?.url) return false;
    const sourceUrl = this.attachmentUrl(attachment);
    return this.voiceOfflineCachedUrlSet.has(sourceUrl);
  }

  voiceProgressDisplayRatio(attachment: ChatMessage['attachment']): number {
    const absolute = this.voiceProgressRatio(attachment);
    const { start, span } = this.voiceWaveformWindow(attachment);
    if (span <= 0) return absolute;
    return Math.max(0, Math.min(1, (absolute - start) / span));
  }

  voicePlaybackRate(attachment: ChatMessage['attachment']): number {
    const key = this.voiceAttachmentKey(attachment);
    const value = Number(this.voicePlaybackRateByKey[key] || 1);
    return value > 0 ? value : 1;
  }

  voicePlaybackRateLabel(attachment: ChatMessage['attachment']): string {
    const value = this.voicePlaybackRate(attachment);
    return Number.isInteger(value) ? `${value}x` : `${value.toFixed(1)}x`;
  }

  toggleVoicePlaybackRate(attachment: ChatMessage['attachment'], event?: Event) {
    event?.stopPropagation();
    const current = this.voicePlaybackRate(attachment);
    const next = current < 1.5 ? 1.5 : current < 2 ? 2 : 1;
    this.setVoicePlaybackRate(attachment, next);
  }

  setVoicePlaybackRate(attachment: ChatMessage['attachment'], rate: number, event?: Event) {
    event?.stopPropagation();
    if (!attachment) return;
    const key = this.voiceAttachmentKey(attachment);
    const value = Number(rate || 1);
    const next = value >= 2 ? 2 : value >= 1.5 ? 1.5 : 1;
    this.voicePlaybackRateByKey[key] = next;
    this.applyVoicePlaybackRateToDom(key, next);
  }

  openVoiceAttachmentMenuFor(attachment: ChatMessage['attachment']) {
    this.voiceMenuTarget = attachment || null;
  }

  voiceCurrentTimeLabel(attachment: ChatMessage['attachment']): string {
    return this.formatDuration(this.voiceUiState(attachment).currentTime);
  }

  voiceDurationLabel(attachment: ChatMessage['attachment']): string {
    this.ensureVoiceDurationResolved(attachment);
    const stateDurationRaw = Number(this.voiceUiState(attachment).duration || 0);
    const stateDuration = Number.isFinite(stateDurationRaw) && stateDurationRaw > 0 ? stateDurationRaw : 0;
    if (stateDuration > 0) return this.formatDuration(stateDuration);
    const currentFallback = Math.ceil(Number(this.voiceUiState(attachment).currentTime || 0));
    if (currentFallback > 0) return this.formatDuration(currentFallback);
    return this.attachmentDurationLabel(attachment);
  }

  voiceProgressRatio(attachment: ChatMessage['attachment']): number {
    const state = this.voiceUiState(attachment);
    const current = Math.max(0, Number(state.currentTime || 0));
    const stateDuration = Number.isFinite(Number(state.duration)) && Number(state.duration) > 0 ? Number(state.duration) : 0;
    const resolvedDuration = Math.max(0, Number(stateDuration || attachment?.durationSeconds || 0));
    const duration = resolvedDuration > 0 ? resolvedDuration : Math.max(1, current + 0.25);
    return Math.max(0, Math.min(1, current / duration));
  }

  voiceInsightsLabel(attachment: ChatMessage['attachment']): string {
    if (!attachment || !this.isAudioAttachment(attachment)) return '';
    this.ensureVoiceInsightsKnown(attachment);
    const key = this.voiceAttachmentKey(attachment);
    const insights = this.voiceInsightsByKey[key] || {};
    const mime = String(attachment.mimeType || '').toLowerCase();
    const codec = mime.startsWith('audio/') ? mime.replace('audio/', '').toUpperCase() : this.attachmentTypeLabel(attachment);
    const parts: string[] = [];
    if (codec && codec !== 'FILE') parts.push(codec);
    if (Number(insights.bitrateKbps || 0) > 0) parts.push(`~${Math.round(Number(insights.bitrateKbps))} kbps`);
    if (Number(insights.sampleRateHz || 0) > 0) parts.push(`${(Number(insights.sampleRateHz) / 1000).toFixed(1)} kHz`);
    if (Number(insights.channels || 0) > 0) parts.push(Number(insights.channels) === 1 ? 'mono' : Number(insights.channels) === 2 ? 'stereo' : `${Math.round(Number(insights.channels))}ch`);
    return parts.join(' • ');
  }

  private voiceWaveformWindow(attachment: ChatMessage['attachment']): { start: number; span: number } {
    const zoom = this.voiceWaveformZoom(attachment);
    if (zoom <= 1) return { start: 0, span: 1 };

    const span = 1 / zoom;
    const progress = this.voiceProgressRatio(attachment);
    let start = progress - span / 2;
    if (!Number.isFinite(start)) start = 0;
    start = Math.max(0, Math.min(1 - span, start));
    return { start, span };
  }

  private ensureVoiceInsightsKnown(
    attachment: ChatMessage['attachment'],
    hints?: { sampleRateHz?: number; channels?: number; bitrateKbps?: number }
  ) {
    if (!attachment || !this.isAudioAttachment(attachment)) return;
    const key = this.voiceAttachmentKey(attachment);
    const existing = this.voiceInsightsByKey[key] || {};
    const next = { ...existing };

    if (Number(hints?.sampleRateHz || 0) > 0) next.sampleRateHz = Number(hints!.sampleRateHz);
    if (Number(hints?.channels || 0) > 0) next.channels = Math.max(1, Math.round(Number(hints!.channels)));
    if (Number(hints?.bitrateKbps || 0) > 0) next.bitrateKbps = Number(hints!.bitrateKbps);

    if (!next.bitrateKbps) {
      const duration = Math.max(0, Number(attachment.durationSeconds || this.voiceUiState(attachment).duration || 0));
      const computed = this.approximateAudioBitrateKbps(Number(attachment.size || 0), duration);
      if (computed > 0) next.bitrateKbps = computed;
    }

    this.voiceInsightsByKey[key] = next;

    if ((next.sampleRateHz || next.channels) || this.voiceInsightsLoading.has(key) || !attachment.url) return;
    this.voiceInsightsLoading.add(key);

    const sourceUrl = this.attachmentUrl(attachment);
    void this.decodeAudioInsightFromUrl(sourceUrl)
      .then((decoded) => {
        if (!decoded) return;
        const merged = {
          ...this.voiceInsightsByKey[key],
          sampleRateHz: Number(decoded.sampleRateHz || this.voiceInsightsByKey[key]?.sampleRateHz || 0) || undefined,
          channels: Number(decoded.channels || this.voiceInsightsByKey[key]?.channels || 0) || undefined
        };
        if (!merged.bitrateKbps) {
          const duration = Math.max(0, Number(decoded.duration || attachment.durationSeconds || this.voiceUiState(attachment).duration || 0));
          merged.bitrateKbps = this.approximateAudioBitrateKbps(Number(attachment.size || 0), duration) || undefined;
        }
        this.voiceInsightsByKey[key] = merged;
      })
      .finally(() => {
        this.voiceInsightsLoading.delete(key);
      });
  }

  private async decodeAudioInsightFromUrl(sourceUrl: string): Promise<{ duration?: number; sampleRateHz?: number; channels?: number } | null> {
    if (!sourceUrl) return null;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return null;

    try {
      const response = await fetch(sourceUrl);
      if (!response.ok) return null;
      const raw = await response.arrayBuffer();
      const context = new AudioCtx();
      try {
        const decoded = await context.decodeAudioData(raw.slice(0));
        const duration = Number(decoded?.duration || 0);
        return {
          duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
          sampleRateHz: Number(decoded?.sampleRate || 0) || undefined,
          channels: Number(decoded?.numberOfChannels || 0) || undefined
        };
      } finally {
        await context.close();
      }
    } catch {
      return null;
    }
  }

  private approximateAudioBitrateKbps(bytes: number, durationSeconds: number): number {
    const size = Number(bytes || 0);
    const duration = Number(durationSeconds || 0);
    if (!Number.isFinite(size) || !Number.isFinite(duration) || size <= 0 || duration <= 0) return 0;
    return Math.max(8, (size * 8) / duration / 1000);
  }

  isVoiceWaveformBarActive(index: number, barCount: number, attachment: ChatMessage['attachment']): boolean {
    if (barCount <= 0) return false;
    const activeBars = Math.max(0, Math.min(barCount, Math.round(this.voiceProgressDisplayRatio(attachment) * barCount)));
    return index < activeBars;
  }

  voiceIsPlaying(attachment: ChatMessage['attachment']): boolean {
    return this.voiceUiState(attachment).playing;
  }

  voiceIsMuted(attachment: ChatMessage['attachment']): boolean {
    return this.voiceUiState(attachment).muted;
  }

  voiceVolumePercent(attachment: ChatMessage['attachment']): number {
    const volume = this.voiceUiState(attachment).volume;
    return Math.round(Math.max(0, Math.min(1, Number(volume || 0))) * 100);
  }

  voiceVolumeIcon(attachment: ChatMessage['attachment']): string {
    return this.voiceIsMuted(attachment) ? 'volume_off' : 'volume_up';
  }

  showVoiceVolumeSlider(attachment: ChatMessage['attachment']) {
    this.voiceVolumeHoverKey = this.voiceAttachmentKey(attachment);
  }

  hideVoiceVolumeSlider(attachment?: ChatMessage['attachment']) {
    if (!attachment) {
      this.voiceVolumeHoverKey = null;
      return;
    }
    const key = this.voiceAttachmentKey(attachment);
    if (this.voiceVolumeHoverKey === key) this.voiceVolumeHoverKey = null;
  }

  isVoiceVolumeSliderVisible(attachment: ChatMessage['attachment']): boolean {
    return this.voiceVolumeHoverKey === this.voiceAttachmentKey(attachment);
  }

  setVoiceVolume(attachment: ChatMessage['attachment'], value: number | string, event?: Event, audioEl?: HTMLAudioElement | null) {
    event?.stopPropagation();
    if (!attachment) return;

    const key = this.voiceAttachmentKey(attachment);
    this.activeVoiceKey = key;
    const next = Math.max(0, Math.min(1, Number(value) / 100));
    const audio = this.resolveVoiceAudioElement(key, audioEl);
    if (audio) {
      audio.volume = next;
      if (next > 0 && audio.muted) audio.muted = false;
      if (next === 0) audio.muted = true;
    }
    this.applyVoiceMutedToDom(key, next === 0);

    const state = this.voiceUiState(attachment);
    state.volume = next;
    state.muted = next === 0 ? true : false;
    if (next > 0) this.voiceLastNonZeroVolumeByKey[key] = next;
    this.voiceUiStateByKey[key] = state;
  }

  toggleVoicePlay(attachment: ChatMessage['attachment'], event?: Event, audioEl?: HTMLAudioElement | null) {
    event?.stopPropagation();
    if (!attachment) return;
    const key = this.voiceAttachmentKey(attachment);
    this.activeVoiceKey = key;
    const audio = this.resolveVoiceAudioElement(key, audioEl);
    if (!audio) return;

    if (audio.paused) {
      this.pauseAllVoicePlayersExcept(key);
      void this.prepareVoiceSourceForPlayback(attachment, audio)
        .finally(() => {
          audio.playbackRate = this.voicePlaybackRate(attachment);
          audio.defaultPlaybackRate = this.voicePlaybackRate(attachment);
          const remaining = Number(audio.duration || 0) - Number(audio.currentTime || 0);
          if (Number.isFinite(remaining) && remaining <= 0.05) {
            audio.currentTime = 0;
          }
          void audio.play();
        });
    } else {
      audio.pause();
    }
  }

  toggleVoiceMute(attachment: ChatMessage['attachment'], event?: Event, audioEl?: HTMLAudioElement | null) {
    event?.stopPropagation();
    if (!attachment) return;
    const key = this.voiceAttachmentKey(attachment);
    this.activeVoiceKey = key;
    const state = this.voiceUiState(attachment);
    const nextMuted = !state.muted;
    const audio = this.resolveVoiceAudioElement(key, audioEl);

    if (nextMuted) {
      const currentVolume = Number(audio?.volume ?? state.volume ?? 1);
      if (currentVolume > 0) this.voiceLastNonZeroVolumeByKey[key] = currentVolume;
      if (audio) {
        audio.muted = true;
        audio.defaultMuted = true;
        audio.volume = 0;
      }
      state.muted = true;
      state.volume = 0;
      this.applyVoiceMutedToDom(key, true);
    } else {
      const restored = Math.max(0.05, Math.min(1, Number(this.voiceLastNonZeroVolumeByKey[key] || 1)));
      if (audio) {
        audio.muted = false;
        audio.defaultMuted = false;
        audio.volume = restored;
      }
      state.muted = false;
      state.volume = restored;
      this.applyVoiceMutedToDom(key, false);
      this.voiceLastNonZeroVolumeByKey[key] = restored;
    }

    this.voiceUiStateByKey[key] = state;
  }

  seekVoiceFromWaveform(attachment: ChatMessage['attachment'], event: PointerEvent, audioEl?: HTMLAudioElement | null) {
    event.stopPropagation();
    event.preventDefault();
    if (!attachment) return;
    const host = event.currentTarget as HTMLElement | null;
    this.activeVoiceKey = this.voiceAttachmentKey(attachment);
    this.voiceWaveformScrub = {
      pointerId: event.pointerId,
      key: this.voiceAttachmentKey(attachment),
      host
    };
    if (host?.setPointerCapture) {
      try {
        host.setPointerCapture(event.pointerId);
      } catch {
        // no-op
      }
    }

    this.seekVoiceFromWaveformEvent(attachment, event, audioEl);
  }

  updateVoiceWaveformSeek(attachment: ChatMessage['attachment'], event: PointerEvent, audioEl?: HTMLAudioElement | null) {
    if (!attachment || !this.voiceWaveformScrub) return;
    const key = this.voiceAttachmentKey(attachment);
    if (this.voiceWaveformScrub.pointerId !== event.pointerId || this.voiceWaveformScrub.key !== key) return;
    this.seekVoiceFromWaveformEvent(attachment, event, audioEl);
  }

  finishVoiceWaveformSeek(event?: PointerEvent) {
    if (event && this.voiceWaveformScrub && event.pointerId !== this.voiceWaveformScrub.pointerId) return;
    if (event && this.voiceWaveformScrub?.host?.releasePointerCapture) {
      try {
        this.voiceWaveformScrub.host.releasePointerCapture(event.pointerId);
      } catch {
        // no-op
      }
    }
    this.voiceWaveformScrub = null;
  }

  private seekVoiceFromWaveformEvent(attachment: ChatMessage['attachment'], event: PointerEvent, audioEl?: HTMLAudioElement | null) {
    const host = event.currentTarget as HTMLElement | null;
    if (!host) return;

    const rect = host.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const localRatio = Math.max(0, Math.min(1, rect.width > 0 ? x / rect.width : 0));
    const { start, span } = this.voiceWaveformWindow(attachment);
    const ratio = Math.max(0, Math.min(1, start + (localRatio * span)));
    this.seekVoiceToRatio(attachment, ratio, audioEl);
  }

  onVoiceAudioMetadata(event: Event, attachment: ChatMessage['attachment'], message?: ChatMessage | null) {
    const audio = event.target as HTMLAudioElement | null;
    if (!audio || !attachment) return;

    const duration = this.resolveVoiceDuration(audio, attachment);
    if (Number.isFinite(duration) && duration > 0) {
      const current = Number(attachment.durationSeconds || 0);
      const roundedDuration = Math.max(1, Math.round(duration));
      if (!current || Math.abs(current - roundedDuration) >= 1) {
        attachment.durationSeconds = roundedDuration;
      }
    }

    const key = this.voiceAttachmentKey(attachment);
    this.ensureVoiceInsightsKnown(attachment);
    this.voiceAudioElementByKey.set(key, audio);
    void this.cacheVoiceAttachmentForOffline(attachment);
    const nextState = this.voiceUiState(attachment);
    const currentDuration = Number.isFinite(nextState.duration) ? nextState.duration : 0;
    nextState.duration = Math.max(currentDuration, duration || 0);
    nextState.currentTime = Number(audio.currentTime || 0);
    nextState.playing = !audio.paused;
    nextState.muted = !!audio.muted;
    nextState.volume = Number.isFinite(audio.volume) ? audio.volume : nextState.volume;
    this.voiceUiStateByKey[key] = nextState;
    if (!nextState.duration || nextState.duration <= 0) this.ensureVoiceDurationResolved(attachment);

    const pendingSeek = Number(this.voicePendingSeekRatioByKey[key]);
    if (Number.isFinite(pendingSeek) && pendingSeek >= 0 && pendingSeek <= 1) {
      delete this.voicePendingSeekRatioByKey[key];
      this.seekVoiceToRatio(attachment, pendingSeek, audio);
    }

    this.applyVoicePlaybackRateToDom(key, this.voicePlaybackRate(attachment));

    if (message) {
      this.maybeEmitPrivateAudioPlaybackReceipt(message, attachment, nextState.currentTime, nextState.duration);
    }
  }

  onVoiceAudioTimeUpdate(event: Event, attachment: ChatMessage['attachment'], message?: ChatMessage | null) {
    const audio = event.target as HTMLAudioElement | null;
    if (!audio || !attachment) return;
    const key = this.voiceAttachmentKey(attachment);
    this.ensureVoiceInsightsKnown(attachment);
    this.voiceAudioElementByKey.set(key, audio);
    const state = this.voiceUiState(attachment);
    state.currentTime = Number(audio.currentTime || 0);
    const resolvedDuration = this.resolveVoiceDuration(audio, attachment);
    const safeStateDuration = Number.isFinite(state.duration) ? state.duration : 0;
    state.duration = Math.max(safeStateDuration, resolvedDuration || (state.currentTime + 0.2));
    if (resolvedDuration > 0 && (!attachment.durationSeconds || attachment.durationSeconds <= 0)) {
      attachment.durationSeconds = Math.max(1, Math.round(resolvedDuration));
    }
    state.playing = !audio.paused;
    state.muted = !!audio.muted;
    state.volume = Number.isFinite(audio.volume) ? audio.volume : state.volume;
    this.voiceUiStateByKey[key] = state;

    if (message) {
      this.maybeEmitPrivateAudioPlaybackReceipt(message, attachment, state.currentTime, state.duration);
    }
  }

  onVoiceAudioPlay(attachment: ChatMessage['attachment'], event?: Event, message?: ChatMessage | null) {
    const key = this.voiceAttachmentKey(attachment);
    this.activeVoiceKey = key;
    this.ensureVoiceInsightsKnown(attachment);
    void this.cacheVoiceAttachmentForOffline(attachment);
    const state = this.voiceUiState(attachment);
    const audio = event?.target as HTMLAudioElement | null;
    if (audio) this.voiceAudioElementByKey.set(key, audio);
    state.playing = true;
    state.volume = Number.isFinite(Number(audio?.volume)) ? Number(audio?.volume) : state.volume;
    this.voiceUiStateByKey[key] = state;
    this.startVoiceProgressTracking(key, attachment, audio);

    if (message) {
      this.maybeEmitPrivateAudioPlaybackReceipt(message, attachment, state.currentTime, state.duration);
    }
  }

  onVoiceAudioPause(attachment: ChatMessage['attachment'], event?: Event, message?: ChatMessage | null) {
    const key = this.voiceAttachmentKey(attachment);
    const audio = event?.target as HTMLAudioElement | null;
    if (audio) this.voiceAudioElementByKey.set(key, audio);
    const state = this.voiceUiState(attachment);
    state.playing = false;
    if (audio) {
      state.currentTime = Number(audio.currentTime || state.currentTime || 0);
      const resolvedDuration = this.resolveVoiceDuration(audio, attachment);
      const safeStateDuration = Number.isFinite(state.duration) ? state.duration : 0;
      state.duration = Math.max(safeStateDuration, resolvedDuration || state.currentTime || 0);
      state.muted = !!audio.muted;
      state.volume = Number.isFinite(audio.volume) ? audio.volume : state.volume;
      if (attachment && state.duration > 0) {
        attachment.durationSeconds = Math.max(1, Math.round(state.duration));
      }
    }
    this.voiceUiStateByKey[key] = state;
    this.stopVoiceProgressTracking(key);

    if (message) {
      this.maybeEmitPrivateAudioPlaybackReceipt(message, attachment, state.currentTime, state.duration, true);
    }
  }

  onVoiceAudioEnded(attachment: ChatMessage['attachment'], event?: Event, message?: ChatMessage | null) {
    const key = this.voiceAttachmentKey(attachment);
    this.activeVoiceKey = key;
    const audio = event?.target as HTMLAudioElement | null;
    if (audio) this.voiceAudioElementByKey.set(key, audio);
    const state = this.voiceUiState(attachment);
    state.playing = false;
    const safeDuration = Number.isFinite(state.duration) ? state.duration : 0;
    state.currentTime = Math.max(state.currentTime, safeDuration || Number(attachment?.durationSeconds || 0));
    state.duration = Math.max(safeDuration, state.currentTime);
    if (attachment && state.duration > 0) {
      attachment.durationSeconds = Math.max(1, Math.round(state.duration));
    }
    this.voiceUiStateByKey[key] = state;
    this.stopVoiceProgressTracking(key);

    if (message) {
      const duration = Math.max(0, Number(state.duration || attachment?.durationSeconds || 0));
      this.maybeEmitPrivateAudioPlaybackReceipt(message, attachment, duration, duration, true);
    }

    if (this.voiceAutoPlayNext) {
      const movedWithinReference = this.tryAutoAdvanceReferenceAudio(attachment);
      if (!movedWithinReference) {
        setTimeout(() => this.playNextVoiceInQueue(key), 70);
      }
    }
  }

  onVoiceAudioError(event: Event, attachment: ChatMessage['attachment']) {
    const audio = event.target as HTMLAudioElement | null;
    if (!audio || !attachment) return;
    void this.restoreVoiceSourceFromOfflineCache(attachment, audio);
  }

  trackByNumber(index: number, value: number): string {
    return `${index}:${value}`;
  }

  isVideoAttachment(attachment: ChatMessage['attachment']): boolean {
    const mime = String(attachment?.mimeType || '').trim().toLowerCase();
    if (mime.startsWith('video/')) return true;
    const name = String(attachment?.name || '').toLowerCase();
    return /\.(mp4|mov|mkv|avi|m4v)$/i.test(name);
  }

  private applyVoicePlaybackRateToDom(key: string, rate: number) {
    if (!key) return;
    const elements = document.querySelectorAll(`audio[data-voice-audio-key="${key}"]`);
    elements.forEach((item) => {
      const audio = item as HTMLAudioElement;
      audio.playbackRate = rate;
      audio.defaultPlaybackRate = rate;
    });
  }

  private applyVoiceMutedToDom(key: string, muted: boolean) {
    if (!key) return;
    const elements = document.querySelectorAll(`audio[data-voice-audio-key="${key}"]`);
    elements.forEach((item) => {
      const audio = item as HTMLAudioElement;
      audio.muted = muted;
      audio.defaultMuted = muted;
    });
  }

  private pauseAllVoicePlayersExcept(keyToKeep: string) {
    const audios = document.querySelectorAll('audio[data-voice-audio-key]');
    audios.forEach((node) => {
      const audio = node as HTMLAudioElement;
      const key = String(audio.getAttribute('data-voice-audio-key') || '');
      if (!key || key === keyToKeep) return;
      if (!audio.paused) audio.pause();
    });
  }

  private playNextVoiceInQueue(currentKey: string) {
    if (!currentKey) return;
    const nodes = Array.from(document.querySelectorAll('audio[data-voice-audio-key]')) as HTMLAudioElement[];
    if (!nodes.length) return;

    const orderedKeys = nodes.reduce((acc, node) => {
      const key = String(node.getAttribute('data-voice-audio-key') || '');
      if (key && !acc.includes(key)) acc.push(key);
      return acc;
    }, [] as string[]);

    const index = orderedKeys.indexOf(currentKey);
    if (index < 0 || index >= orderedKeys.length - 1) return;

    const nextKey = orderedKeys[index + 1];
    const nextAudio = this.resolveVoiceAudioElement(nextKey, null);
    if (!nextAudio) return;

    const nextAttachment = this.voiceAttachmentByKey[nextKey] || null;
    this.pauseAllVoicePlayersExcept(nextKey);
    if (nextAttachment) {
      const rate = this.voicePlaybackRate(nextAttachment);
      nextAudio.playbackRate = rate;
      nextAudio.defaultPlaybackRate = rate;
    }

    const remaining = Number(nextAudio.duration || 0) - Number(nextAudio.currentTime || 0);
    if (Number.isFinite(remaining) && remaining <= 0.05) {
      nextAudio.currentTime = 0;
    }

    this.activeVoiceKey = nextKey;
    void nextAudio.play();
  }

  private async prepareVoiceSourceForPlayback(attachment: ChatMessage['attachment'], audio: HTMLAudioElement): Promise<void> {
    if (!attachment || !audio) return;
    void this.cacheVoiceAttachmentForOffline(attachment);

    if (navigator.onLine) return;
    await this.restoreVoiceSourceFromOfflineCache(attachment, audio);
  }

  private async cacheVoiceAttachmentForOffline(attachment: ChatMessage['attachment']): Promise<void> {
    if (!this.offlineVoiceCacheEnabled || !attachment?.url || !('caches' in window)) return;
    const sourceUrl = this.attachmentUrl(attachment);
    if (!sourceUrl || this.voiceOfflineCachedUrlSet.has(sourceUrl) || this.voiceOfflineCacheLoading.has(sourceUrl)) return;

    this.voiceOfflineCacheLoading.add(sourceUrl);
    try {
      const response = await fetch(sourceUrl, { credentials: 'include' });
      if (!response.ok) return;
      const cache = await caches.open(this.voiceOfflineCacheStore);
      await cache.put(sourceUrl, response.clone());
      this.touchVoiceOfflineCacheEntry(sourceUrl);

      const overflow = this.voiceOfflineCacheIndex.slice(this.voiceOfflineCacheLimit);
      this.voiceOfflineCacheIndex = this.voiceOfflineCacheIndex.slice(0, this.voiceOfflineCacheLimit);
      this.voiceOfflineCachedUrlSet = new Set(this.voiceOfflineCacheIndex.map((item) => item.url));

      for (const item of overflow) {
        await cache.delete(item.url);
        const blobUrl = this.voiceOfflineBlobUrlBySource[item.url];
        if (blobUrl) {
          try {
            URL.revokeObjectURL(blobUrl);
          } catch {
            // no-op
          }
          delete this.voiceOfflineBlobUrlBySource[item.url];
        }
      }

      this.persistVoiceOfflineCacheIndex();
    } catch {
      // no-op
    } finally {
      this.voiceOfflineCacheLoading.delete(sourceUrl);
    }
  }

  private async restoreVoiceSourceFromOfflineCache(attachment: ChatMessage['attachment'], audio: HTMLAudioElement): Promise<void> {
    if (!this.offlineVoiceCacheEnabled || !attachment?.url || !audio || !('caches' in window)) return;
    const sourceUrl = this.attachmentUrl(attachment);
    if (!sourceUrl) return;

    const cachedBlobUrl = await this.cachedVoiceBlobUrlForSource(sourceUrl);
    if (!cachedBlobUrl) return;

    if (audio.src === cachedBlobUrl) return;

    const shouldResume = !audio.paused;
    const state = this.voiceUiState(attachment);
    const restoreTime = Math.max(0, Number(audio.currentTime || state.currentTime || 0));
    audio.src = cachedBlobUrl;
    audio.load();

    const restoreAfterMetadata = () => {
      try {
        audio.currentTime = restoreTime;
      } catch {
        // no-op
      }
      if (shouldResume) {
        void audio.play();
      }
      audio.removeEventListener('loadedmetadata', restoreAfterMetadata);
    };

    audio.addEventListener('loadedmetadata', restoreAfterMetadata);
    this.touchVoiceOfflineCacheEntry(sourceUrl);
    this.persistVoiceOfflineCacheIndex();
  }

  private async cachedVoiceBlobUrlForSource(sourceUrl: string): Promise<string | null> {
    if (!sourceUrl || !('caches' in window)) return null;
    const existing = this.voiceOfflineBlobUrlBySource[sourceUrl];
    if (existing) return existing;

    try {
      const cache = await caches.open(this.voiceOfflineCacheStore);
      const match = await cache.match(sourceUrl);
      if (!match) {
        this.voiceOfflineCacheIndex = this.voiceOfflineCacheIndex.filter((item) => item.url !== sourceUrl);
        this.voiceOfflineCachedUrlSet.delete(sourceUrl);
        this.persistVoiceOfflineCacheIndex();
        return null;
      }
      const blob = await match.blob();
      const blobUrl = URL.createObjectURL(blob);
      this.voiceOfflineBlobUrlBySource[sourceUrl] = blobUrl;
      return blobUrl;
    } catch {
      return null;
    }
  }

  private touchVoiceOfflineCacheEntry(sourceUrl: string) {
    if (!sourceUrl) return;
    this.voiceOfflineCacheIndex = [
      { url: sourceUrl, cachedAt: Date.now() },
      ...this.voiceOfflineCacheIndex.filter((item) => item.url !== sourceUrl)
    ];
    this.voiceOfflineCachedUrlSet.add(sourceUrl);
  }

  private maybeEmitPrivateAudioPlaybackReceipt(
    message: ChatMessage,
    attachment: ChatMessage['attachment'],
    currentTimeSeconds: number,
    durationSeconds: number,
    force = false
  ) {
    if (!message?.id || !attachment) return;
    if (!message.to || message.to !== this.myUsername) return;
    if (message.from === this.myUsername) return;
    if (!this.isAudioAttachment(attachment)) return;

    const duration = Math.max(0, Number(durationSeconds || attachment.durationSeconds || 0));
    const current = Math.max(0, Number(currentTimeSeconds || 0));
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(current) || current <= 0) return;

    const progress = Math.max(0, Math.min(1, current / duration));
    if (progress < 0.03) return;

    const now = Date.now();
    const previous = this.voicePlaybackEmitStateByMessageId[message.id] || { at: 0, progress: 0 };
    const steppedProgress = Math.max(previous.progress, Math.round(progress * 100) / 100);
    const shouldEmit = force
      || steppedProgress >= 0.99
      || steppedProgress >= previous.progress + 0.05
      || now - previous.at >= 10000;
    if (!shouldEmit) return;

    this.voicePlaybackEmitStateByMessageId[message.id] = {
      at: now,
      progress: steppedProgress
    };

    this.socket.emitEvent('audioPlaybackProgress', {
      id: message.id,
      progress: steppedProgress,
      currentTimeSeconds: Math.round(current),
      durationSeconds: Math.round(duration),
      attachmentKey: this.voiceAttachmentKey(attachment)
    });
  }

  private applyVoiceSilenceSkip(
    key: string,
    attachment: ChatMessage['attachment'],
    audio: HTMLAudioElement,
    resolvedDuration: number
  ) {
    if (!attachment) return;
    const duration = Math.max(0, Number(resolvedDuration || attachment.durationSeconds || audio.duration || 0));
    if (!Number.isFinite(duration) || duration <= 1.5) return;
    if (this.voiceWaveformQualityByKey[key] !== 'real') return;

    let ranges = this.voiceSilenceRangesByKey[key];
    if (!Array.isArray(ranges) || !ranges.length) {
      const bars = this.voiceWaveformSourceBars(attachment);
      ranges = this.buildVoiceSilenceRangesFromBars(bars, duration);
      this.voiceSilenceRangesByKey[key] = ranges;
    }
    if (!ranges.length) return;

    const now = Date.now();
    const last = Number(this.voiceLastSilenceSkipAtByKey[key] || 0);
    if (now - last < 150) return;

    const currentTime = Number(audio.currentTime || 0);
    const hit = ranges.find((range) => currentTime >= range.start && currentTime < (range.end - 0.05));
    if (!hit) return;

    const jumpTo = Math.min(duration - 0.04, hit.end + 0.03);
    if (!(jumpTo > currentTime + 0.1)) return;

    try {
      audio.currentTime = jumpTo;
      this.voiceLastSilenceSkipAtByKey[key] = now;
    } catch {
      // no-op
    }
  }

  private buildVoiceSilenceRangesFromBars(bars: number[], durationSeconds: number): Array<{ start: number; end: number }> {
    if (!Array.isArray(bars) || !bars.length || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];
    const minBar = Math.min(...bars);
    const maxBar = Math.max(...bars);
    const threshold = minBar + Math.max(1, (maxBar - minBar) * 0.18);
    const minRunBars = Math.max(2, Math.floor(bars.length * 0.035));
    const ranges: Array<{ start: number; end: number }> = [];

    let runStart = -1;
    for (let i = 0; i < bars.length; i += 1) {
      const isSilent = Number(bars[i]) <= threshold;
      if (isSilent) {
        if (runStart < 0) runStart = i;
        continue;
      }

      if (runStart >= 0) {
        const runLength = i - runStart;
        if (runLength >= minRunBars) {
          const start = (runStart / bars.length) * durationSeconds;
          const end = (i / bars.length) * durationSeconds;
          if (end - start >= 0.35) ranges.push({ start, end });
        }
        runStart = -1;
      }
    }

    if (runStart >= 0) {
      const runLength = bars.length - runStart;
      if (runLength >= minRunBars) {
        const start = (runStart / bars.length) * durationSeconds;
        const end = durationSeconds;
        if (end - start >= 0.35) ranges.push({ start, end });
      }
    }

    return ranges;
  }

  private firstVoiceAudioElement(key: string): HTMLAudioElement | null {
    if (!key) return null;
    return document.querySelector(`audio[data-voice-audio-key="${key}"]`) as HTMLAudioElement | null;
  }

  private resolveVoiceAudioElement(key: string, preferred?: HTMLAudioElement | null): HTMLAudioElement | null {
    if (preferred) return preferred;
    if (!key) return null;
    const list = Array.from(document.querySelectorAll(`audio[data-voice-audio-key="${key}"]`)) as HTMLAudioElement[];
    return list.find((x) => !x.paused) || list[0] || null;
  }

  private seekVoiceToRatio(attachment: ChatMessage['attachment'], ratio: number, audioEl?: HTMLAudioElement | null) {
    const key = this.voiceAttachmentKey(attachment);
    this.activeVoiceKey = key;
    const audio = this.resolveVoiceAudioElement(key, audioEl);
    if (!audio) return;

    const clamped = Math.max(0, Math.min(1, Number(ratio || 0)));
    const state = this.voiceUiState(attachment);
    const duration = this.resolveVoiceDuration(audio, attachment);
    const fallbackDuration = Math.max(0, Number(state.duration || 0), Number(attachment?.durationSeconds || 0));
    const resolvedDuration = Number.isFinite(duration) && duration > 0 ? duration : fallbackDuration;
    if (!Number.isFinite(resolvedDuration) || resolvedDuration <= 0) {
      this.voicePendingSeekRatioByKey[key] = clamped;
      return;
    }

    const time = resolvedDuration * clamped;
    try {
      audio.currentTime = time;
    } catch {
      this.voicePendingSeekRatioByKey[key] = clamped;
      return;
    }

    state.currentTime = time;
    state.duration = Math.max(state.duration, resolvedDuration);
    state.playing = !audio.paused;
    state.muted = !!audio.muted;
    state.volume = Number.isFinite(audio.volume) ? audio.volume : state.volume;
    this.voiceUiStateByKey[key] = state;
    if (attachment && (!attachment.durationSeconds || attachment.durationSeconds <= 0)) {
      attachment.durationSeconds = Math.max(1, Math.round(resolvedDuration));
    }
  }

  private voiceUiState(attachment: ChatMessage['attachment']): { currentTime: number; duration: number; playing: boolean; muted: boolean; volume: number } {
    const key = this.voiceAttachmentKey(attachment);
    const existing = this.voiceUiStateByKey[key];
    if (existing) {
      const sanitized = {
        currentTime: Number.isFinite(existing.currentTime) && existing.currentTime >= 0 ? existing.currentTime : 0,
        duration: Number.isFinite(existing.duration) && existing.duration >= 0 ? existing.duration : 0,
        playing: !!existing.playing,
        muted: !!existing.muted,
        volume: Number.isFinite(existing.volume) ? Math.max(0, Math.min(1, existing.volume)) : 1
      };
      this.voiceUiStateByKey[key] = sanitized;
      return sanitized;
    }
    return { currentTime: 0, duration: Number(attachment?.durationSeconds || 0), playing: false, muted: false, volume: 1 };
  }

  private resolveVoiceDuration(audio: HTMLAudioElement | null, attachment: ChatMessage['attachment']): number {
    const direct = Number(audio?.duration || 0);
    if (Number.isFinite(direct) && direct > 0) return direct;

    try {
      const buffered = audio?.buffered;
      if (buffered && buffered.length > 0) {
        const end = Number(buffered.end(buffered.length - 1));
        if (Number.isFinite(end) && end > 0) return end;
      }

      const seekable = audio?.seekable;
      if (seekable && seekable.length > 0) {
        const tail = Number(seekable.end(seekable.length - 1));
        if (Number.isFinite(tail) && tail > 0) return tail;
      }
    } catch {
      // no-op
    }

    return Number(attachment?.durationSeconds || 0);
  }

  private ensureVoiceDurationResolved(attachment: ChatMessage['attachment']) {
    if (!attachment?.url || !this.isAudioAttachment(attachment)) return;
    const key = this.voiceAttachmentKey(attachment);
    const state = this.voiceUiState(attachment);
    if (Number(state.duration || 0) > 0 || Number(attachment.durationSeconds || 0) > 0) return;
    if (this.voiceDurationResolveLoading.has(key)) return;

    this.voiceDurationResolveLoading.add(key);
    const sourceUrl = this.attachmentUrl(attachment);
    void this.decodeAudioDurationFromUrl(sourceUrl)
      .then((duration) => {
        if (!duration || duration <= 0) return;
        attachment.durationSeconds = Math.max(1, Math.round(duration));
        const nextState = this.voiceUiState(attachment);
        nextState.duration = Math.max(nextState.duration, duration);
        this.voiceUiStateByKey[key] = nextState;
      })
      .finally(() => {
        this.voiceDurationResolveLoading.delete(key);
      });
  }

  private async decodeAudioDurationFromUrl(sourceUrl: string): Promise<number | undefined> {
    if (!sourceUrl) return undefined;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return undefined;

    try {
      const response = await fetch(sourceUrl);
      if (!response.ok) return undefined;
      const buffer = await response.arrayBuffer();

      const context = new AudioCtx();
      try {
        const decoded = await context.decodeAudioData(buffer.slice(0));
        const duration = Number(decoded?.duration || 0);
        return Number.isFinite(duration) && duration > 0 ? duration : undefined;
      } finally {
        await context.close();
      }
    } catch {
      return undefined;
    }
  }

  private startVoiceProgressTracking(key: string, attachment: ChatMessage['attachment'], preferredAudio?: HTMLAudioElement | null) {
    if (!key) return;
    this.stopVoiceProgressTracking(key);
    const timer = setInterval(() => {
      const audio = this.resolveVoiceAudioElement(key, preferredAudio);
      if (!audio) return;
      const state = this.voiceUiState(attachment);
      state.currentTime = Number(audio.currentTime || 0);
      const resolvedDuration = this.resolveVoiceDuration(audio, attachment);
      const safeStateDuration = Number.isFinite(state.duration) ? state.duration : 0;
      state.duration = Math.max(safeStateDuration, resolvedDuration || (state.currentTime + 0.2));
      state.playing = !audio.paused;
      state.muted = !!audio.muted;
      state.volume = Number.isFinite(audio.volume) ? audio.volume : state.volume;
      if (this.voiceSilenceSkipEnabled && !audio.paused && !audio.ended) {
        this.applyVoiceSilenceSkip(key, attachment, audio, state.duration);
      }
      if (attachment && state.duration > 0 && (!attachment.durationSeconds || attachment.durationSeconds <= 0)) {
        attachment.durationSeconds = Math.max(1, Math.round(state.duration));
      }
      this.voiceUiStateByKey[key] = state;
      if (audio.paused || audio.ended) this.stopVoiceProgressTracking(key);
    }, 40);
    this.voiceProgressTimers.set(key, timer);
  }

  private stopVoiceProgressTracking(key: string) {
    const timer = this.voiceProgressTimers.get(key);
    if (!timer) return;
    clearInterval(timer);
    this.voiceProgressTimers.delete(key);
  }

  private async generateVoiceWaveform(sourceUrl: string, attachment?: ChatMessage['attachment']): Promise<number[]> {
    if (!sourceUrl) return this.defaultVoiceWaveform;
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error('Waveform fetch failed');

    const buffer = await response.arrayBuffer();
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return this.defaultVoiceWaveform;
    const context = new AudioCtx();
    try {
      const decoded = await context.decodeAudioData(buffer.slice(0));
      const channelData = decoded.getChannelData(0);
      this.ensureVoiceInsightsKnown(attachment || null, {
        sampleRateHz: Number(decoded?.sampleRate || 0) || undefined,
        channels: Number(decoded?.numberOfChannels || 0) || undefined,
        bitrateKbps: this.approximateAudioBitrateKbps(
          Number(attachment?.size || 0),
          Number(decoded?.duration || attachment?.durationSeconds || 0)
        ) || undefined
      });
      if (!channelData?.length) return this.defaultVoiceWaveform;
      return this.buildWaveformFromChannelData(channelData, 48);
    } finally {
      try {
        await context.close();
      } catch {
        // no-op
      }
    }
  }

  private buildWaveformFromChannelData(channelData: Float32Array, bars: number): number[] {
    const totalBars = Math.max(12, Math.min(96, Math.round(Number(bars || 48))));
    const blockSize = Math.max(1, Math.floor(channelData.length / totalBars));
    const peaks: number[] = [];
    for (let i = 0; i < totalBars; i += 1) {
      const start = i * blockSize;
      const end = Math.min(channelData.length, start + blockSize);
      let peak = 0;
      for (let j = start; j < end; j += 1) {
        const value = Math.abs(channelData[j]);
        if (value > peak) peak = value;
      }
      peaks.push(peak);
    }

    const maxPeak = Math.max(...peaks, 0.0001);
    return peaks.map((peak) => Math.max(2, Math.round((peak / maxPeak) * 13) + 2));
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
    if (
      target?.closest('.messageActions') ||
      target?.closest('.editInline') ||
      target?.closest('.voicePlayerShell')
    ) return;

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

  openProfile() {
    this.router.navigate(['/profile']);
  }

  openUserProfileCard(username: string | null | undefined) {
    const key = String(username || '').trim().toLowerCase();
    if (!key) return;
    this.userProfileCardOpen = true;
    this.userProfileCardLoading = true;
    this.userProfileCardUsername = key;
    // Don't use cached data that might be incomplete (from ensureUserProfile)
    this.userProfileCardData = null;

    this.auth.getPublicProfile(key).subscribe({
      next: (res: any) => {
        console.log('[DEBUG] API response age:', res?.age, 'birthDate:', res?.birthDate);
        this.userPublicProfileByUsername[key] = {
          username: String(res?.username || key),
          displayName: String(res?.displayName || key),
          avatarUrl: String(res?.avatarUrl || ''),
          role: String(res?.role || 'user'),
          statusText: String(res?.statusText || ''),
          bio: String(res?.bio || ''),
          timezone: String(res?.timezone || 'UTC'),
          lastSeenAt: res?.lastSeenAt || null,
          emailVerified: !!res?.emailVerified,
          gender: res?.gender || null,
          age: typeof res?.age === 'number' ? res.age : 0,
          country: res?.country || null,
          joinedAt: res?.joinedAt || null,
          socialLinks: res?.socialLinks || {},
          isOnline: this.onlineUsers.includes(key)
        };
        this.userAvatarUrlByUsername[key] = String(res?.avatarUrl || '').trim();
        this.userProfileCardData = this.userPublicProfileByUsername[key];
      },
      error: () => {
        // Only use cached data if it has age field (meaning it was loaded by openUserProfileCard before)
        const cached = this.userPublicProfileByUsername[key];
        if (cached && cached.age !== undefined) {
          this.userProfileCardData = cached;
        } else {
          this.userProfileCardData = {
            username: key,
            displayName: key,
            role: 'user'
          };
        }
      },
      complete: () => {
        this.userProfileCardLoading = false;
      }
    });
  }

  closeUserProfileCard() {
    this.userProfileCardOpen = false;
    this.userProfileCardLoading = false;
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
      const referenceAttachments = this.messageAttachments(quoted);
      this.replyingTo = {
        messageId: quoted.id,
        from: quoted.from,
        text: this.messageReplySeedText(quoted),
        attachment: this.preferredReferenceAttachment(referenceAttachments),
        attachments: referenceAttachments,
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

  private ensureUserProfile(username: string | null | undefined) {
    const key = String(username || '').trim().toLowerCase();
    if (!key) return;
    if (this.userAvatarUrlByUsername[key] !== undefined) return;
    if (this.userProfileLookupBusy.has(key)) return;

    this.userProfileLookupBusy.add(key);
    this.auth.getPublicProfile(key).subscribe({
      next: (res: any) => {
        this.userAvatarUrlByUsername[key] = String(res?.avatarUrl || '').trim();
        this.userPublicProfileByUsername[key] = {
          username: String(res?.username || key),
          displayName: String(res?.displayName || key),
          avatarUrl: String(res?.avatarUrl || ''),
          role: String(res?.role || 'user'),
          statusText: String(res?.statusText || ''),
          bio: String(res?.bio || ''),
          timezone: String(res?.timezone || 'UTC'),
          lastSeenAt: res?.lastSeenAt || null
        };
      },
      error: () => {
        this.userAvatarUrlByUsername[key] = '';
        this.userPublicProfileByUsername[key] = {
          username: key,
          displayName: key,
          avatarUrl: '',
          role: 'user',
          statusText: '',
          bio: '',
          timezone: 'UTC',
          lastSeenAt: null
        };
      },
      complete: () => {
        this.userProfileLookupBusy.delete(key);
      }
    });
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

  lastMessageTime(u: string): string {
    const arr = this.privateChats[u] || [];
    if (!arr.length) return '';
    const last = arr[arr.length - 1];
    if (!last?.timestamp) return '';
    const date = new Date(last.timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 7) return `${days}d`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  isUserOnline(username: string): boolean {
    return this.onlineUsers.includes(username);
  }

  onlineUserCount(): number {
    return this.onlineUsers.length;
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

    // Cancel edit when clicking outside the edit area
    if (this.editingMessage && !target.closest('.editInline') && !target.closest('.messageActions')) {
      this.cancelMessageEdit();
    }
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent) {
    if (this.imageViewerTarget) {
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
      return;
    }

    if (this.voiceDraft && (event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter')) {
      if (!(event.ctrlKey || event.altKey || event.metaKey || event.shiftKey)) {
        event.preventDefault();
        event.stopPropagation();
        void this.commitVoiceDraft();
      }
      return;
    }

    if (!this.voiceKeyboardControlsEnabled || this.shouldIgnoreVoiceShortcut(event)) return;
    const attachment = this.activeVoiceAttachment();
    if (!attachment) return;

    if (event.key === ' ' || event.code === 'Space') {
      event.preventDefault();
      this.toggleVoicePlay(attachment);
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.nudgeVoicePosition(attachment, -5);
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.nudgeVoicePosition(attachment, 5);
      return;
    }

    if (event.key === '[') {
      event.preventDefault();
      this.setVoicePlaybackRate(attachment, this.voicePlaybackRate(attachment) - 0.5);
      return;
    }

    if (event.key === ']') {
      event.preventDefault();
      this.setVoicePlaybackRate(attachment, this.voicePlaybackRate(attachment) + 0.5);
      return;
    }

    if (event.key.toLowerCase() === 'm') {
      event.preventDefault();
      this.toggleVoiceMute(attachment);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.setVoiceVolume(attachment, Math.min(100, this.voiceVolumePercent(attachment) + 10));
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.setVoiceVolume(attachment, Math.max(0, this.voiceVolumePercent(attachment) - 10));
    }
  }

  private shouldIgnoreVoiceShortcut(event: KeyboardEvent): boolean {
    if (event.defaultPrevented) return true;
    if (event.ctrlKey || event.altKey || event.metaKey) return true;
    const target = event.target as HTMLElement | null;
    if (!target) return false;
    const tag = String(target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button' || tag === 'a' || target.isContentEditable) return true;
    return false;
  }

  private activeVoiceAttachment(): Attachment | null {
    const key = this.activeVoiceKey || '';
    if (!key) return null;
    const attachment = this.voiceAttachmentByKey[key] || null;
    if (!attachment) return null;
    return attachment;
  }

  private nudgeVoicePosition(attachment: ChatMessage['attachment'], deltaSeconds: number) {
    if (!attachment) return;
    const key = this.voiceAttachmentKey(attachment);
    const audio = this.resolveVoiceAudioElement(key, null);
    if (!audio) return;
    const duration = Math.max(
      0,
      Number(this.resolveVoiceDuration(audio, attachment) || this.voiceUiState(attachment).duration || attachment.durationSeconds || 0)
    );
    const current = Number(audio.currentTime || this.voiceUiState(attachment).currentTime || 0);
    const next = Math.max(0, Math.min(duration > 0 ? duration : Math.max(current + Math.abs(deltaSeconds), 1), current + deltaSeconds));
    if (duration > 0) {
      const ratio = Math.max(0, Math.min(1, next / duration));
      this.seekVoiceToRatio(attachment, ratio, audio);
      return;
    }

    try {
      audio.currentTime = next;
    } catch {
      // no-op
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

  @HostListener('document:pointerup', ['$event'])
  onDocumentPointerUp(event: PointerEvent) {
    this.finishVoiceWaveformSeek(event);
    this.finishVoiceDraftTrimDrag(event);
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
          normalizedPage.forEach((m) => this.ensureUserProfile(m.from));

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
    const normalizeAttachment = (a: any): Attachment | null => {
      if (!a?.url) return null;
      return {
        url: a.url,
        name: a.name || 'Attachment',
        mimeType: a.mimeType || 'application/octet-stream',
        size: Number(a.size || 0),
        isImage: !!a.isImage,
        durationSeconds: Number(a.durationSeconds || 0) || undefined,
        waveform: Array.isArray(a.waveform)
          ? a.waveform.map((x: unknown) => Number(x)).filter((x: number) => Number.isFinite(x) && x > 0).slice(0, 96)
          : undefined,
        audioKind: a.audioKind === 'voice-note' || a.audioKind === 'uploaded-audio' ? a.audioKind : undefined,
        width: Number(a.width || 0) || undefined,
        height: Number(a.height || 0) || undefined,
        storageProvider: a.storageProvider,
        objectKey: a.objectKey
      };
    };

    const normalizeAttachments = (list?: any[] | null, fallback?: any): Attachment[] => {
      const fromArray = Array.isArray(list) ? list : [];
      const normalized = fromArray
        .map((a) => normalizeAttachment(a))
        .filter((a): a is Attachment => !!a?.url);
      if (normalized.length) return normalized;
      const single = normalizeAttachment(fallback);
      return single ? [single] : [];
    };

    const normalizeReference = (
      ref: any,
      fallbackScope: 'public' | 'private'
    ): { messageId: string; from: string; text: string; scope: 'public' | 'private'; attachment?: Attachment | null; attachments?: Attachment[] } | null => {
      if (!ref?.messageId) return null;
      const attachments = normalizeAttachments(ref.attachments, ref.attachment);
      return {
        messageId: ref.messageId,
        from: ref.from || '',
        text: String(ref.text || '').trim().slice(0, 160),
        scope: ref.scope || fallbackScope,
        attachment: this.preferredReferenceAttachment(attachments),
        attachments
      };
    };

    const normalizeAudioPlayback = (playback: any) => {
      if (!playback || typeof playback !== 'object') return null;
      const progress = Number(playback.progress || 0);
      if (!Number.isFinite(progress) || progress <= 0) return null;
      return {
        by: String(playback.by || ''),
        progress: Math.max(0, Math.min(1, progress)),
        currentTimeSeconds: Math.max(0, Number(playback.currentTimeSeconds || 0) || 0),
        durationSeconds: Math.max(0, Number(playback.durationSeconds || 0) || 0),
        attachmentKey: String(playback.attachmentKey || ''),
        listenedAt: playback.listenedAt || null
      };
    };

    const normalizedAttachments = normalizeAttachments(message.attachments, message.attachment);

    return {
      ...message,
      replyTo: normalizeReference(message.replyTo, 'private'),
      forwardedFrom: normalizeReference(message.forwardedFrom, 'private'),
      attachment: this.preferredReferenceAttachment(normalizedAttachments),
      attachments: normalizedAttachments,
      readAt: message.readAt || null,
      audioPlayback: normalizeAudioPlayback((message as any).audioPlayback),
      editedAt: message.editedAt || null,
      deletedAt: message.deletedAt || null,
      reactions: (message.reactions || []).map((r) => ({
        emoji: r.emoji,
        users: Array.from(new Set(r.users || []))
      }))
    };
  }

  messageHasAudioAttachment(message: ChatMessage): boolean {
    return this.messageAttachments(message).some((attachment) => this.isAudioAttachment(attachment));
  }

  audioPlaybackReceiptLabel(message: ChatMessage): string {
    if (!message || message.from !== this.myUsername) return '';
    if (!this.messageHasAudioAttachment(message)) return '';
    const playback = (message as any).audioPlayback;
    const progress = Number(playback?.progress || 0);
    if (!Number.isFinite(progress) || progress <= 0) return '';
    if (progress >= 0.995) return 'Played';
    return `Played ${Math.max(1, Math.round(progress * 100))}%`;
  }

  private applyPrivateAudioPlaybackReceipt(payload: {
    id: string;
    by?: string;
    progress?: number;
    currentTimeSeconds?: number;
    durationSeconds?: number;
    attachmentKey?: string;
    listenedAt?: string | null;
  }) {
    if (!payload?.id) return;
    const progress = Number(payload.progress || 0);
    if (!Number.isFinite(progress) || progress <= 0) return;

    const patch = (message: ChatMessage): ChatMessage => {
      if (message.id !== payload.id) return message;
      const previous = Number((message as any).audioPlayback?.progress || 0);
      const nextProgress = Math.max(previous, Math.max(0, Math.min(1, progress)));
      return {
        ...message,
        audioPlayback: {
          by: String(payload.by || ''),
          progress: nextProgress,
          currentTimeSeconds: Math.max(0, Number(payload.currentTimeSeconds || 0) || 0),
          durationSeconds: Math.max(0, Number(payload.durationSeconds || 0) || 0),
          attachmentKey: String(payload.attachmentKey || ''),
          listenedAt: payload.listenedAt || new Date().toISOString()
        }
      } as ChatMessage;
    };

    Object.keys(this.privateChats).forEach((user) => {
      this.privateChats[user] = (this.privateChats[user] || []).map(patch);
    });
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
          incoming.forEach((m) => this.ensureUserProfile(String(m?.from || '')));
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

          this.privateChats[username].forEach((m) => {
            this.ensureUserProfile(m.from);
            this.ensureUserProfile(m.to);
          });
          this.ensureUserProfile(username);

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

    const list = this.messageAttachments(message);
    if (list.length > 1) return `[Attachments] ${list.length} files`.slice(0, 160);

    const attachmentName = String(list[0]?.name || '').trim();
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
        voiceAutoPlayNext?: boolean;
        voiceSilenceSkipEnabled?: boolean;
        voiceKeyboardControlsEnabled?: boolean;
        offlineVoiceCacheEnabled?: boolean;
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
      if (typeof parsed.voiceAutoPlayNext === 'boolean') {
        this.voiceAutoPlayNext = parsed.voiceAutoPlayNext;
      }
      if (typeof parsed.voiceSilenceSkipEnabled === 'boolean') {
        this.voiceSilenceSkipEnabled = parsed.voiceSilenceSkipEnabled;
      }
      if (typeof parsed.voiceKeyboardControlsEnabled === 'boolean') {
        this.voiceKeyboardControlsEnabled = parsed.voiceKeyboardControlsEnabled;
      }
      if (typeof parsed.offlineVoiceCacheEnabled === 'boolean') {
        this.offlineVoiceCacheEnabled = parsed.offlineVoiceCacheEnabled;
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
              waveform: Array.isArray(a.waveform)
                ? a.waveform.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0).slice(0, 96)
                : undefined,
              audioKind: a.audioKind === 'voice-note' || a.audioKind === 'uploaded-audio' ? a.audioKind : undefined,
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

  private loadUserPreferences() {
    this.auth.getPreferences().subscribe({
      next: (prefs: any) => {
        if (prefs) {
          // Apply preferences that affect chat behavior
          if (typeof prefs.autoplayMedia === 'boolean') {
            this.autoplayMediaPreviews = prefs.autoplayMedia;
          }
          if (prefs.dateFormat) {
            this.dateFormat = prefs.dateFormat;
          }
        }
      },
      error: () => {
        // Use defaults from localStorage
      }
    });
  }

  private persistUploadUiState() {
    try {
      const payload = {
        uploadQuality: this.uploadQuality,
        autoplayMediaPreviews: this.autoplayMediaPreviews,
        autoOpenPrivateMediaTimeline: this.autoOpenPrivateMediaTimeline,
        hideMediaPreviewsByDefault: this.hideMediaPreviewsByDefault,
        voiceAutoPlayNext: this.voiceAutoPlayNext,
        voiceSilenceSkipEnabled: this.voiceSilenceSkipEnabled,
        voiceKeyboardControlsEnabled: this.voiceKeyboardControlsEnabled,
        offlineVoiceCacheEnabled: this.offlineVoiceCacheEnabled,
        pendingAttachments: this.pendingAttachments.slice(0, 20),
        uploadErrors: this.uploadErrors.slice(0, 4),
        failedNames: this.persistedFailedUploadNames.slice(0, 8)
      };
      localStorage.setItem(UPLOAD_UI_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // no-op
    }
  }

  private loadVoiceOfflineCacheIndex() {
    try {
      const raw = localStorage.getItem(VOICE_CACHE_INDEX_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Array<{ url?: string; cachedAt?: number }>;
      if (!Array.isArray(parsed)) return;

      this.voiceOfflineCacheIndex = parsed
        .map((item) => ({
          url: String(item?.url || '').trim(),
          cachedAt: Number(item?.cachedAt || 0) || 0
        }))
        .filter((item) => !!item.url)
        .sort((a, b) => b.cachedAt - a.cachedAt)
        .slice(0, this.voiceOfflineCacheLimit);

      this.voiceOfflineCachedUrlSet = new Set(this.voiceOfflineCacheIndex.map((item) => item.url));
    } catch {
      // no-op
    }
  }

  private persistVoiceOfflineCacheIndex() {
    try {
      localStorage.setItem(
        VOICE_CACHE_INDEX_STORAGE_KEY,
        JSON.stringify(this.voiceOfflineCacheIndex.slice(0, this.voiceOfflineCacheLimit))
      );
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
    const replyAttachments = this.referenceAttachments(this.replyingTo);
    return {
      messageId: this.replyingTo.messageId,
      from: this.replyingTo.from,
      text: String(this.replyingTo.text || '').trim().slice(0, 160),
      scope: this.replyingTo.sourceScope,
      attachment: this.preferredReferenceAttachment(replyAttachments) || this.replyingTo.attachment,
      attachments: replyAttachments
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
