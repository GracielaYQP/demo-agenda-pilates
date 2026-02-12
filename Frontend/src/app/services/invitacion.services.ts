import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

export type RolInvitacion = 'admin' | 'alumno';

export interface InvitacionValidada {
  valida: boolean;
  telefono: string;
  rol: RolInvitacion;
  nivel: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class InvitacionService {
  
  private api = environment.apiUrl;
  constructor(private http: HttpClient) {}

  getInvitacion(token: string): Observable<InvitacionValidada> {
    return this.http.get<InvitacionValidada>(
      `${this.api}/invitaciones/verificar`,
      { params: { token } }
    );
  }
}
