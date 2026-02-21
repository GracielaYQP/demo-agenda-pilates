import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

export type InvitacionVerificarResponse = {
  valida: boolean;
  telefono: string;
  rol: 'admin' | 'alumno' | 'superadmin' | string;
  nivel: string | null; // porque tu backend manda null si rol=admin
};

@Injectable({
  providedIn: 'root',
})
export class InvitacionService {

  private api = environment.apiUrl;
  constructor(private http: HttpClient) {}

  getInvitacion(token: string): Observable<InvitacionVerificarResponse> {
    return this.http.get<InvitacionVerificarResponse>(
      `${this.api}/invitaciones/verificar`,
      { params: { token } }
    );
  }
}