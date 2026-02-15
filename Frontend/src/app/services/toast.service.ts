import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
}

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  private toasts$ = new BehaviorSubject<Toast[]>([]);
  private toastIdCounter = 0;

  constructor() {}

  getToasts(): Observable<Toast[]> {
    return this.toasts$.asObservable();
  }

  success(message: string, duration = 3000): void {
    this.add({
      message,
      type: 'success',
      duration
    });
  }

  error(message: string, duration = 4000): void {
    this.add({
      message,
      type: 'error',
      duration
    });
  }

  info(message: string, duration = 3000): void {
    this.add({
      message,
      type: 'info',
      duration
    });
  }

  warning(message: string, duration = 3500): void {
    this.add({
      message,
      type: 'warning',
      duration
    });
  }

  private add(toast: Omit<Toast, 'id'>): void {
    const id = `toast-${++this.toastIdCounter}`;
    const newToast: Toast = { id, ...toast };
    
    const currentToasts = this.toasts$.value;
    this.toasts$.next([...currentToasts, newToast]);

    if (toast.duration && toast.duration > 0) {
      setTimeout(() => this.remove(id), toast.duration);
    }
  }

  remove(id: string): void {
    const currentToasts = this.toasts$.value;
    this.toasts$.next(currentToasts.filter(t => t.id !== id));
  }

  clear(): void {
    this.toasts$.next([]);
  }
}
