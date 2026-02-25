import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, RouterStateSnapshot } from '@angular/router';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  constructor(private auth: AuthService, private router: Router) {}

  canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): boolean {
    if (!this.auth.isLoggedIn()) {
      this.router.navigate(['/login'], { queryParams: { returnUrl: state.url } });
      return false;
    }

    const allowed = ((route.data?.['roles'] as string[] | undefined) ?? [])
      .map(r => (r || '').trim().toLowerCase())
      .filter(Boolean);

    // si la ruta no pide roles, pasa cualquier logueado
    if (allowed.length === 0) return true;

    const userRole = (this.auth.getRol() || '').trim().toLowerCase();

    if (!allowed.includes(userRole)) {
      this.router.navigate(['/']); 
      return false;
    }

    return true;
  }
}