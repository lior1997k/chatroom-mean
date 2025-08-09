// src/app/services/upload.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpEvent, HttpEventType, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Subscription } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class UploadService {
  constructor(private http: HttpClient) {}

  /**
   * Upload a voice blob with progress + cancel.
   * Returns { progress$, start(), cancel() }
   */
  uploadVoice(params: {
    file: Blob;
    durationMs: number;
    token: string;
  }) {
    const { file, durationMs, token } = params;

    const formData = new FormData();
    formData.append('voice', file, `voice-${Date.now()}.webm`);
    formData.append('durationMs', String(durationMs));

    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });

    const progress$ = new BehaviorSubject<number>(0);
    let sub: Subscription | undefined;

    const start = () =>
      new Promise<{ url: string }>((resolve, reject) => {
        sub = this.http
          .post<{ url: string }>(`${environment.apiUrl}/api/upload/voice`, formData, {
            headers,
            reportProgress: true,
            observe: 'events',
          })
          .subscribe({
            next: (event: HttpEvent<any>) => {
              if (event.type === HttpEventType.UploadProgress) {
                const total = event.total ?? 0;
                const percent = total ? Math.round((100 * event.loaded) / total) : 0;
                progress$.next(percent);
              } else if (event.type === HttpEventType.Response) {
                progress$.next(100);
                resolve(event.body);
              }
            },
            error: (err) => {
              reject(err);
            },
          });
      });

    const cancel = () => {
      if (sub) {
        sub.unsubscribe();
        sub = undefined;
      }
    };

    return { progress$, start, cancel };
  }
}
