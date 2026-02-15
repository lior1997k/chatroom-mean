import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService, Toast } from '../../services/toast.service';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="toast-container">
      <div *ngFor="let toast of toasts; trackBy: trackByToastId" 
           [class]="'toast toast-' + toast.type">
        <span class="toast-icon">
          <span *ngIf="toast.type === 'success'" class="icon">✓</span>
          <span *ngIf="toast.type === 'error'" class="icon">✕</span>
          <span *ngIf="toast.type === 'info'" class="icon">ⓘ</span>
          <span *ngIf="toast.type === 'warning'" class="icon">⚠</span>
        </span>
        <span class="toast-message">{{ toast.message }}</span>
        <button type="button" class="toast-close" (click)="close(toast.id)" aria-label="Close notification">
          ×
        </button>
      </div>
    </div>
  `,
  styles: [`
    .toast-container {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-width: 420px;
      pointer-events: none;
    }

    .toast {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 16px;
      border-radius: 10px;
      font-size: 0.9rem;
      font-weight: 500;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      animation: slideInRight 0.3s ease-out;
      pointer-events: auto;
    }

    .toast-success {
      background: linear-gradient(135deg, #f1fff5 0%, #e0ffe8 100%);
      color: #2d7a45;
      border: 1px solid rgba(60, 150, 80, 0.2);
    }

    .toast-error {
      background: linear-gradient(135deg, #fff6f6 0%, #ffecec 100%);
      color: #b93434;
      border: 1px solid rgba(185, 80, 80, 0.2);
    }

    .toast-info {
      background: linear-gradient(135deg, #f1f6ff 0%, #e8f0ff 100%);
      color: #3d63b3;
      border: 1px solid rgba(61, 99, 179, 0.2);
    }

    .toast-warning {
      background: linear-gradient(135deg, #fff9f0 0%, #ffe8d0 100%);
      color: #b87c3a;
      border: 1px solid rgba(184, 124, 58, 0.2);
    }

    .toast-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .icon {
      font-weight: 700;
      font-size: 1.1rem;
    }

    .toast-message {
      flex: 1;
      line-height: 1.4;
    }

    .toast-close {
      flex-shrink: 0;
      background: none;
      border: none;
      color: inherit;
      font-size: 1.5rem;
      cursor: pointer;
      padding: 0;
      margin: 0;
      opacity: 0.6;
      transition: opacity 0.2s ease;
      line-height: 1;
    }

    .toast-close:hover {
      opacity: 1;
    }

    @keyframes slideInRight {
      from {
        opacity: 0;
        transform: translateX(100px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }

    @media (max-width: 640px) {
      .toast-container {
        top: 12px;
        right: 12px;
        left: 12px;
        max-width: none;
      }

      .toast {
        padding: 12px 14px;
        font-size: 0.85rem;
      }
    }
  `]
})
export class ToastContainerComponent implements OnInit {
  toasts: Toast[] = [];

  constructor(private toastService: ToastService) {}

  ngOnInit(): void {
    this.toastService.getToasts().subscribe(toasts => {
      this.toasts = toasts;
    });
  }

  close(id: string): void {
    this.toastService.remove(id);
  }

  trackByToastId(index: number, toast: Toast): string {
    return toast.id;
  }
}
