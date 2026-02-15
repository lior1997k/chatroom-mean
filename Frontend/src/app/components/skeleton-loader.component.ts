import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-skeleton-loader',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div [class]="'skeleton skeleton-' + variant">
      <div *ngIf="variant === 'text'" class="skeleton-text"></div>
      <div *ngIf="variant === 'avatar'" class="skeleton-avatar"></div>
      <div *ngIf="variant === 'card'" class="skeleton-card">
        <div class="skeleton-card-header"></div>
        <div class="skeleton-card-body">
          <div class="skeleton-text" style="margin-bottom: 8px;"></div>
          <div class="skeleton-text" style="width: 80%; margin-bottom: 8px;"></div>
          <div class="skeleton-text" style="width: 60%;"></div>
        </div>
      </div>
      <div *ngIf="variant === 'input'" class="skeleton-input"></div>
      <div *ngIf="variant === 'button'" class="skeleton-button"></div>
    </div>
  `,
  styles: [`
    .skeleton {
      background: linear-gradient(90deg, #f0f4f8 25%, #e2e8f0 50%, #f0f4f8 75%);
      background-size: 200% 100%;
      animation: shimmer 2s infinite;
      border-radius: 8px;
    }

    .skeleton-text {
      height: 16px;
      width: 100%;
      border-radius: 4px;
    }

    .skeleton-avatar {
      width: 100px;
      height: 100px;
      border-radius: 50%;
    }

    .skeleton-card {
      border-radius: 12px;
      overflow: hidden;
    }

    .skeleton-card-header {
      height: 24px;
      width: 40%;
      margin-bottom: 16px;
    }

    .skeleton-card-body {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .skeleton-input {
      height: 40px;
      width: 100%;
      border-radius: 8px;
    }

    .skeleton-button {
      height: 40px;
      width: 120px;
      border-radius: 8px;
    }

    @keyframes shimmer {
      0% {
        background-position: 200% 0;
      }
      100% {
        background-position: -200% 0;
      }
    }
  `]
})
export class SkeletonLoaderComponent {
  @Input() variant: 'text' | 'avatar' | 'card' | 'input' | 'button' = 'text';
}
