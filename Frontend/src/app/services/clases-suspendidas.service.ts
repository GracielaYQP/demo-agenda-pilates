import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { catchError, Observable, of, tap, map } from 'rxjs';
import { environment } from '@env/environment';

export type TipoAusencia = 'dia' | 'manana' | 'tarde' | 'horario';

export interface AusenciaProfe {
  id: number;
  fecha: string;   // YYYY-MM-DD
  tipo: TipoAusencia;
  hora?: string;   // HH:mm
  motivo?: string;
  createdAt?: string;
}

@Injectable({ providedIn: 'root' })
export class ClasesSuspendidasService {
  private api = environment.apiUrl;
  private base = `${this.api}/feriados/ausencias-profe`;

  constructor(private http: HttpClient) {}

  crear(body: Omit<AusenciaProfe, 'id' | 'createdAt'>): Observable<AusenciaProfe> {
    return this.http.post<AusenciaProfe>(this.base, body);
  }

  listar(desde?: string, hasta?: string): Observable<AusenciaProfe[]> {
    let params = new HttpParams();

    const d = this.toYmd(desde);
    const h = this.toYmd(hasta);

    if (d) params = params.set('desde', d);
    if (h) params = params.set('hasta', h);

    return this.http.get<any>(this.base, { params }).pipe(
      tap(() => {
        const q = params.keys().map(k => `${k}=${params.get(k)}`).join('&');
        console.log(`GET ${this.base}?${q}`);
      }),
      tap(response => console.log('GET ausencias (raw)', response)),
      map(response => Array.isArray(response) ? response :
          (Array.isArray(response?.list) ? response.list : [])),
      tap(list => console.log('GET ausencias (tras mapeo)', { count: list.length, list })),
      catchError(e => { console.warn('⚠️ No se pudieron cargar ausencias', e); return of<AusenciaProfe[]>([]); }),
    );
  }

  private toYmd(d?: string | Date | null): string | undefined {
    if (!d) return undefined;

    // Date object
    if (d instanceof Date && !isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }

    // String
    const s = String(d).trim();

    // Ya viene en ISO (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    // DD/MM/YYYY
    const m1 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m1) {
      const [_, dd, mm, yyyy] = m1;
      return `${yyyy}-${mm}-${dd}`;
    }

    // DD-MM-YYYY
    const m2 = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (m2) {
      const [_, dd, mm, yyyy] = m2;
      return `${yyyy}-${mm}-${dd}`;
    }

    // Último intento con Date.parse (por si viene como 'Aug 19, 2025', etc.)
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) {
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const day = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }

    return undefined; // inválido
  }

  actualizar(id: number, body: Partial<AusenciaProfe>): Observable<AusenciaProfe> {
    return this.http.patch<AusenciaProfe>(`${this.base}/${id}`, body);
  }

  eliminar(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/${id}`);
  }
}
