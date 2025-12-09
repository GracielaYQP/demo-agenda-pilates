import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';

import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './app/interceptors/auth.interceptor';

import { provideRouter, withHashLocation, withInMemoryScrolling } from '@angular/router';
import { routes } from './app/app.routes';

import { provideServiceWorker } from '@angular/service-worker';
import { isDevMode } from '@angular/core';

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(withInterceptors([authInterceptor])),
    provideRouter(
      routes,
      withHashLocation(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled' })
    ),
    // SW real; queda activo sólo en prod
    provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode() }),
  ],
}).catch(err => console.error(err));
