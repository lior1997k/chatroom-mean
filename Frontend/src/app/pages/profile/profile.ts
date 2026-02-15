import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth';
import { SkeletonLoaderComponent } from '../../components/skeleton-loader.component';
import { environment } from '../../../environments/environment';

type RoleValue = 'user' | 'moderator' | 'support' | 'admin';
type GenderValue = 'male' | 'female' | 'other';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SkeletonLoaderComponent],
  templateUrl: './profile.html',
  styleUrls: ['./profile.css']
})
export class ProfileComponent {
  me: any = null;
  loading = true;
  currentTheme: 'light' | 'dark' = 'light';
  private readonly THEME_KEY = 'theme-preference';
  
  // Tab management
  activeTab: 'profile' | 'security' | 'admin' = 'profile';

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

  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  changingPassword = false;

  sessions: any[] = [];
  sessionsLoading = false;

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

  constructor(private auth: AuthService, private router: Router) {}

  ngOnInit() {
    this.initializeTheme();
    this.initializeTab();
    this.loadMe();
    this.loadSessions();
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
      showCountry: this.showCountry,
      showAge: this.showAge,
      lastSeenVisibility: this.lastSeenVisibility,
      socialLinks: this.socialLinks,
      privacySettings: {
        showGender: this.showGender,
        showOnlineStatus: this.showOnlineStatus
      }
    };

    if (!this.genderLocked && this.genderDirty) {
      payload.gender = this.gender;
    }

    if (!this.birthDateLocked && this.birthDate) {
      payload.birthDate = this.birthDate;
    }

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
    this.auth.listSessions().subscribe({
      next: (res: any) => {
        this.sessions = Array.isArray(res) ? res : [];
      },
      error: () => {
        this.sessions = [];
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
    // Read tab from URL fragment (e.g., #security, #admin)
    const hash = window.location.hash.slice(1); // Remove '#' prefix
    const validTabs: Array<'profile' | 'security' | 'admin'> = ['profile', 'security', 'admin'];
    
    if (hash && validTabs.includes(hash as any)) {
      this.activeTab = hash as 'profile' | 'security' | 'admin';
    } else {
      this.activeTab = 'profile'; // Default to profile tab
    }
  }

  selectTab(tab: 'profile' | 'security' | 'admin'): void {
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

  isValidSocialLink(platformId: string): boolean {
    const url = this.getSocialLink(platformId);
    if (!url) return true;

    const platform = this.socialPlatforms.find(p => p.id === platformId);
    if (!platform || !platform.domain) return true;

    try {
      const urlObj = new URL(url);
      return urlObj.hostname.includes(platform.domain);
    } catch {
      return url.startsWith('http://') || url.startsWith('https://');
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
