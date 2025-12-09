import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

@Injectable({
  providedIn: 'root',
})
export class InvitacionService {
  
  private api = environment.apiUrl;
  constructor(private http: HttpClient) {}


  getInvitacion(token: string): Observable<{ telefono: string; nivel: string }> {
    return this.http.get<{ valida: boolean; telefono: string; nivel: string }>(
      `${this.api}/invitaciones/verificar`,
      { params: { token } }
    );
  }


}
