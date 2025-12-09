import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

export type PlanTipo = 'suelta' | '4' | '8' | '12';
export interface ValorPlanVM {
  id?: number;
  tipo: PlanTipo;
  precioARS: number;
  visible: boolean;
  descripcion?: string | null;
}

@Injectable({ providedIn: 'root' })
export class ValorPlanesService {
  private backendUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getPublic(): Observable<ValorPlanVM[]> {
    return this.http.get<ValorPlanVM[]>(`${this.backendUrl}/valor-planes`);
  }

  getAllAdmin(token: string): Observable<ValorPlanVM[]> {
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
    return this.http.get<ValorPlanVM[]>(`${this.backendUrl}/valor-planes/admin`, { headers });
  }

  upsert(dto: ValorPlanVM, token: string): Observable<ValorPlanVM> {
    const headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
    return this.http.post<ValorPlanVM>(`${this.backendUrl}/valor-planes/upsert`, dto, { headers });
  }
}
