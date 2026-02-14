import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';

import { AuthService } from '../services/auth';

function isAuthEndpoint(url: string): boolean {
  return url.includes('/api/user/login')
    || url.includes('/api/user/register')
    || url.includes('/api/user/refresh-token');
}

export const authErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401 && !isAuthEndpoint(req.url)) {
        const refreshToken = auth.getRefreshToken();
        if (refreshToken) {
          return auth.refreshSession().pipe(
            switchMap(() => {
              const token = auth.getToken();
              if (!token) return throwError(() => err);
              const retry = req.clone({
                setHeaders: {
                  Authorization: `Bearer ${token}`
                }
              });
              return next(retry);
            }),
            catchError(() => {
              auth.logout();
              if (!router.url.startsWith('/login')) {
                router.navigate(['/login'], { queryParams: { reason: 'session-expired' } });
              }
              return throwError(() => err);
            })
          );
        }

        auth.logout();
        if (!router.url.startsWith('/login')) {
          router.navigate(['/login'], { queryParams: { reason: 'session-expired' } });
        }
      }

      return throwError(() => err);
    })
  );
};
