import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '@env/environment';

/** Ajustá tu base URL en environment */

export interface ResumenMensualVM {
  anio: number;
  mes: number;
  ingresosTotalesARS: number;
  pagosCount: number;
  ticketPromedioARS: number;
  porPlan: Record<'suelta'|'4'|'8'|'12', number>;
  porDia: Array<{ dia: number; monto: number }>;
}

export interface DeudorVM {
  userId: number;
  alumno: string;
  plan: 'suelta'|'4'|'8'|'12';
  montoMensual: number;
  ultimaFechaPago: string | null;
  diasAtraso: number;
  estado: 'En término'|'Atrasado';
  contactos: { whatsapp?: string|null; telefono?: string|null; email?: string|null };
}

export interface DeudoresResp {
  anio: number;
  mes: number;
  totalDeudores: number;
  totalAdeudadoARS: number;
  items: DeudorVM[];
}

export interface EstadoPagoResp {
  userId: number; mes: number; anio: number;
  isPago: boolean; pago?: any;
}

export interface UpsertPagoDto {
  userId: number; mes: number; anio: number;
  planTipo: 'suelta'|'4'|'8'|'12';
  montoARS: number;
  metodo?: 'efectivo'|'transferencia'|'mercado_pago'|'otro';
  notas?: string;
}

@Injectable({ providedIn: 'root' })
export class PagosDashboardService {
  private api = environment.apiUrl;
  private http = inject(HttpClient);

  getResumenMensual(anio: number, mes: number): Observable<ResumenMensualVM> {
    const params = new HttpParams().set('anio', anio).set('mes', mes);
    return this.http.get<ResumenMensualVM>(`${this.api}/dashboard/resumen-mensual`, { params });
  }

  getDeudores(anio: number, mes: number): Observable<DeudoresResp> {
    const params = new HttpParams().set('anio', anio).set('mes', mes);
    return this.http.get<DeudoresResp>(`${this.api}/dashboard/deudores`, { params });
  }

  getEstadoPago(userId: number, anio: number, mes: number): Observable<EstadoPagoResp> {
    const params = new HttpParams().set('userId', userId).set('anio', anio).set('mes', mes);
    return this.http.get<EstadoPagoResp>(`${this.api}/pagos/estado`, { params });
  }

  confirmarPago(dto: UpsertPagoDto) {
    return this.http.post(`${this.api}/pagos/confirmar`, dto);
  }

  eliminarPago(userId: number, anio: number, mes: number) {
    const params = new HttpParams().set('userId', userId).set('anio', anio).set('mes', mes);
    return this.http.delete(`${this.api}/pagos`, { params });
  }
}
