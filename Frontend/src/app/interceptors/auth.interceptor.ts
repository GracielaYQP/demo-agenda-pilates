import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '@env/environment';
const API_BASE = environment.apiUrl?.replace(/\/+$/, '');

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const isPublic = 
    req.url.includes('/auth/login') ||
    req.url.includes('/auth/reset-password') ||
    req.url.includes('/auth/reset-link-whatsapp') ||
    req.url.includes('/auth/register-invitacion') ||
    req.url.includes('/auth/validar/') ||
    req.url.includes('/auth/bootstrap-admin');

  const token = localStorage.getItem('token');
  const isApiCall = API_BASE && req.url.startsWith(API_BASE);

  if (!token || isPublic || !isApiCall) return next(req);
  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};
