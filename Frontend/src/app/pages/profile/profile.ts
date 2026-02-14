import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth';

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
  savingProfile = false;

  adminUsers: any[] = [];
  adminReports: any[] = [];
  abuseEvents: any[] = [];
  adminSearch = '';
  adminBusy = false;
  adminMessage = '';

  constructor(private auth: AuthService, private router: Router) {}

  ngOnInit() {
    this.loadMe();
  }

  loadMe() {
    this.loading = true;
    this.error = '';
    this.auth.getMe().subscribe({
      next: (res: any) => {
        this.me = res;
        this.username = String(res?.username || '');
        this.avatarUrl = String(res?.avatarUrl || '');
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

    this.auth.updateProfile(this.username, this.avatarUrl).subscribe({
      next: (res: any) => {
        this.success = String(res?.message || 'Profile updated.');
        if (res?.user) this.me = res.user;
      },
      error: (err) => {
        this.error = err?.error?.error?.message || 'Could not update profile.';
      },
      complete: () => {
        this.savingProfile = false;
      }
    });
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
