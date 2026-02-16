import { Component, inject, PLATFORM_ID } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth';
import { SkeletonLoaderComponent } from '../../components/skeleton-loader.component';
import { ProfilePreviewComponent } from '../../components/profile-preview.component';
import { environment } from '../../../environments/environment';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

type RoleValue = 'user' | 'moderator' | 'support' | 'admin';
type GenderValue = 'male' | 'female' | 'other';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SkeletonLoaderComponent, ProfilePreviewComponent],
  templateUrl: './profile.html',
  styleUrls: ['./profile.css']
})
export class ProfileComponent {
  private sanitizer = inject(DomSanitizer);
  me: any = null;
  loading = true;
  currentTheme: 'light' | 'dark' = 'light';
  private readonly THEME_KEY = 'theme-preference';
  
  // Tab management
  activeTab: 'profile' | 'security' | 'settings' | 'admin' = 'profile';

  // Preferences / Settings
  preferences = {
    theme: 'light' as 'light' | 'dark' | 'system',
    notificationsEnabled: true,
    soundEnabled: true,
    messagePreview: true,
    autoplayMedia: true,
    compactMode: false,
    showTyping: true,
    readReceipts: true,
    whoCanMessage: 'everyone' as 'everyone' | 'contacts' | 'nobody',
    dateFormat: 'MM/DD/YYYY' as 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD'
  };
  savingPreferences = false;

  // Media & Upload settings (localStorage)
  mediaSettings = {
    uploadQuality: 'balanced' as 'original' | 'balanced',
    autoOpenPrivateMediaTimeline: false,
    hideMediaPreviewsByDefault: false,
    fontSize: 'medium' as 'small' | 'medium' | 'large',
    highContrast: false
  };

  // Blocked users (private messages)
  blockedUsers: any[] = [];
  loadingBlocked = false;
  blockSearchQuery = '';
  blockSearchResults: any[] = [];
  searchingBlocks = false;

  // Voice settings (localStorage)
  voiceSettings = {
    voiceAutoPlayNext: false,
    voiceSilenceSkipEnabled: false,
    voiceKeyboardControlsEnabled: false,
    offlineVoiceCacheEnabled: false,
    normalizeVoice: false
  };

  username = '';
  avatarUrl = '';
  displayName = '';
  bio = '';
  statusText = '';
  countryCode = '';
  showCountry = false;
  showAge = true;
  gender: GenderValue = 'other';
  genderLocked = false;
  genderDirty = false;
  displayNameTaken = false;
  private displayNameCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private displayNameBaseline = '';
  birthDate = '';
  birthDateLocked = false;
  lastSeenVisibility: 'everyone' | 'contacts' | 'nobody' = 'everyone';
  savingProfile = false;
  uploadingAvatar = false;
  avatarDragOver = false;
  avatarPickerOpen = false;
  
  defaultAvatars = [
    'https://api.dicebear.com/7.x/avataaars/svg?seed=1',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=2',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=3',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=4',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=5',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=6',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=7',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=8',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=9',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=10',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=11',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=12'
  ];

  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  changingPassword = false;

  sessions: any[] = [];
  sessionsLoading = false;
  sessionsPage = 1;
  sessionsLimit = 5;
  sessionsTotal = 0;

  get paginatedSessions(): any[] {
    const start = (this.sessionsPage - 1) * this.sessionsLimit;
    return this.sessions.slice(start, start + this.sessionsLimit);
  }

  get sessionsPages(): number {
    return Math.ceil(this.sessionsTotal / this.sessionsLimit);
  }

  prevSessionsPage() {
    if (this.sessionsPage > 1) this.sessionsPage--;
  }

  nextSessionsPage() {
    if (this.sessionsPage < this.sessionsPages) this.sessionsPage++;
  }

  adminUsers: any[] = [];
  adminReports: any[] = [];
  abuseEvents: any[] = [];
  adminAuditActions: any[] = [];
  adminSearch = '';
  adminBusy = false;
  adminMessage = '';
  adminUsersRole = '';
  adminUsersVerified: '' | 'true' | 'false' = '';
  adminReportsStatus = 'pending';
  adminReportsCategory = '';
  adminReportsScope = '';
  adminReportsSeverity = '';
  usersPage = 1;
  usersPages = 1;
  reportsPage = 1;
  reportsPages = 1;
  abusePage = 1;
  abusePages = 1;
  auditPage = 1;
  auditPages = 1;

  reviewOpen = false;
  reviewLoading = false;
  reviewActionBusy = false;
  reviewReport: any = null;
  reviewMessage: any = null;
  reviewAuthor: any = null;

  socialLinks: { [key: string]: string } = {};
  socialPlatforms = [
    { id: 'facebook', name: 'Facebook', domain: 'facebook.com', placeholder: 'https://facebook.com/yourprofile' },
    { id: 'instagram', name: 'Instagram', domain: 'instagram.com', placeholder: 'https://instagram.com/yourprofile' },
    { id: 'tiktok', name: 'TikTok', domain: 'tiktok.com', placeholder: 'https://tiktok.com/@yourprofile' },
    { id: 'twitter', name: 'X', domain: 'x.com', placeholder: 'https://x.com/yourprofile' },
    { id: 'website', name: 'Your Site', domain: '', placeholder: 'https://yoursite.com' }
  ];

  showGender = true;
  showOnlineStatus = true;

  previewOpen = false;
  // per-platform preview toggle for URL display / quick actions
  socialPreview: { [key: string]: boolean } = {};

  constructor(private auth: AuthService, private router: Router) {}

  ngOnInit() {
    this.initializeTheme();
    this.initializeTab();
    this.loadMe();
    this.loadSessions();
    this.loadPreferences();
    this.loadVoiceSettings();
    this.loadMediaSettings();
    this.loadBlockedUsers();
  }

  loadPreferences() {
    this.auth.getPreferences().subscribe({
      next: (res: any) => {
        this.preferences = { ...this.preferences, ...res };
        // Sync with localStorage for toggle button
        if (this.preferences.theme) {
          localStorage.setItem(this.THEME_KEY, this.preferences.theme);
          this.currentTheme = this.preferences.theme === 'system' ? 'dark' : this.preferences.theme;
        }
        this.applyThemePreference(this.preferences.theme);
      },
      error: () => {
        // Use defaults
      }
    });
  }

  loadVoiceSettings() {
    try {
      const stored = localStorage.getItem('chat-voice-settings');
      if (stored) {
        this.voiceSettings = { ...this.voiceSettings, ...JSON.parse(stored) };
      }
    } catch {
      // Use defaults
    }
  }

  saveVoiceSettings() {
    try {
      localStorage.setItem('chat-voice-settings', JSON.stringify(this.voiceSettings));
    } catch {
      // Ignore
    }
  }

  loadMediaSettings() {
    try {
      const stored = localStorage.getItem('chat-media-settings');
      if (stored) {
        this.mediaSettings = { ...this.mediaSettings, ...JSON.parse(stored) };
      }
    } catch {
      // Use defaults
    }
  }

  saveMediaSettings() {
    try {
      localStorage.setItem('chat-media-settings', JSON.stringify(this.mediaSettings));
    } catch {
      // Ignore
    }
  }

  loadBlockedUsers() {
    this.loadingBlocked = true;
    this.auth.getBlockedPrivateList().subscribe({
      next: (res: any) => {
        this.blockedUsers = res || [];
      },
      error: () => {
        this.blockedUsers = [];
      },
      complete: () => {
        this.loadingBlocked = false;
      }
    });
  }

  private systemThemeListener: ((e: MediaQueryListEvent) => void) | null = null;

  applyThemePreference(theme: 'light' | 'dark' | 'system') {
    // Remove existing system theme listener
    if (this.systemThemeListener) {
      window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', this.systemThemeListener);
      this.systemThemeListener = null;
    }

    const html = document.documentElement;
    if (theme === 'dark') {
      html.classList.add('dark-theme');
    } else if (theme === 'light') {
      html.classList.remove('dark-theme');
    } else {
      // System preference - listen for changes
      const applySystemTheme = (e: MediaQueryListEvent | MediaQueryList) => {
        if (e.matches) {
          html.classList.add('dark-theme');
        } else {
          html.classList.remove('dark-theme');
        }
      };
      
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      applySystemTheme(mediaQuery);
      
      this.systemThemeListener = (e: MediaQueryListEvent) => applySystemTheme(e);
      mediaQuery.addEventListener('change', this.systemThemeListener);
    }
  }

  savePreferences() {
    this.savingPreferences = true;
    this.auth.updatePreferences(this.preferences).subscribe({
      next: (res: any) => {
        this.preferences = { ...this.preferences, ...res };
        this.applyThemePreference(this.preferences.theme);
      },
      error: () => {
        // Handle error
      },
      complete: () => {
        this.savingPreferences = false;
      }
    });
  }

  unblockUserFromPrivate(user: any) {
    this.auth.unblockPrivateUser(String(user._id)).subscribe({
      next: () => {
        this.blockedUsers = this.blockedUsers.filter(u => u._id !== user._id);
      },
      error: () => {
        // Handle error
      }
    });
  }

  searchUsersToBlock() {
    if (!this.blockSearchQuery || this.blockSearchQuery.length < 2) {
      this.blockSearchResults = [];
      return;
    }
    this.searchingBlocks = true;
    this.auth.adminListUsers({ q: this.blockSearchQuery, limit: 10 }).subscribe({
      next: (res: any) => {
        const users = (res?.users || []).filter((u: any) => 
          !this.blockedUsers.some(b => b._id === u._id) && u._id !== this.me?._id
        );
        this.blockSearchResults = users;
      },
      error: () => {
        this.blockSearchResults = [];
      },
      complete: () => {
        this.searchingBlocks = false;
      }
    });
  }

  blockUserFromPrivate(user: any) {
    this.auth.blockPrivateUser(String(user._id)).subscribe({
      next: () => {
        this.blockedUsers = [...this.blockedUsers, {
          _id: user._id,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl
        }];
        this.blockSearchResults = [];
        this.blockSearchQuery = '';
      },
      error: () => {
        // Handle error
      }
    });
  }

  loadMe() {
    this.loading = true;
    this.auth.getMe().subscribe({
      next: (res: any) => {
        this.me = res;
        this.username = String(res?.username || '');
        this.avatarUrl = String(res?.avatarUrl || '');
        this.displayName = String(res?.displayName || '');
        this.bio = String(res?.bio || '');
        this.statusText = String(res?.statusText || '');
        this.countryCode = String(res?.countryCode || '').toUpperCase();
        if (!this.countryCode) {
          this.countryCode = this.detectBrowserCountryCode();
        }
        this.showCountry = !!res?.showCountry;
        this.showAge = res?.showAge !== false;
        this.gender = (['male', 'female', 'other'].includes(String(res?.gender || ''))
          ? String(res?.gender)
          : 'other') as GenderValue;
        this.genderLocked = !!res?.genderLocked;
        this.genderDirty = false;
        this.displayNameBaseline = String(res?.displayName || '').trim().toLowerCase();
        this.displayNameTaken = false;
        this.birthDate = this.birthDateInputValue(res?.birthDate);
        this.birthDateLocked = !!this.birthDate;
        this.lastSeenVisibility = (['everyone', 'contacts', 'nobody'].includes(String(res?.lastSeenVisibility || ''))
          ? String(res?.lastSeenVisibility || 'everyone')
          : 'everyone') as 'everyone' | 'contacts' | 'nobody';
        
        this.socialLinks = {
          facebook: String(res?.socialLinks?.facebook || ''),
          instagram: String(res?.socialLinks?.instagram || ''),
          tiktok: String(res?.socialLinks?.tiktok || ''),
          twitter: String(res?.socialLinks?.twitter || ''),
          website: String(res?.socialLinks?.website || '')
        };
        
        this.showGender = res?.privacySettings?.showGender !== false;
        this.showOnlineStatus = res?.privacySettings?.showOnlineStatus !== false;
        
        this.loading = false;
        if (this.isModeratorOrHigher()) this.loadAdminData();
      },
      error: (err: any) => {
        console.log(err?.error?.message || 'Could not load profile.');
        this.loading = false;
      }
    });
  }

  saveProfile() {
    if (this.savingProfile) return;
    if (this.displayNameTaken) {
      console.log('Display name is already taken.');
      return;
    }
    this.savingProfile = true;

    const payload: any = {
      avatarUrl: this.avatarUrl,
      displayName: this.displayName,
      bio: this.bio,
      statusText: this.statusText,
      lastSeenVisibility: this.lastSeenVisibility,
      gender: this.gender,
      birthDate: this.birthDate || null,
      showAge: this.showAge,
      showCountry: this.showCountry,
      countryCode: this.countryCode,
      socialLinks: {
        facebook: this.socialLinks['facebook'] || '',
        instagram: this.socialLinks['instagram'] || '',
        tiktok: this.socialLinks['tiktok'] || '',
        twitter: this.socialLinks['twitter'] || '',
        website: this.socialLinks['website'] || ''
      },
      privacySettings: {
        showGender: this.showGender,
        showOnlineStatus: this.showOnlineStatus
      }
    };

    console.log('Saving profile with payload:', payload);

    this.auth.updateProfile(payload).subscribe({
      next: (res: any) => {
        console.log(String(res?.message || 'Profile updated.'));
        if (res?.user) {
          this.me = res.user;
          this.displayName = String(res?.user?.displayName || '');
          this.bio = String(res?.user?.bio || '');
          this.statusText = String(res?.user?.statusText || '');
          this.countryCode = String(res?.user?.countryCode || '').toUpperCase();
          this.showCountry = !!res?.user?.showCountry;
          this.showAge = res?.user?.showAge !== false;
          this.gender = (['male', 'female', 'other'].includes(String(res?.user?.gender || ''))
            ? String(res?.user?.gender)
            : 'other') as GenderValue;
          this.genderLocked = !!res?.user?.genderLocked;
          this.genderDirty = false;
          this.displayNameBaseline = String(res?.user?.displayName || '').trim().toLowerCase();
          this.displayNameTaken = false;
          this.birthDate = this.birthDateInputValue(res?.user?.birthDate);
          this.birthDateLocked = !!this.birthDate;
          this.lastSeenVisibility = (['everyone', 'contacts', 'nobody'].includes(String(res?.user?.lastSeenVisibility || ''))
            ? String(res?.user?.lastSeenVisibility || 'everyone')
            : 'everyone') as 'everyone' | 'contacts' | 'nobody';
          
          if (res?.user?.socialLinks) {
            this.socialLinks = {
              facebook: String(res?.user?.socialLinks?.facebook || ''),
              instagram: String(res?.user?.socialLinks?.instagram || ''),
              tiktok: String(res?.user?.socialLinks?.tiktok || ''),
              twitter: String(res?.user?.socialLinks?.twitter || ''),
              website: String(res?.user?.socialLinks?.website || '')
            };
          }
          
          if (res?.user?.privacySettings) {
            this.showGender = res?.user?.privacySettings?.showGender !== false;
            this.showOnlineStatus = res?.user?.privacySettings?.showOnlineStatus !== false;
          }
        }
      },
      error: (err: any) => {
        console.log(err?.error?.error?.message || 'Could not update profile.');
      },
      complete: () => {
        this.savingProfile = false;
      }
    });
  }

  onAvatarSelected(event: Event) {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file || this.uploadingAvatar) return;

    this.uploadingAvatar = true;

    this.auth.uploadAvatar(file).subscribe({
      next: (res: any) => {
        const nextUrl = String(res?.url || '').trim();
        if (!nextUrl) {
          console.log('Avatar upload failed.');
          return;
        }
        this.avatarUrl = nextUrl;
        this.saveProfile();
      },
      error: (err: any) => {
        console.log(err?.error?.error || err?.error?.message || 'Could not upload avatar.');
      },
      complete: () => {
        this.uploadingAvatar = false;
        if (input) input.value = '';
      }
    });
  }

  onAvatarDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.avatarDragOver = true;
  }

  onAvatarDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.avatarDragOver = false;
  }

  onAvatarDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.avatarDragOver = false;
    
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        this.uploadAvatarFile(file);
      }
    }
  }

  private uploadAvatarFile(file: File) {
    this.uploadingAvatar = true;
    this.auth.uploadAvatar(file).subscribe({
      next: (res: any) => {
        const nextUrl = String(res?.url || '').trim();
        if (!nextUrl) {
          console.log('Avatar upload failed.');
          return;
        }
        this.avatarUrl = nextUrl;
        this.saveProfile();
      },
      error: (err: any) => {
        console.log(err?.error?.error || err?.error?.message || 'Could not upload avatar.');
      },
      complete: () => {
        this.uploadingAvatar = false;
      }
    });
  }

  openAvatarPicker() {
    this.avatarPickerOpen = true;
  }

  closeAvatarPicker() {
    this.avatarPickerOpen = false;
  }

  selectDefaultAvatar(url: string) {
    this.avatarUrl = url;
    this.saveProfile();
    this.closeAvatarPicker();
  }

  avatarPreviewUrl(): string {
    const url = String(this.avatarUrl || '').trim();
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    return `${environment.apiUrl}${url}`;
  }

  isBirthdayToday(): boolean {
    return !!this.me?.isBirthdayToday;
  }

  ageLabel(): string {
    const age = Number(this.me?.age);
    if (!Number.isFinite(age) || age < 0) return 'Not set';
    return `${age}`;
  }

  ageLabelAsNumber(): number | null {
    const age = Number(this.me?.age);
    if (!Number.isFinite(age) || age < 0) return null;
    return age;
  }

  countryLabel(): string {
    const code = String(this.countryCode || this.detectBrowserCountryCode()).toUpperCase();
    if (!code) return 'Unknown';
    try {
      if ('DisplayNames' in Intl) {
        const names = new Intl.DisplayNames(['en'], { type: 'region' });
        return names.of(code) || code;
      }
    } catch {
      // no-op
    }
    return code;
  }

  private detectBrowserCountryCode(): string {
    try {
      const timezone = String(Intl.DateTimeFormat().resolvedOptions().timeZone || '').trim();
      if (timezone === 'Asia/Jerusalem') return 'IL';
      if (timezone === 'Asia/Dubai') return 'AE';
      if (timezone === 'Europe/London') return 'GB';
      if (timezone === 'Europe/Berlin') return 'DE';
      if (timezone === 'Europe/Paris') return 'FR';
      if (timezone.startsWith('America/')) return 'US';
      if (timezone.startsWith('Australia/')) return 'AU';
    } catch {
      // no-op
    }
    try {
      const locale = String((globalThis.navigator as any)?.languages?.[0] || globalThis.navigator?.language || '').trim();
      const region = (locale.split('-')[1] || locale.split('_')[1] || '').trim().toUpperCase();
      return /^[A-Z]{2}$/.test(region) ? region : '';
    } catch {
      return '';
    }
  }

  onDisplayNameInput(value: string) {
    this.displayName = String(value || '');
    this.displayNameTaken = false;

    if (this.displayNameCheckTimer) {
      clearTimeout(this.displayNameCheckTimer);
      this.displayNameCheckTimer = null;
    }

    const normalized = this.displayName.trim().toLowerCase();
    if (!normalized || normalized === this.displayNameBaseline) {
      return;
    }

    this.displayNameCheckTimer = setTimeout(() => {
      this.auth.checkDisplayNameAvailability(this.displayName).subscribe({
        next: (res: any) => {
          this.displayNameTaken = res?.available === false;
        },
        error: () => {
          this.displayNameTaken = false;
        }
      });
    }, 260);
  }

  onGenderChange(value: GenderValue) {
    if (this.genderLocked) return;
    this.gender = value;
    this.genderDirty = true;
  }

  private birthDateInputValue(value: any): string {
    if (!value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  }

  changePassword() {
    if (this.changingPassword) return;

    if (!this.currentPassword || !this.newPassword || !this.confirmPassword) {
      console.log('Please fill all password fields.');
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      console.log('New password and confirm password do not match.');
      return;
    }

    this.changingPassword = true;
    this.auth.changePassword(this.currentPassword, this.newPassword).subscribe({
      next: (res: any) => {
        console.log(String(res?.message || 'Password updated successfully.'));
        this.currentPassword = '';
        this.newPassword = '';
        this.confirmPassword = '';
      },
      error: (err: any) => {
        console.log(err?.error?.error?.message || 'Could not change password.');
      },
      complete: () => {
        this.changingPassword = false;
      }
    });
  }

  loadSessions() {
    this.sessionsLoading = true;
    this.sessionsPage = 1;
    this.auth.listSessions().subscribe({
      next: (res: any) => {
        this.sessions = Array.isArray(res) ? res : [];
        this.sessionsTotal = this.sessions.length;
      },
      error: () => {
        this.sessions = [];
        this.sessionsTotal = 0;
      },
      complete: () => {
        this.sessionsLoading = false;
      }
    });
  }

  logoutAllDevices() {
    this.auth.logoutAllSessions().subscribe({
      next: () => {
        console.log('Logged out from all devices.');
        this.loadSessions();
      },
      error: () => {
        console.log('Could not logout all sessions.');
      }
    });
  }

  sessionStatus(session: any): string {
    if (session?.revokedAt) return 'revoked';
    const expiresAt = Number(new Date(session?.expiresAt || 0).getTime() || 0);
    if (expiresAt && expiresAt <= Date.now()) return 'expired';
    return 'active';
  }

  isModeratorOrHigher(): boolean {
    const role = String(this.me?.role || '');
    return role === 'moderator' || role === 'support' || role === 'admin';
  }

  isAdmin(): boolean {
    return String(this.me?.role || '') === 'admin';
  }

  loadAdminData() {
    this.adminBusy = true;
    this.adminMessage = '';

    this.auth.adminListUsers({
      q: this.adminSearch,
      role: this.adminUsersRole,
      verified: this.adminUsersVerified,
      page: this.usersPage,
      limit: 25,
      sortBy: 'createdAt',
      sortDir: 'desc'
    }).subscribe({
      next: (res: any) => {
        this.adminUsers = Array.isArray(res?.items) ? res.items : [];
        this.usersPages = Number(res?.paging?.pages || 1);
        this.usersPage = Number(res?.paging?.page || 1);
      },
      error: () => {
        this.adminUsers = [];
      }
    });

    this.auth.adminListAttachmentReports({
      status: this.adminReportsStatus,
      category: this.adminReportsCategory,
      scope: this.adminReportsScope,
      severity: this.adminReportsSeverity,
      page: this.reportsPage,
      limit: 25
    }).subscribe({
      next: (res: any) => {
        this.adminReports = Array.isArray(res?.items) ? res.items : [];
        this.reportsPages = Number(res?.paging?.pages || 1);
        this.reportsPage = Number(res?.paging?.page || 1);
      },
      error: () => {
        this.adminReports = [];
      }
    });

    this.auth.adminListAbuseEvents(this.abusePage, 30).subscribe({
      next: (res: any) => {
        this.abuseEvents = Array.isArray(res?.items) ? res.items : [];
        this.abusePages = Number(res?.paging?.pages || 1);
        this.abusePage = Number(res?.paging?.page || 1);
      },
      error: () => {
        this.abuseEvents = [];
      }
    });

    this.auth.adminAuditActions(this.auditPage, 30).subscribe({
      next: (res: any) => {
        this.adminAuditActions = Array.isArray(res?.items) ? res.items : [];
        this.auditPages = Number(res?.paging?.pages || 1);
        this.auditPage = Number(res?.paging?.page || 1);
      },
      error: () => {
        this.adminAuditActions = [];
      },
      complete: () => {
        this.adminBusy = false;
      }
    });
  }

  roleOptionsForCurrentUser(): RoleValue[] {
    return this.isAdmin() ? ['user', 'moderator', 'support', 'admin'] : ['user', 'moderator', 'support'];
  }

  setRole(user: any, role: RoleValue) {
    if (!this.isAdmin()) return;
    this.auth.adminSetUserRole(String(user?._id || ''), role).subscribe({
      next: (res: any) => {
        this.adminMessage = String(res?.message || 'User role updated.');
        user.role = role;
      },
      error: (err: any) => {
        this.adminMessage = err?.error?.error?.message || 'Role update failed.';
      }
    });
  }

  verifyEmail(user: any) {
    this.auth.adminVerifyEmail(String(user?._id || '')).subscribe({
      next: (res: any) => {
        this.adminMessage = String(res?.message || 'Email marked as verified.');
        user.emailVerified = true;
      },
      error: (err: any) => {
        this.adminMessage = err?.error?.error?.message || 'Verify email failed.';
      }
    });
  }

  unlockUser(user: any) {
    this.auth.adminUnlockUser(String(user?._id || '')).subscribe({
      next: (res: any) => {
        this.adminMessage = String(res?.message || 'User unlocked.');
        user.loginFailures = 0;
        user.lockUntil = null;
      },
      error: (err: any) => {
        this.adminMessage = err?.error?.error?.message || 'Unlock failed.';
      }
    });
  }

  revokeSessions(user: any) {
    this.auth.adminRevokeSessions(String(user?._id || '')).subscribe({
      next: (res: any) => {
        this.adminMessage = String(res?.message || 'Sessions revoked.');
      },
      error: (err: any) => {
        this.adminMessage = err?.error?.error?.message || 'Session revoke failed.';
      }
    });
  }

  banUserWeek(user: any) {
    this.auth.adminBanUserWeek(String(user?._id || '')).subscribe({
      next: (res: any) => {
        this.adminMessage = String(res?.message || 'User banned.');
        user.bannedUntil = res?.bannedUntil || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        user.blockedAt = null;
      },
      error: (err: any) => {
        this.adminMessage = err?.error?.error?.message || 'User ban failed.';
      }
    });
  }

  blockUser(user: any) {
    this.auth.adminBlockUser(String(user?._id || '')).subscribe({
      next: (res: any) => {
        this.adminMessage = String(res?.message || 'User blocked.');
        user.blockedAt = new Date().toISOString();
        user.bannedUntil = null;
      },
      error: (err: any) => {
        this.adminMessage = err?.error?.error?.message || 'User block failed.';
      }
    });
  }

  unblockUser(user: any) {
    this.auth.adminUnblockUser(String(user?._id || '')).subscribe({
      next: (res: any) => {
        this.adminMessage = String(res?.message || 'User unblocked.');
        user.blockedAt = null;
        user.bannedUntil = null;
      },
      error: (err: any) => {
        this.adminMessage = err?.error?.error?.message || 'User unblock failed.';
      }
    });
  }

  userModerationState(user: any): string {
    const blocked = !!user?.blockedAt;
    const bannedUntilMs = Number(new Date(user?.bannedUntil || 0).getTime() || 0);
    if (blocked) return 'blocked';
    if (bannedUntilMs > Date.now()) return 'banned';
    return 'active';
  }

  updateReportStatus(report: any, status: 'pending' | 'in_review' | 'resolved' | 'dismissed') {
    this.auth.adminUpdateAttachmentReport(String(report?._id || ''), status).subscribe({
      next: (res: any) => {
        this.adminMessage = String(res?.message || 'Report updated.');
        if (status === 'dismissed' || status === 'resolved') {
          this.removeReportById(String(report?._id || ''));
        } else {
          report.status = status;
        }
      },
      error: (err: any) => {
        this.adminMessage = err?.error?.error?.message || 'Report update failed.';
      }
    });
  }

  private removeReportById(reportId: string) {
    const id = String(reportId || '').trim();
    if (!id) return;
    this.adminReports = this.adminReports.filter((report) => String(report?._id || '') !== id);
  }

  openReportReview(report: any) {
    const id = String(report?._id || '').trim();
    if (!id) return;
    this.reviewOpen = true;
    this.reviewLoading = true;
    this.reviewActionBusy = false;
    this.reviewReport = report;
    this.reviewMessage = null;
    this.reviewAuthor = null;

    this.auth.adminAttachmentReportDetail(id).subscribe({
      next: (res: any) => {
        this.reviewReport = res?.report || report;
        this.reviewMessage = res?.message || null;
        this.reviewAuthor = res?.messageAuthor || null;
      },
      error: (err: any) => {
        this.adminMessage = err?.error?.error?.message || 'Could not load report detail.';
        this.closeReportReview();
      },
      complete: () => {
        this.reviewLoading = false;
      }
    });
  }

  closeReportReview() {
    this.reviewOpen = false;
    this.reviewLoading = false;
    this.reviewActionBusy = false;
    this.reviewReport = null;
    this.reviewMessage = null;
    this.reviewAuthor = null;
  }

  reviewMessageAttachments(): any[] {
    const list = Array.isArray(this.reviewMessage?.attachments) ? this.reviewMessage.attachments.filter((a: any) => !!a?.url) : [];
    if (list.length) return list;
    const single = this.reviewMessage?.attachment?.url ? [this.reviewMessage.attachment] : [];
    return single;
  }

  reviewAttachmentUrl(attachment: any): string {
    const raw = String(attachment?.url || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    return `${environment.apiUrl}${raw}`;
  }

  reviewDismiss() {
    if (!this.reviewReport || this.reviewActionBusy) return;
    const reportId = String(this.reviewReport?._id || '');
    this.reviewActionBusy = true;
    this.auth.adminUpdateAttachmentReport(reportId, 'dismissed').subscribe({
      next: (res: any) => {
        this.adminMessage = String(res?.message || 'Report dismissed.');
        this.removeReportById(reportId);
        this.closeReportReview();
      },
      error: (err: any) => {
        this.adminMessage = err?.error?.error?.message || 'Could not dismiss report.';
      },
      complete: () => {
        this.reviewActionBusy = false;
      }
    });
  }

  reviewDeleteMessage() {
    if (!this.reviewReport || !this.reviewMessage || this.reviewActionBusy) return;
    const reportId = String(this.reviewReport?._id || '');
    const scope = String(this.reviewReport?.scope || '') as 'public' | 'private';
    const messageId = String(this.reviewMessage?._id || '').trim();
    if (!messageId || (scope !== 'public' && scope !== 'private')) return;

    this.reviewActionBusy = true;
    this.auth.adminRemoveMessage(scope, messageId).subscribe({
      next: () => {
        this.auth.adminUpdateAttachmentReport(reportId, 'resolved').subscribe({
          next: () => {
            this.adminMessage = 'Message removed and report resolved.';
            this.removeReportById(reportId);
            this.closeReportReview();
          },
          error: () => {
            this.adminMessage = 'Message removed.';
            this.removeReportById(reportId);
            this.closeReportReview();
          },
          complete: () => {
            this.reviewActionBusy = false;
          }
        });
      },
      error: (err: any) => {
        this.adminMessage = err?.error?.error?.message || 'Could not remove message.';
        this.reviewActionBusy = false;
      }
    });
  }

  reviewBanUserWeek() {
    if (!this.reviewAuthor?._id || this.reviewActionBusy) return;
    const reportId = String(this.reviewReport?._id || '');
    this.reviewActionBusy = true;
    this.auth.adminBanUserWeek(String(this.reviewAuthor._id)).subscribe({
      next: () => {
        this.auth.adminUpdateAttachmentReport(reportId, 'resolved').subscribe({
          next: () => {
            this.adminMessage = 'User banned for 7 days and report resolved.';
            this.removeReportById(reportId);
            this.closeReportReview();
          },
          error: () => {
            this.adminMessage = 'User banned for 7 days.';
            this.removeReportById(reportId);
            this.closeReportReview();
          },
          complete: () => {
            this.reviewActionBusy = false;
          }
        });
      },
      error: (err: any) => {
        this.adminMessage = err?.error?.error?.message || 'Could not ban user.';
        this.reviewActionBusy = false;
      }
    });
  }

  reviewBlockUser() {
    if (!this.reviewAuthor?._id || this.reviewActionBusy) return;
    const reportId = String(this.reviewReport?._id || '');
    this.reviewActionBusy = true;
    this.auth.adminBlockUser(String(this.reviewAuthor._id)).subscribe({
      next: () => {
        this.auth.adminUpdateAttachmentReport(reportId, 'resolved').subscribe({
          next: () => {
            this.adminMessage = 'User blocked and report resolved.';
            this.removeReportById(reportId);
            this.closeReportReview();
          },
          error: () => {
            this.adminMessage = 'User blocked.';
            this.removeReportById(reportId);
            this.closeReportReview();
          },
          complete: () => {
            this.reviewActionBusy = false;
          }
        });
      },
      error: (err: any) => {
        this.adminMessage = err?.error?.error?.message || 'Could not block user.';
        this.reviewActionBusy = false;
      }
    });
  }

  nextUsersPage() {
    if (this.usersPage >= this.usersPages) return;
    this.usersPage += 1;
    this.loadAdminData();
  }

  prevUsersPage() {
    if (this.usersPage <= 1) return;
    this.usersPage -= 1;
    this.loadAdminData();
  }

  nextReportsPage() {
    if (this.reportsPage >= this.reportsPages) return;
    this.reportsPage += 1;
    this.loadAdminData();
  }

  prevReportsPage() {
    if (this.reportsPage <= 1) return;
    this.reportsPage -= 1;
    this.loadAdminData();
  }

  nextAbusePage() {
    if (this.abusePage >= this.abusePages) return;
    this.abusePage += 1;
    this.loadAdminData();
  }

  prevAbusePage() {
    if (this.abusePage <= 1) return;
    this.abusePage -= 1;
    this.loadAdminData();
  }

  nextAuditPage() {
    if (this.auditPage >= this.auditPages) return;
    this.auditPage += 1;
    this.loadAdminData();
  }

  prevAuditPage() {
    if (this.auditPage <= 1) return;
    this.auditPage -= 1;
    this.loadAdminData();
  }

  goToChat() {
    this.router.navigate(['/chat']);
  }

  private initializeTheme(): void {
    const saved = localStorage.getItem(this.THEME_KEY) as 'light' | 'dark' | null;

    if (saved) {
      this.currentTheme = saved;
      this.applyTheme(saved);
      return;
    }

    // Detect system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      this.currentTheme = 'dark';
      this.applyTheme('dark');
    }
  }

  toggleTheme(): void {
    const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
    this.currentTheme = newTheme;
    localStorage.setItem(this.THEME_KEY, newTheme);
    this.applyTheme(newTheme);
    // Also save to preferences
    this.preferences.theme = newTheme;
    this.savePreferences();
  }

  private applyTheme(theme: 'light' | 'dark'): void {
    const html = document.documentElement;

    if (theme === 'dark') {
      html.classList.add('dark-theme');
      html.style.colorScheme = 'dark';
    } else {
      html.classList.remove('dark-theme');
      html.style.colorScheme = 'light';
    }
  }

  private initializeTab(): void {
    // Read tab from URL fragment (e.g., #security, #admin, #settings)
    const hash = window.location.hash.slice(1); // Remove '#' prefix
    const validTabs: Array<'profile' | 'security' | 'settings' | 'admin'> = ['profile', 'security', 'settings', 'admin'];
    
    if (hash && validTabs.includes(hash as any)) {
      this.activeTab = hash as 'profile' | 'security' | 'settings' | 'admin';
    } else {
      this.activeTab = 'profile'; // Default to profile tab
    }
  }

  selectTab(tab: 'profile' | 'security' | 'settings' | 'admin'): void {
    // Don't show admin tab if user doesn't have permission
    if (tab === 'admin' && !this.isModeratorOrHigher()) {
      return;
    }

    this.activeTab = tab;
    
    // Update URL fragment for bookmarking/sharing
    window.history.pushState(null, '', `#${tab}`);
  }

  getSocialLink(platformId: string): string {
    return this.socialLinks[platformId] || '';
  }

  setSocialLink(platformId: string, value: string): void {
    this.socialLinks[platformId] = value;
  }

  hasSocialLink(platformId: string): boolean {
    const link = this.socialLinks?.[platformId];
    return !!(link && String(link).trim());
  }

  hasAnySocialLink(): boolean {
    const links = this.socialLinks ? Object.values(this.socialLinks) : [];
    return links.some((v) => !!(v && String(v).trim()));
  }

  isValidSocialLink(platformId: string): boolean {
    const link = this.socialLinks?.[platformId];
    if (!link || !String(link).trim()) return true;
    try {
      const url = new URL(link);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  getPlatformIcon(platformId: string): string {
    const icons: { [key: string]: string } = {
      facebook: 'f',
      instagram: 'IG',
      tiktok: 'TT',
      twitter: 'X',
      website: '🌐'
    };
    return icons[platformId] || '?';
  }

  // Return safe SVG HTML for social platforms (official brand logos from simpleicons.org - MIT License)
  getPlatformSvgSafe(platformId: string): SafeHtml {
    const svg = this.getPlatformLogoPath(platformId);
    return this.sanitizer.bypassSecurityTrustHtml(svg);
  }

  // Return inline SVG for social platforms (official brand logos from simpleicons.org - MIT License)
  getPlatformLogoPath(platformId: string): string {
    const logos: { [key: string]: string } = {
      facebook: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="#1877F2" d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"/></svg>`,
      instagram: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="#E4405F" d="M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077"/></svg>`,
      tiktok: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="#000000" d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>`,
      twitter: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="#000000" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>`,
      website: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="#3e82f7" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`
    };
    return logos[platformId] || '';
  }

  toggleSocialPreview(platformId: string, url: string): void {
    if (this.socialPreview[platformId]) {
      if (url) {
        window.open(url, '_blank');
      }
      this.socialPreview[platformId] = false;
    } else {
      // show URL for this platform
      this.socialPreview = {}; // reset others for simplicity
      this.socialPreview[platformId] = true;
    }
  }

  getProfileCompletionScore(): number {
    let score = 0;
    if (this.avatarUrl) score += 20;
    if (this.displayName) score += 15;
    if (this.bio) score += 15;
    if (this.statusText) score += 10;
    if (this.gender) score += 10;
    if (this.birthDate) score += 10;
    const socialCount = Object.values(this.socialLinks).filter(v => v && v.trim()).length;
    if (socialCount > 0) score += Math.min(socialCount * 2, 10);
    return score;
  }

  getCompletionLabel(score: number): string {
    if (score >= 80) return 'Excellent';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Fair';
    if (score >= 20) return 'Getting started';
    return 'Just started';
  }

  openPreview(): void {
    this.previewOpen = true;
  }

  closePreview(): void {
    this.previewOpen = false;
  }
}
