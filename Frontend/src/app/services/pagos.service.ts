import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env/environment';
import { Observable, map } from 'rxjs';

export type PlanTipo = 'suelta'|'4'|'8'|'12';
export type MetodoPago = 'efectivo'|'transferencia'|'mercado_pago'|'otro';

export interface PagoDTO {
  id: number;
  fechaPago: string;     
  planTipo: PlanTipo;
  montoARS: number;
  metodo?: MetodoPago;
  notas?: string;
}

export type FasePago = 'ok' | 'warn' | 'vencido';
export interface EstadoPago {
  userId: number;

  // ciclo
  cicloInicio?: string;
  cicloFin?: string;

  isPago: boolean;
  cicloTerminado?: boolean;
  debe?: boolean;

  pago?: PagoDTO;
   fase: FasePago;
}

export interface UpsertPago {
  userId: number;
  planTipo: PlanTipo;
  montoARS: number;
  metodo?: MetodoPago;
  notas?: string;
}

export interface ResumenPagoItem {
  userId: number;
  nombre: string;
  apellido: string;
  isPago: boolean;
  montoARS?: number;
  metodo?: MetodoPago;
  fechaPago?: string;
}

export interface ResumenMensualItem {
  userId: number;
  apellido: string;
  nombre: string;
  fechaPago: string | Date;
  planTipo: PlanTipo;
  montoARS: number;
  metodo?: MetodoPago | null;
}

export interface ResumenMensual {
  anio: number;
  mes: number;
  ingresosTotalesARS: number;
  pagosCount: number;
  porPlan: Partial<Record<PlanTipo, number>>;
  items: ResumenMensualItem[];          
}

export interface HistorialPagoItem {
  anio: number;
  mes: number;                  
  fechaPago: string;            
  planTipo: PlanTipo;
  montoARS: number;
  metodo?: MetodoPago;
  notas?: string;
}

export interface HistorialResponse {
  userId: number;
  historial: HistorialPagoItem[];
}

@Injectable({ providedIn: 'root' })
export class PagosService {
  private api = environment.apiUrl;
  constructor(private http: HttpClient) {}

  /** Estado de pago del mes/año para un alumno (lo usás para pintar el $ verde/rojo y para el modal) */
  estado(userId: number): Observable<EstadoPago> {
    return this.http
      .get<EstadoPago>(`${this.api}/pagos/estado-ciclo-actual`, { params: { userId } as any })
      .pipe(
        map(est => {
          if (est?.pago && typeof (est.pago as any).montoARS === 'string') {
            (est.pago as any).montoARS = +((est.pago as any).montoARS);
          }
          return est;
        })
      );
  }

  /** Confirmar pago asociado al ciclo actual */
  confirmarCiclo(body: UpsertPago) {
    return this.http.post(`${this.api}/pagos/confirmar-ciclo`, body);
  }

  /** Eliminar pago por id */
  eliminarPorId(id: number) {
    return this.http.delete(`${this.api}/pagos/${id}`);
  }

  /** Helper: mes/año corrientes (útil en listado y modal) */
  getMesAnioActual() {
    const d = new Date();
    return { mes: d.getMonth() + 1, anio: d.getFullYear() };
  }

  resumen(mes: number, anio: number): Observable<ResumenMensual> {
    return this.http.get<ResumenMensual>(`${this.api}/pagos/resumen`, { params: { mes, anio } as any })
      .pipe(map(r => ({
        ...r,
        ingresosTotalesARS: +r.ingresosTotalesARS || 0,
        pagosCount: +r.pagosCount || 0,
        items: (r.items ?? []).map(i => ({ ...i, montoARS: +i.montoARS || 0 }))
      })));
  }


  /** Historial de pagos por alumno (opcionalmente filtrado por año) */
  historial(userId: number, anio?: number): Observable<HistorialResponse> {
    const params: any = {};
    if (anio) params.anio = anio;

    return this.http
      .get<HistorialResponse>(`${this.api}/pagos/historial/${userId}`, { params })
      .pipe(
        map(res => ({
          ...res,
          historial: (res.historial ?? []).map(p => ({
            ...p,
            // normalización defensiva
            montoARS: typeof p.montoARS === 'string' ? +p.montoARS : p.montoARS
          }))
        }))
      );
  }


  /** (Opcional) Estado de varios alumnos en un solo request para optimizar la grilla */
  estadoMultiple(userIds: number[], mes: number, anio: number): Observable<EstadoPago[]> {
    // Requiere endpoint POST /pagos/estado-multiple  { userIds, mes, anio }
    return this.http.post<EstadoPago[]>(`${this.api}/pagos/estado-multiple`, { userIds, mes, anio });
  }
}

