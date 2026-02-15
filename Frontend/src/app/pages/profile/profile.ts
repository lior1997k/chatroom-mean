import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth';
import { environment } from '../../../environments/environment';

type RoleValue = 'user' | 'moderator' | 'support' | 'admin';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './profile.html',
  styleUrls: ['./profile.css']
})
export class ProfileComponent {
  me: any = null;
  loading = true;
  error = '';
  success = '';

  username = '';
  avatarUrl = '';
  displayName = '';
  bio = '';
  statusText = '';
  timezone = 'UTC';
  lastSeenVisibility: 'everyone' | 'contacts' | 'nobody' = 'everyone';
  savingProfile = false;
  uploadingAvatar = false;

  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  changingPassword = false;
  passwordMessage = '';

  sessions: any[] = [];
  sessionsLoading = false;

  adminUsers: any[] = [];
  adminReports: any[] = [];
  abuseEvents: any[] = [];
  adminSearch = '';
  adminBusy = false;
  adminMessage = '';

  constructor(private auth: AuthService, private router: Router) {}

  ngOnInit() {
    this.loadMe();
    this.loadSessions();
  }

  loadMe() {
    this.loading = true;
    this.error = '';
    this.auth.getMe().subscribe({
      next: (res: any) => {
        this.me = res;
        this.username = String(res?.username || '');
        this.avatarUrl = String(res?.avatarUrl || '');
        this.displayName = String(res?.displayName || '');
        this.bio = String(res?.bio || '');
        this.statusText = String(res?.statusText || '');
        this.timezone = String(res?.timezone || 'UTC');
        this.lastSeenVisibility = (['everyone', 'contacts', 'nobody'].includes(String(res?.lastSeenVisibility || ''))
          ? String(res?.lastSeenVisibility || 'everyone')
          : 'everyone') as 'everyone' | 'contacts' | 'nobody';
        this.loading = false;
        if (this.isModeratorOrHigher()) this.loadAdminData();
      },
      error: (err) => {
        this.error = err?.error?.message || 'Could not load profile.';
        this.loading = false;
      }
    });
  }

  saveProfile() {
    if (this.savingProfile) return;
    this.error = '';
    this.success = '';
    this.savingProfile = true;

    this.auth.updateProfile({
      avatarUrl: this.avatarUrl,
      displayName: this.displayName,
      bio: this.bio,
      statusText: this.statusText,
      timezone: this.timezone,
      lastSeenVisibility: this.lastSeenVisibility
    }).subscribe({
      next: (res: any) => {
        this.success = String(res?.message || 'Profile updated.');
        if (res?.user) {
          this.me = res.user;
          this.displayName = String(res?.user?.displayName || '');
          this.bio = String(res?.user?.bio || '');
          this.statusText = String(res?.user?.statusText || '');
          this.timezone = String(res?.user?.timezone || 'UTC');
          this.lastSeenVisibility = (['everyone', 'contacts', 'nobody'].includes(String(res?.user?.lastSeenVisibility || ''))
            ? String(res?.user?.lastSeenVisibility || 'everyone')
            : 'everyone') as 'everyone' | 'contacts' | 'nobody';
        }
      },
      error: (err) => {
        this.error = err?.error?.error?.message || 'Could not update profile.';
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

    if (!String(file.type || '').startsWith('image/')) {
      this.error = 'Please select an image file for avatar.';
      if (input) input.value = '';
      return;
    }

    if (file.size > 6 * 1024 * 1024) {
      this.error = 'Avatar image is too large (max 6MB).';
      if (input) input.value = '';
      return;
    }

    this.error = '';
    this.success = '';
    this.uploadingAvatar = true;

    this.auth.uploadAvatar(file).subscribe({
      next: (res: any) => {
        const nextUrl = String(res?.url || '').trim();
        if (!nextUrl) {
          this.error = 'Avatar upload failed.';
          return;
        }
        this.avatarUrl = nextUrl;
        this.saveProfile();
      },
      error: (err) => {
        this.error = err?.error?.error || 'Could not upload avatar.';
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

  changePassword() {
    if (this.changingPassword) return;
    this.passwordMessage = '';

    if (!this.currentPassword || !this.newPassword || !this.confirmPassword) {
      this.passwordMessage = 'Please fill all password fields.';
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.passwordMessage = 'New password and confirm password do not match.';
      return;
    }

    this.changingPassword = true;
    this.auth.changePassword(this.currentPassword, this.newPassword).subscribe({
      next: (res: any) => {
        this.passwordMessage = String(res?.message || 'Password updated successfully.');
        this.currentPassword = '';
        this.newPassword = '';
        this.confirmPassword = '';
      },
      error: (err) => {
        this.passwordMessage = err?.error?.error?.message || 'Could not change password.';
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
        this.success = 'Logged out from all devices.';
        this.loadSessions();
      },
      error: () => {
        this.error = 'Could not logout all sessions.';
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

    this.auth.adminListUsers(this.adminSearch, 50).subscribe({
      next: (res: any) => {
        this.adminUsers = Array.isArray(res) ? res : [];
      },
      error: () => {
        this.adminUsers = [];
      }
    });

    this.auth.adminListAttachmentReports('', 60).subscribe({
      next: (res: any) => {
        this.adminReports = Array.isArray(res) ? res : [];
      },
      error: () => {
        this.adminReports = [];
      }
    });

    this.auth.adminListAbuseEvents(40).subscribe({
      next: (res: any) => {
        this.abuseEvents = Array.isArray(res) ? res : [];
      },
      error: () => {
        this.abuseEvents = [];
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
      error: (err) => {
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
      error: (err) => {
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
      error: (err) => {
        this.adminMessage = err?.error?.error?.message || 'Unlock failed.';
      }
    });
  }

  revokeSessions(user: any) {
    this.auth.adminRevokeSessions(String(user?._id || '')).subscribe({
      next: (res: any) => {
        this.adminMessage = String(res?.message || 'Sessions revoked.');
      },
      error: (err) => {
        this.adminMessage = err?.error?.error?.message || 'Session revoke failed.';
      }
    });
  }

  updateReportStatus(report: any, status: 'pending' | 'in_review' | 'resolved' | 'dismissed') {
    this.auth.adminUpdateAttachmentReport(String(report?._id || ''), status).subscribe({
      next: (res: any) => {
        this.adminMessage = String(res?.message || 'Report updated.');
        report.status = status;
      },
      error: (err) => {
        this.adminMessage = err?.error?.error?.message || 'Report update failed.';
      }
    });
  }

  removeReportedMessage(report: any) {
    const scope = String(report?.scope || '') as 'public' | 'private';
    const messageId = String(report?.messageId || '').trim();
    if (!messageId || (scope !== 'public' && scope !== 'private')) return;

    this.auth.adminRemoveMessage(scope, messageId).subscribe({
      next: (res: any) => {
        this.adminMessage = String(res?.message || 'Message removed.');
      },
      error: (err) => {
        this.adminMessage = err?.error?.error?.message || 'Message removal failed.';
      }
    });
  }

  goToChat() {
    this.router.navigate(['/chat']);
  }
}
