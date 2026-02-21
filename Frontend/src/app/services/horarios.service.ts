import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, catchError, map, Observable, of, Subject, tap, throwError } from 'rxjs';
import { environment } from '@env/environment';
import { HorarioSemana } from '../interfaces/horario-semana.interface';

export type TipoAusencia = 'dia' | 'manana' | 'tarde' | 'horario';
export interface AusenciaDto {
  fecha: string;   // YYYY-MM-DD
  tipo: TipoAusencia;
  hora?: string;   // HH:mm
  motivo?: string;
}

export interface Usuario {
  id: number;
  dni?: string;
  nombre: string;
  apellido: string;
  nivel?: string;
  planMensual?: '0' | '4' | '8' | '12';
  asistenciasDelMes?: number;
  telefono?: string;
  email?: string;
  rol?: string;
  activo?: boolean;   
  avatarUrl?: string | null;
  avatarKey?: string | null;
}

export type TipoReservaBack = 'automatica' | 'recuperacion' | 'suelta';

@Injectable({ providedIn: 'root' })

export class HorariosService {

  private api = environment.apiUrl;
  private horariosSubject = new BehaviorSubject<HorarioSemana[]>([]);
  horarios$ = this.horariosSubject.asObservable();
  private ausenciasSubject = new BehaviorSubject<Map<string, AusenciaDto[]>>(new Map());
  ausencias$ = this.ausenciasSubject.asObservable();
  private reservasChangedSubject = new Subject<void>();
  reservasChanged$ = this.reservasChangedSubject.asObservable();
  

  constructor(private http: HttpClient) {}

  private buildAuthHeaders(): HttpHeaders | undefined {
    const token = localStorage.getItem('token');
    return token ? new HttpHeaders().set('Authorization', `Bearer ${token}`) : undefined;
  }

  getHorarios(): Observable<HorarioSemana[]> {
    return this.http.get<HorarioSemana[]>(`${this.api}/horarios`);
  }

  cargarHorarios() {
    const headers = this.buildAuthHeaders();
    this.http.get<HorarioSemana[]>(`${this.api}/horarios/semana`, {
      headers,
      params: { _: Date.now().toString() }
    }).subscribe({
      next: data => this.horariosSubject.next(data || []),
      error: err => {
        console.warn('❌ cargarHorarios error', err);
        this.horariosSubject.next([]); // o dejá el anterior si preferís
      }
    });
  }

  refrescarHorarios() {
    this.cargarHorarios(); // 🔄 reutiliza el mismo método
  }

  reservar(
    horarioId: number,
    nombre: string,
    apellido: string,
    fechaTurno: string,
    tipo: TipoReservaBack
  ): Observable<any> {
    if (!horarioId || isNaN(horarioId)) {
      return throwError(() => new Error('ID de horario inválido'));
    }

    const headers = this.buildAuthHeaders();

    return this.http.post(`${this.api}/reservas/${horarioId}`, {
      nombre,
      apellido,
      fechaTurno,
      tipo
    }, { headers }).pipe(
      tap(() => this.reservasChangedSubject.next()),
      catchError(err => {
        if (err?.status === 401) localStorage.removeItem('token');
        return throwError(() => err);
      })
    );
  }

  editarReserva(reservaId: number, data: any): Observable<any> {
    const headers = this.buildAuthHeaders();
    return this.http.patch(`${this.api}/reservas/${reservaId}`, data, { headers }).pipe(
      tap(() => this.reservasChangedSubject.next()),
      catchError(err => {
        if (err?.status === 401) localStorage.removeItem('token');
        return throwError(() => err);
      })
    );
  }


  getMisReservas(): Observable<any[]> {
    const token = localStorage.getItem('token');
    if (!token) {
      console.error('❌ No se encontró el token en localStorage');
      return new BehaviorSubject<any[]>([]).asObservable(); // o lanzar un error
    }

    const headers = new HttpHeaders().set('Authorization', `Bearer ${token}`);
    return this.http.get<any[]>(`${this.api}/reservas/mis-reservas`, { headers });
  }

  anularReserva(reservaId: number, tipo: 'momentanea' | 'permanente'): Observable<any> {
      const token = localStorage.getItem('token') || '';
      const headers = new HttpHeaders({
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
      });

      return this.http.patch(
          `${this.api}/reservas/cancelar/${reservaId}`,
          { tipo },
          { headers }
      ).pipe(
      tap(() => {
        // this.cargarHorarios();
        this.reservasChangedSubject.next();
      })
    );
  }

  buscarPorNombreApellido(nombre: string, apellido: string): Observable<any> {
    return this.http.get(`${this.api}/users/buscar?nombre=${nombre}&apellido=${apellido}`);
  }

  buscarPorTelefono(telefono: string): Observable<any> {
    return this.http.get(`${this.api}/users/telefono/${telefono}`);
  }

  reservarComoAdmin(
    horarioId: number,
    nombre: string,
    apellido: string,
    userId: number,
    fechaTurno: string,
    tipo: TipoReservaBack
  ): Observable<any> {
    if (!horarioId || isNaN(horarioId)) {
      return throwError(() => new Error('ID de horario inválido'));
    }

    const headers = this.buildAuthHeaders();

    return this.http.post(`${this.api}/reservas/${horarioId}`, {
      nombre,
      apellido,
      userId,
      fechaTurno,
      tipo
    }, { headers }).pipe(
      tap(() => {
        // this.cargarHorarios();
        this.reservasChangedSubject.next();
      }),
      catchError(err => {
        if (err?.status === 401) localStorage.removeItem('token');
        return throwError(() => err);
      })
    );
  }

  getHorariosDeLaSemana(): Observable<HorarioSemana[]> {
    const token = localStorage.getItem('token');
    const headers = token ? new HttpHeaders().set('Authorization', `Bearer ${token}`) : undefined;

    return this.http.get<any[]>(`${this.api}/horarios/semana`, { headers }).pipe(
      map(data => data.map(h => {
        const id = Number(h.idHorario || h.id || h.id_horario);
        if (!Number.isFinite(id)) {
          console.warn('Horario sin ID válido:', h);
        }
        return {
          ...h,
          id: id,                    // ← ASIGNA id
          idHorario: Number(h.idHorario), // opcional
        } as HorarioSemana;
      }))
    );
  }

  getReservasDeLaSemana(desde: string, hasta: string) {

    // Normalizar por las dudas
    const d = (desde || '').slice(0, 10);
    const h = (hasta || '').slice(0, 10);

      // Validación simple en el cliente para evitar 400 del servidor
    const ISO = /^\d{4}-\d{2}-\d{2}$/;
    if (!ISO.test(d) || !ISO.test(h)) {
      console.warn('getReservasDeLaSemana: fechas inválidas, se devuelve lista vacía', { desde, hasta });
      return of([]); // of ya está importado
    }

    const token = localStorage.getItem('token');
    const headers = token ? new HttpHeaders().set('Authorization', `Bearer ${token}`) : undefined;
    const url = `${this.api}/reservas/rango?desde=${d}&hasta=${h}`;

    return this.http.get<any[]>(url, { headers }).pipe(
      map(rows => (Array.isArray(rows) ? rows : []).map(r => ({
        ...r,
        horarioId: Number(r.horarioId),
        fechaTurno: String(r.fechaTurno || '').slice(0, 10),
        estado: String(r.estado || ''),
        tipo: String(r.tipo || ''),
        cancelada: (r.cancelada === true) || String(r.estado || '').toLowerCase().includes('cancel')
      }))),
      catchError(err => {
        console.warn('Error al cargar reservas:', err);
        return of([]);
      })
    );
  }

  marcarRecuperadas() {
    const headers = this.buildAuthHeaders();
    return this.http.post(`${this.api}/reservas/marcar-recuperadas`, {}, { headers }).pipe(
      catchError(err => {
        if (err?.status === 401) localStorage.removeItem('token');
        return throwError(() => err);
      })
    );
  }

  cargarAusencias(desdeYMD: string, hastaYMD: string): Observable<Map<string, AusenciaDto[]>> {
    const params = { desde: desdeYMD, hasta: hastaYMD };

    return this.http
      .get<any>(`${this.api}/feriados/ausencias-profe`, { params })
      .pipe(
        // Normalizamos SIEMPRE a array
        map((resp: any) => {
          const rows: AusenciaDto[] = Array.isArray(resp) ? resp
            : (Array.isArray(resp?.list) ? resp.list : []);
          const mapRes = new Map<string, AusenciaDto[]>();
          for (const a of rows) {
            if (!mapRes.has(a.fecha)) mapRes.set(a.fecha, []);
            mapRes.get(a.fecha)!.push(a);
          }
          return mapRes;
        }),
        tap(mapRes => this.ausenciasSubject.next(mapRes)),
        catchError(err => {
          console.warn('⚠️ No se pudieron cargar ausencias', err);
          const vacio = new Map<string, AusenciaDto[]>();
          this.ausenciasSubject.next(vacio);
          return of(vacio);
        })
      );
  }

  obtenerTodosLosAlumnos(): Observable<Usuario[]> {
    const url = `${this.api}/users/obtenerListadoUsuarios`; 
    return this.http.get<Usuario[]>(url);
  }

  actualizarBloqueo(horarioId: number, blockedReformers: number): Observable<any> {
    const headers = this.buildAuthHeaders();
    return this.http.patch(
      `${this.api}/horarios/${horarioId}/bloqueo`,
      { blockedReformers },
      { headers }
    ).pipe(
      tap(() => {
        // this.cargarHorarios();            
        this.reservasChangedSubject.next(); // ✅ notifica “cambio” a todas las vistas
      }),
      catchError(err => {
        if (err?.status === 401) localStorage.removeItem('token');
        return throwError(() => err);
      })
    );
  }

}
