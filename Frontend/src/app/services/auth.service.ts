import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '@env/environment';

@Injectable({
  providedIn: 'root',
})
export class AuthService {

  private api = environment.apiUrl;
  constructor(private http: HttpClient) {}

  login(credentials: { usuario: string; password: string }): Observable<any> {
    return this.http.post(`${this.api}/auth/login`, credentials).pipe(
      tap((res: any) => {
        const token =
          res?.access_token ?? res?.token ?? res?.jwt ?? res?.data?.token;
        if (!token) throw new Error('No llegó token en el login');

        localStorage.setItem('token', token);
        localStorage.setItem('nombreUsuario', res.nombre ?? '');
        localStorage.setItem('apellidoUsuario', res.apellido ?? '');
        localStorage.setItem('rol', res.rol ?? '');
        // si tu backend envía el nivel:
        if (res.nivel) localStorage.setItem('nivelUsuario', res.nivel);
        if (res.planMensual) localStorage.setItem('planMensual', res.planMensual);
      })
    );
  }

  getToken(): string | null {
    return localStorage.getItem('token');
  }


  getRol(): string | null {
    return localStorage.getItem('rol');
  }

  register(data: {
    dni: string;
    nombre: string;
    apellido: string;
    telefono: string;
    email: string;
    password: string;
    nivel: string;
    planMensual: string;
  }): Observable<any> {
    return this.http.post(`${this.api}/users`, data);
  }

  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('nombreUsuario');
    localStorage.removeItem('apellidoUsuario'); // ← faltaba
    localStorage.removeItem('rol');
    localStorage.removeItem('nivelUsuario');
  }

  isLoggedIn(): boolean {
    return !!localStorage.getItem('token');
  }

  solicitarResetWhatsapp(data: { usuario: string }) {
    return this.http.post<any>(
      `${this.api}/auth/reset-link-whatsapp`,
      data
    );
  }

 
  resetPassword(token: string, newPassword: string) {
    return this.http.post<any>(`${this.api}/auth/reset-password`, { token, newPassword });
  }

  reactivarUsuario(id: number) {
    return this.http.patch(`${this.api}/users/reactivar/${id}`, {});
  }

  hasRole(role: string): boolean {
    return (this.getRol() || '').toLowerCase() === role.toLowerCase();
  }

  isAdmin(): boolean {
    return this.hasRole('admin');
  }

  registerInvitacion(data: {
    dni: string;
    nombre: string;
    apellido: string;
    telefono: string;
    email: string;
    password: string;
    planMensual: string;
    token: string;
  }) {
    return this.http.post(`${this.api}/auth/register-invitacion`, data);
  }


}

