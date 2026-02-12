import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, Router, RouterStateSnapshot  } from '@angular/router';
import { AuthService } from './auth.service';

@Injectable({providedIn: 'root'})
export class AuthGuard implements CanActivate{

  constructor(private auth: AuthService, private router: Router) {}

  canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): boolean {
    if (!this.auth.isLoggedIn()) {
      this.router.navigate(['/login'], { queryParams: { returnUrl: state.url } });
      return false;
    }

    const userRole = (this.auth.getRol() || '').trim().toLowerCase(); 
    const allowed = (route.data['roles'] as string[] | undefined) ?? [];
    if (allowed.length === 0) return true; // si la ruta no pide roles, pasa

    const allowedNorm = allowed.map(r => r.toLowerCase());
    const tieneRol =
      allowedNorm.includes(userRole) ||
      (userRole === 'superadmin' && allowedNorm.includes('admin'));

    if (!tieneRol) {
      this.router.navigate(['/']); // o una página 403
      return false;
    }

    return true;
  }

  private normalizarRoles(input: string | string[] | undefined): string | string[] {
    if (!input) return '';
    if (Array.isArray(input)) return input.map(r => (r || '').trim().toLowerCase());
    return input.trim().toLowerCase();
  }
}
