import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

interface ProfileData {
  username: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  statusText?: string | null;
  emailVerified?: boolean;
  gender?: string | null;
  age?: number | null;
  country?: string | null;
  joinedAt?: string | null;
  isOnline?: boolean;
  socialLinks?: { [key: string]: string } | null;
  loading?: boolean;
}

@Component({
  selector: 'app-profile-preview',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="profile-preview" [class.loading]="profile.loading">
      <!-- Loading Skeleton -->
      <div class="skeleton-container" *ngIf="profile.loading">
        <div class="skeleton-header">
          <div class="skeleton-avatar"></div>
          <div class="skeleton-info">
            <div class="skeleton-line skeleton-line-large"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line skeleton-line-short"></div>
          </div>
        </div>
        <div class="skeleton-body">
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-details">
            <div class="skeleton-detail-item" *ngFor="let i of [1,2,3,4]">
              <div class="skeleton-line skeleton-line-short"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Actual Content -->
      <ng-container *ngIf="!profile.loading">
        <div class="preview-profile-row">
          <div class="preview-avatar-section">
            <div class="preview-avatar">
              <img 
                *ngIf="profile.avatarUrl; else noAvatar" 
                [src]="profile.avatarUrl" 
                alt="avatar"
                (error)="onAvatarError($event)"
                [class.avatar-error]="avatarLoadError" />
              <ng-template #noAvatar>
                <div class="avatar-placeholder" [style.background]="getAvatarGradient()">
                  <span class="avatar-initials">{{ getInitials() }}</span>
                </div>
              </ng-template>
            </div>
            <span class="verified-badge" *ngIf="profile.emailVerified">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
              </svg>
              Verified
            </span>
          </div>
          <div class="preview-info-section">
            <div class="preview-name-row">
              <h3>{{ profile.displayName || profile.username }}</h3>
              <span class="online-badge" *ngIf="profile.isOnline">
                <span class="online-dot"></span> Online
              </span>
            </div>
            <p class="username">@{{ profile.username }}</p>
            <div class="preview-status" *ngIf="profile.statusText">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
              </svg>
              {{ profile.statusText }}
            </div>
          </div>
        </div>
        
        <p class="preview-bio" *ngIf="profile.bio">{{ profile.bio }}</p>
        
        <div class="preview-details" *ngIf="hasAnyDetail()">
          <p *ngIf="profile.gender">
            <span class="detail-icon">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
              </svg>
            </span>
            <span class="label">Gender:</span> {{ profile.gender }}
          </p>
          <p *ngIf="profile.age !== undefined">
            <span class="detail-icon">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <path d="M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"/>
              </svg>
            </span>
            <span class="label">Age:</span> {{ profile.age }}
          </p>
          <p *ngIf="profile.country">
            <span class="detail-icon">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
              </svg>
            </span>
            <span class="label">Country:</span> {{ profile.country }}
          </p>
          <p *ngIf="profile.joinedAt">
            <span class="detail-icon">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM9 10H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z"/>
              </svg>
            </span>
            <span class="label">Joined:</span> {{ profile.joinedAt | date:'mediumDate' }}
          </p>
        </div>
        
        <div class="preview-social" *ngIf="hasAnySocialLink()">
          <ng-container *ngFor="let platform of platforms">
            <a *ngIf="profile.socialLinks?.[platform.id]" 
               [href]="profile.socialLinks?.[platform.id]" 
               target="_blank" 
               rel="noopener noreferrer" 
               class="social-icon"
               [class]="'social-icon-' + platform.id"
               [title]="platform.name + ': ' + profile.socialLinks?.[platform.id]"
               [innerHTML]="getSocialSvg(platform.id)">
            </a>
          </ng-container>
        </div>
      </ng-container>
    </div>
  `,
  styles: [`
    /* CSS Custom Properties for theming */
    :host {
      --pp-bg-primary: #ffffff;
      --pp-bg-secondary: rgba(61, 99, 179, 0.03);
      --pp-bg-tertiary: rgba(61, 99, 179, 0.06);
      --pp-text-primary: #1a3a52;
      --pp-text-secondary: #5a7a99;
      --pp-text-muted: #7a9ab9;
      --pp-border-color: rgba(61, 99, 179, 0.1);
      --pp-accent-color: #3d63b3;
      --pp-accent-light: rgba(61, 99, 179, 0.08);
      --pp-online-color: #4CAF50;
      --pp-verified-color: #4CAF50;
      --pp-shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.08);
      --pp-shadow-md: 0 4px 12px rgba(61, 99, 179, 0.2);
      --pp-shadow-lg: 0 12px 24px rgba(61, 99, 179, 0.3);
      --pp-avatar-gradient-start: #e8f0ff;
      --pp-avatar-gradient-end: #d0e4ff;
      display: block;
    }

    :host-context(.dark-theme) {
      --pp-bg-primary: #1e293b;
      --pp-bg-secondary: rgba(100, 150, 220, 0.05);
      --pp-bg-tertiary: rgba(100, 150, 220, 0.1);
      --pp-text-primary: #e8f0ff;
      --pp-text-secondary: #a8c5e0;
      --pp-text-muted: #7a9ab9;
      --pp-border-color: rgba(100, 150, 200, 0.15);
      --pp-accent-color: #5a8add;
      --pp-accent-light: rgba(100, 150, 220, 0.1);
      --pp-online-color: #66BB6A;
      --pp-verified-color: #66BB6A;
      --pp-shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.3);
      --pp-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
      --pp-shadow-lg: 0 12px 24px rgba(0, 0, 0, 0.5);
      --pp-avatar-gradient-start: #2a3f5f;
      --pp-avatar-gradient-end: #1e3a5f;
    }

    .profile-preview {
      padding: 24px;
      background: var(--pp-bg-primary);
      border-radius: 16px;
      transition: all 0.3s ease;
    }

    .profile-preview.loading {
      min-height: 300px;
    }
    
    .preview-profile-row {
      display: flex;
      gap: 20px;
      align-items: flex-start;
      margin-bottom: 20px;
    }
    
    .preview-avatar-section {
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }
    
    .preview-avatar {
      width: 110px;
      height: 110px;
      border-radius: 50%;
      overflow: hidden;
      background: linear-gradient(135deg, var(--pp-avatar-gradient-start) 0%, var(--pp-avatar-gradient-end) 100%);
      box-shadow: var(--pp-shadow-md), 0 0 0 4px var(--pp-accent-light);
      transition: all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
      position: relative;
    }
    
    .preview-avatar:hover {
      transform: translateY(-4px) rotateX(5deg) rotateY(-5deg);
      box-shadow: var(--pp-shadow-lg), 0 0 0 6px var(--pp-accent-light), 0 20px 40px rgba(0, 0, 0, 0.15);
    }
    
    .preview-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: opacity 0.3s ease;
    }

    .preview-avatar img.avatar-error {
      opacity: 0;
    }
    
    .avatar-placeholder {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, var(--pp-avatar-gradient-start) 0%, var(--pp-avatar-gradient-end) 100%);
      color: var(--pp-accent-color);
      font-weight: 700;
      font-size: 2rem;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .avatar-initials {
      background: linear-gradient(135deg, var(--pp-text-primary) 0%, var(--pp-accent-color) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    
    .verified-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      background: linear-gradient(135deg, var(--pp-verified-color) 0%, #45a049 100%);
      color: white;
      font-size: 0.7rem;
      font-weight: 600;
      border-radius: 20px;
      box-shadow: 0 2px 8px rgba(76, 175, 80, 0.3);
    }
    
    .preview-info-section {
      flex: 1;
      min-width: 0;
    }
    
    .preview-name-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    
    .preview-name-row h3 {
      margin: 0;
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--pp-text-primary);
    }
    
    .online-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      background: linear-gradient(135deg, var(--pp-online-color) 0%, #45a049 100%);
      color: white;
      font-size: 0.75rem;
      font-weight: 600;
      border-radius: 20px;
      box-shadow: 0 2px 8px rgba(76, 175, 80, 0.3);
    }
    
    .online-dot {
      width: 8px;
      height: 8px;
      background: white;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    
    @keyframes pulse {
      0% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.7; transform: scale(0.9); }
      100% { opacity: 1; transform: scale(1); }
    }
    
    .username {
      margin: 6px 0 10px;
      color: var(--pp-accent-color);
      font-size: 0.95rem;
      font-weight: 500;
    }
    
    .preview-status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      background: var(--pp-bg-tertiary);
      border-radius: 12px;
      font-size: 0.85rem;
      color: var(--pp-text-secondary);
      border: 1px solid var(--pp-border-color);
    }

    .preview-status svg {
      flex-shrink: 0;
      opacity: 0.7;
    }
    
    .preview-bio {
      padding: 16px;
      background: var(--pp-bg-secondary);
      border-radius: 12px;
      margin-bottom: 16px;
      font-size: 0.9rem;
      color: var(--pp-text-primary);
      line-height: 1.6;
      border-left: 3px solid var(--pp-accent-color);
      word-wrap: break-word;
    }
    
    .preview-details {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      margin-bottom: 16px;
      padding: 16px;
      background: var(--pp-bg-secondary);
      border-radius: 12px;
      border: 1px solid var(--pp-border-color);
    }
    
    .preview-details p {
      margin: 0;
      padding: 10px 14px;
      background: var(--pp-bg-primary);
      border-radius: 10px;
      font-size: 0.85rem;
      color: var(--pp-text-secondary);
      display: flex;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--pp-border-color);
    }

    .detail-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0.6;
      color: var(--pp-accent-color);
    }
    
    .preview-details .label {
      font-weight: 600;
      color: var(--pp-text-primary);
      font-size: 0.8rem;
    }
    
    .preview-social {
      display: flex;
      gap: 12px;
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid var(--pp-border-color);
      flex-wrap: wrap;
      justify-content: center;
    }
    
    .social-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: 12px;
      transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      cursor: pointer;
      text-decoration: none;
      box-shadow: var(--pp-shadow-sm);
      background: var(--pp-bg-primary);
      border: 1px solid var(--pp-border-color);
    }

    .social-icon-facebook:hover {
      background: #1877F2;
      border-color: #1877F2;
      transform: translateY(-4px) scale(1.1);
    }

    .social-icon-instagram:hover {
      background: linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%);
      border-color: #E4405F;
      transform: translateY(-4px) scale(1.1);
    }

    .social-icon-tiktok:hover {
      background: #000000;
      border-color: #000000;
      transform: translateY(-4px) scale(1.1);
    }

    .social-icon-twitter:hover {
      background: #000000;
      border-color: #000000;
      transform: translateY(-4px) scale(1.1);
    }

    .social-icon-website:hover {
      background: #3e82f7;
      border-color: #3e82f7;
      transform: translateY(-4px) scale(1.1);
    }
    
    .social-icon:hover svg path {
      fill: white !important;
    }
    
    .social-icon svg {
      width: 22px;
      height: 22px;
      transition: transform 0.2s ease;
    }

    /* Skeleton Loading Styles */
    .skeleton-container {
      animation: fadeIn 0.3s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes shimmer {
      0% { background-position: -200px 0; }
      100% { background-position: 200px 0; }
    }

    .skeleton-header {
      display: flex;
      gap: 20px;
      align-items: flex-start;
      margin-bottom: 20px;
    }

    .skeleton-avatar {
      width: 110px;
      height: 110px;
      border-radius: 50%;
      background: linear-gradient(90deg, var(--pp-bg-secondary) 25%, var(--pp-bg-tertiary) 50%, var(--pp-bg-secondary) 75%);
      background-size: 200px 100%;
      animation: shimmer 1.5s infinite;
      flex-shrink: 0;
    }

    .skeleton-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding-top: 10px;
    }

    .skeleton-body {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .skeleton-line {
      height: 14px;
      background: linear-gradient(90deg, var(--pp-bg-secondary) 25%, var(--pp-bg-tertiary) 50%, var(--pp-bg-secondary) 75%);
      background-size: 200px 100%;
      animation: shimmer 1.5s infinite;
      border-radius: 6px;
    }

    .skeleton-line-large {
      height: 28px;
      width: 70%;
      border-radius: 8px;
    }

    .skeleton-line-short {
      width: 40%;
    }

    .skeleton-details {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      margin-top: 16px;
      padding: 16px;
      background: var(--pp-bg-secondary);
      border-radius: 12px;
    }

    .skeleton-detail-item {
      padding: 10px;
    }

    /* Responsive adjustments */
    @media (max-width: 480px) {
      .profile-preview {
        padding: 16px;
      }

      .preview-profile-row {
        flex-direction: column;
        align-items: center;
        text-align: center;
      }

      .preview-avatar {
        width: 90px;
        height: 90px;
      }

      .preview-name-row {
        justify-content: center;
      }

      .preview-name-row h3 {
        font-size: 1.25rem;
      }

      .preview-details {
        grid-template-columns: 1fr;
      }

      .skeleton-header {
        flex-direction: column;
        align-items: center;
      }

      .skeleton-info {
        width: 100%;
        align-items: center;
      }

      .skeleton-line {
        width: 100% !important;
      }
    }
  `]
})
export class ProfilePreviewComponent {
  @Input() profile: ProfileData = { username: '' };
  
  avatarLoadError = false;
  
  platforms = [
    { id: 'facebook', name: 'Facebook' },
    { id: 'instagram', name: 'Instagram' },
    { id: 'tiktok', name: 'TikTok' },
    { id: 'twitter', name: 'X' },
    { id: 'website', name: 'Website' }
  ];
  
  constructor(private sanitizer: DomSanitizer) {}
  
  hasAnySocialLink(): boolean {
    const links = this.profile.socialLinks ? Object.values(this.profile.socialLinks) : [];
    return links.some((v) => !!(v && String(v).trim()));
  }

  hasAnyDetail(): boolean {
    return !!(this.profile.gender || 
              (this.profile.age !== null && this.profile.age !== undefined) || 
              this.profile.country || 
              this.profile.joinedAt);
  }

  getInitials(): string {
    const name = this.profile.displayName || this.profile.username || '';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  }

  getAvatarGradient(): string {
    const colors = [
      ['#667eea', '#764ba2'],
      ['#f093fb', '#f5576c'],
      ['#4facfe', '#00f2fe'],
      ['#43e97b', '#38f9d7'],
      ['#fa709a', '#fee140'],
      ['#a8edea', '#fed6e3'],
      ['#ff9a9e', '#fecfef'],
      ['#fbc2eb', '#a6c1ee']
    ];
    const index = this.profile.username.charCodeAt(0) % colors.length;
    const [start, end] = colors[index];
    return `linear-gradient(135deg, ${start} 0%, ${end} 100%)`;
  }

  onAvatarError(event: Event): void {
    this.avatarLoadError = true;
    const img = event.target as HTMLImageElement;
    img.style.display = 'none';
    // Show placeholder instead
    const parent = img.parentElement;
    if (parent) {
      const placeholder = document.createElement('div');
      placeholder.className = 'avatar-placeholder';
      placeholder.style.cssText = `
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: ${this.getAvatarGradient()};
        color: white;
        font-weight: 700;
        font-size: 2rem;
        text-transform: uppercase;
      `;
      placeholder.innerHTML = `<span>${this.getInitials()}</span>`;
      parent.appendChild(placeholder);
    }
  }
  
  getSocialSvg(platform: string): SafeHtml {
    const logos: { [key: string]: string } = {
      facebook: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="#1877F2" d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"/></svg>`,
      instagram: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="#E4405F" d="M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.1733-6.1493zm-.1524 2.5502c-.8971.0296-1.7433-.3123-2.3539-.9183-.6095-.6041-.8768-1.4398-.8473-2.3369.0296-.8971.3704-1.7433.9745-2.3539.6041-.6095 1.4408-.8768 2.3379-.8473.8971.0296 1.7433.3123 2.3539.9183.6095.6041.8768 1.4398.8473 2.3369-.0296.8971-.3704 1.7433-.9745 2.3539-.6041.6095-1.4408.8768-2.3379.8473zM12 16.5c-2.4853 0-4.5-2.0147-4.5-4.5s2.0147-4.5 4.5-4.5 4.5 2.0147 4.5 4.5-2.0147 4.5-4.5 4.5z"/></svg>`,
      tiktok: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="#000000" d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>`,
      twitter: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="#000000" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>`,
      website: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="#3e82f7" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`
    };
    return this.sanitizer.bypassSecurityTrustHtml(logos[platform] || '');
  }
}
