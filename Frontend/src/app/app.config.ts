// src/app/app.config.ts
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './interceptors/auth.interceptor'; // ajusta la ruta si difiere

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),

    // 👇 REGISTRA HttpClient + tu interceptor
    provideHttpClient(
      withInterceptors([authInterceptor])
    ),
  ],
};
