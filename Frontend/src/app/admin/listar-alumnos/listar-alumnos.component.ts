import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { environment } from '@env/environment';
import { EstadoPago, PagosService, UpsertPago } from '../../services/pagos.service';
import { HorariosService } from '../../services/horarios.service';
import { PagosComponent } from '../pagos/pagos.component';
import { catchError, forkJoin, of } from 'rxjs';

interface Alumno {
  id: number;
  nombre: string;
  apellido: string;
  dni: string;
  telefono: string;
  email: string;
  nivel: string;
  planMensual: string;
  activo: boolean;
  _pagoMesActual?: EstadoPago;
}

@Component({
  standalone: true,
  selector: 'app-listar-alumnos',
  imports: [CommonModule, RouterModule, FormsModule, PagosComponent],
  templateUrl: './listar-alumnos.component.html',
  styleUrls: ['./listar-alumnos.component.css'],
})
export class ListarAlumnosComponent implements OnInit {
  
  alumnos: Alumno[] = [];
  filtroApellido: string = '';
  filtroDni: string = '';
  filtroTelefono: string = '';
  modalConfirmacionInactivo: boolean = false;
  alumnoSeleccionadoId: number | null = null;
  alumnoSeleccionadoNombre: string = '';
  alumnoSeleccionadoApellido: string = '';
  modalAsistencia: boolean = false;
  asistenciaNombre: string = '';
  asistenciaApellido: string = '';
  asistenciaData: any = {};
  asistenciaCiclos: any[] = []; 
  mostrarInactivos: boolean = false; 
  modalConfirmacionReactivar = false;
  mesActual = new Date().getMonth() + 1;   // 1..12
  anioActual = new Date().getFullYear();
  showPagoModal = false;
  modalAlumno: Alumno | null = null;
  modalEstado: EstadoPago | undefined;
  historialOpen = false;
  historialAlumno?: { id:number; nombre:string; apellido:string };
  historialPagos: Array<{ anio:number; mes:number; fechaPago:string; planTipo:string; montoARS:number; metodo?:string; notas?:string }> = [];
  asistenciaCicloActual: any | null = null;
  modalHistorialCiclos = false;
  historialPorAnio: Array<{ anio: number; ciclos: any[] }> = [];
  expandedCiclos = new Set<string>();
  mostrarEmail: boolean = false;

  private api = environment.apiUrl;

  constructor(
    private http: HttpClient, 
    private router: Router, 
    private horariosService: HorariosService,
    private pagosSrv: PagosService
  ) {}

  trackByCiclo = (_: number, ciclo: any) => this.cicloKey(ciclo);
  trackByAnio = (_: number, bloque: any) => bloque.anio;


  ngOnInit(): void {
    this.obtenerAlumnos();
  }

  private recalcularPeriodoActual() {
    const now = new Date();
    this.mesActual = now.getMonth() + 1;
    this.anioActual = now.getFullYear();
  }

  obtenerAlumnos() {
    this.recalcularPeriodoActual();
    this.http
      .get<Alumno[]>(`${this.api}/users/obtenerListadoUsuarios`)
      .subscribe((data) => {
        console.log('📋 Alumnos recibidos:', data);
        this.alumnos = data
          .filter((alumno) => alumno.nivel?.toLowerCase() !== 'admin')
          .sort((a, b) => {
            const apellidoA = a.apellido?.toLowerCase() || '';
            const apellidoB = b.apellido?.toLowerCase() || '';
            if (apellidoA < apellidoB) return -1;
            if (apellidoA > apellidoB) return 1;
            const nombreA = a.nombre?.toLowerCase() || '';
            const nombreB = b.nombre?.toLowerCase() || '';
            return nombreA.localeCompare(nombreB);
          });

        // ✅ Pedir estado de pago de todos juntos
      const calls = this.alumnos.map(a =>
        this.pagosSrv.estado(a.id).pipe(
          catchError(() => of(undefined)) // si falla uno, no rompe todo
        )
      );

      // Si no hay alumnos, evitamos forkJoin([])
      if (!calls.length) return;

      forkJoin(calls).subscribe(estados => {
        estados.forEach((est, i) => {
          this.alumnos[i]._pagoMesActual = est;
        });
      });
    });
  }

  abrirPago(a: Alumno) {
    this.modalAlumno = a;
    this.modalEstado = a._pagoMesActual;
    this.showPagoModal = true;
  }

  cerrarModal() {
    this.showPagoModal = false;
    this.modalAlumno = null;
    this.modalEstado = undefined;
  }

  // Confirmar (crear/editar) pago
  confirmarPago(evt: UpsertPago) {
    this.pagosSrv.confirmarCiclo(evt).subscribe({
      next: () => {
        this.pagosSrv.estado(evt.userId).subscribe(est => {
          const idx = this.alumnos.findIndex(x => x.id === evt.userId);
          if (idx >= 0) this.alumnos[idx]._pagoMesActual = est;
          this.cerrarModal();
        });
      }
    });
  }

  // Eliminar pago del mes
  eliminarPago({ pagoId, userId }: { pagoId: number; userId: number }) {
    this.pagosSrv.eliminarPorId(pagoId).subscribe({
      next: () => {
        this.pagosSrv.estado(userId).subscribe(est => {
          const idx = this.alumnos.findIndex(x => x.id === userId);
          if (idx >= 0) this.alumnos[idx]._pagoMesActual = est;
          this.cerrarModal();
        });
      }
    });
  }

  get alumnosFiltrados() {
    const fa = (this.filtroApellido ?? '').toLowerCase();
    const fd = (this.filtroDni ?? '');
    const ft = (this.filtroTelefono ?? '');

    return this.alumnos
      .filter(a => {
        const apellido = (a.apellido ?? '').toLowerCase();
        const dni = String(a.dni ?? '');
        const tel = String(a.telefono ?? '');

        return (
          apellido.includes(fa) &&
          dni.includes(fd) &&
          tel.includes(ft) &&
          (this.mostrarInactivos || a.activo)
        );
      })
      .sort((a, b) => {
        const apellidoA = (a.apellido ?? '').toLowerCase();
        const apellidoB = (b.apellido ?? '').toLowerCase();
        if (apellidoA < apellidoB) return -1;
        if (apellidoA > apellidoB) return 1;
        const nombreA = (a.nombre ?? '').toLowerCase();
        const nombreB = (b.nombre ?? '').toLowerCase();
        return nombreA.localeCompare(nombreB);
      });
  }

  editarAlumno(id: number) {
    // Redirige a una ruta de edición, por ejemplo:
    this.router.navigate(['/editar-usuario', id]);
  }

  inactivarAlumno(id: number) {
    const alumno = this.alumnos.find(a => a.id === id);
    if (alumno) {
      this.alumnoSeleccionadoId = alumno.id;
      this.alumnoSeleccionadoNombre = alumno.nombre;
      this.alumnoSeleccionadoApellido = alumno.apellido;
      this.modalConfirmacionInactivo = true;
    }
  }

  confirmarInactivacion() {
    if (!this.alumnoSeleccionadoId) return;
    this.http.patch(`${this.api}/users/inactivar/${this.alumnoSeleccionadoId}`, {}).subscribe(() => {
      this.modalConfirmacionInactivo = false;
      this.obtenerAlumnos(); // Refresca lista
      this.horariosService.refrescarHorarios(); // Refresca horarios
    });
  }

  cerrarModalInactivacion() {
    this.modalConfirmacionInactivo = false;
    this.alumnoSeleccionadoId = null;
  }

  irAFormularioRegistro() {
    this.router.navigate(['/register'], { queryParams: { admin: true } });
  }
 

  private agruparCiclosPorAnio(ciclos: any[]): Array<{ anio: number; ciclos: any[] }> {
    const map = new Map<number, any[]>();

    for (const c of ciclos) {
      const inicio = (c.cicloInicio ?? '').slice(0, 10);
      const anio = inicio ? Number(inicio.slice(0, 4)) : 0;
      if (!map.has(anio)) map.set(anio, []);
      map.get(anio)!.push(c);
    }

    // ordenar ciclos dentro de cada año por inicio DESC
    for (const [anio, arr] of map.entries()) {
      arr.sort((a, b) => (b.cicloInicio ?? '').localeCompare(a.cicloInicio ?? ''));
    }

    // ordenar años DESC
    return Array.from(map.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([anio, ciclos]) => ({ anio, ciclos }));
  }

  abrirHistorialCiclos() { this.modalHistorialCiclos = true; }
  cerrarHistorialCiclos() { this.modalHistorialCiclos = false; }

  private cicloKey(c: any): string {
    const i = String(c?.cicloInicio ?? '').slice(0,10);
    const f = String((c?.cicloFin ?? c?.finVentana) ?? '').slice(0,10);
    return `${i}|${f}`;
  }

  toggleCiclo(ciclo: any) {
    const k = this.cicloKey(ciclo);
    if (this.expandedCiclos.has(k)) this.expandedCiclos.delete(k);
    else this.expandedCiclos.add(k);
  }

  isCicloExpandido(ciclo: any): boolean {
    return this.expandedCiclos.has(this.cicloKey(ciclo));
  }

  private hoyYMDAR(): string {
    const ahoraAR = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' })
    );
    const y = ahoraAR.getFullYear();
    const m = String(ahoraAR.getMonth() + 1).padStart(2, '0');
    const d = String(ahoraAR.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private inicioCiclo(c: any): string {
    return String(c?.cicloInicio ?? '').slice(0, 10);
  }

  private finEfectivoCiclo(c: any): string {
    // si cerró por cantidad, normalmente viene cicloFin (finReal)
    // si no, finVentana
    return String((c?.cicloFin || c?.finVentana || '')).slice(0, 10);
  }

  verAsistencia(userId: number, nombre: string, apellido: string) {
    this.http.get<any[]>(`${this.api}/reservas/asistencia-ciclos/${userId}`, {
      params: { _: Date.now().toString() }
    }).subscribe((ciclos) => {

      const hoy = this.hoyYMDAR();

      const ciclosLimpios = this.quitarCiclosSolapados(ciclos ?? [])
        .slice()
        .sort((a, b) => (b.cicloInicio ?? '').localeCompare(a.cicloInicio ?? ''));

      const cicloActual = ciclosLimpios.find(c => {
        const ini = String(c?.cicloInicio ?? '').slice(0, 10);
        const fin = String((c?.cicloFin || c?.finVentana || '')).slice(0, 10);
        return ini && fin && hoy >= ini && hoy <= fin;
      }) ?? null;

      this.asistenciaCicloActual = cicloActual;

      const anteriores = cicloActual
        ? ciclosLimpios.filter(c => c !== cicloActual)
        : ciclosLimpios;

      this.historialPorAnio = this.agruparCiclosPorAnio(anteriores);

      this.asistenciaNombre = nombre;
      this.asistenciaApellido = apellido;
      this.modalAsistencia = true;
    });
  }

  private quitarCiclosSolapados(ciclos: any[]): any[] {
    const norm = (c: any) => ({
      ...c,
      _ini: String(c?.cicloInicio ?? '').slice(0, 10),
      _fin: String((c?.cicloFin ?? c?.finVentana) ?? '').slice(0, 10),
    });

    const arr = (ciclos ?? [])
      .map(norm)
      .filter(c => c._ini && c._fin)
      .sort((a, b) => a._ini.localeCompare(b._ini)); // ASC

    const out: any[] = [];
    let lastFin = '';

    for (const c of arr) {
      if (!lastFin) {
        out.push(c);
        lastFin = c._fin;
        continue;
      }

      // si el nuevo ciclo arranca ANTES o IGUAL al fin del anterior => solapa => lo descartamos
      if (c._ini <= lastFin) {
        continue;
      }

      out.push(c);
      lastFin = c._fin;
    }

    // devolver sin campos internos
    return out.map(({ _ini, _fin, ...rest }) => rest);
  }

  cerrarModalAsistencia() {
    this.modalAsistencia = false;
  }

  ordenarFechasAsc(arr: string[] | null | undefined): string[] {
    if (!arr?.length) return [];
    // Tus fechas vienen como YYYY-MM-DD, así que ordenar string funciona perfecto
    return [...arr].sort((a, b) => a.localeCompare(b));
  }

  formatearFechaAR(ymd: string | null | undefined): string {
    if (!ymd) return '';
    const s = String(ymd).slice(0, 10); // por si viniera con hora
    const [y, m, d] = s.split('-');
    if (!y || !m || !d) return s;
    return `${d}/${m}/${y}`; // dd/MM/yyyy
  }

  get tieneHistorialFinalizado(): boolean {
    if (!this.historialPorAnio?.length) return false;
    return this.historialPorAnio.some(b => Array.isArray(b.ciclos) && b.ciclos.length > 0);
  }

  onClickReactivar(evt: MouseEvent, alumno: Alumno) {
    evt.preventDefault();
    evt.stopPropagation();
    console.log('[UI] click reactivar', alumno);

    this.alumnoSeleccionadoId = alumno.id;
    this.alumnoSeleccionadoNombre = alumno.nombre;
    this.alumnoSeleccionadoApellido = alumno.apellido;

    this.modalConfirmacionReactivar = true; // <-- solo abre modal
  }

  confirmarReactivacion() {
    if (!this.alumnoSeleccionadoId) return;

    console.log('[API] PATCH reactivar', this.alumnoSeleccionadoId);
    this.http.patch(`${this.api}/users/reactivar/${this.alumnoSeleccionadoId}`, {})
      .subscribe(() => {
        this.modalConfirmacionReactivar = false;
        this.alumnoSeleccionadoId = null;
        this.obtenerAlumnos();
        this.horariosService.refrescarHorarios();
      });
  }

  cerrarModalReactivacion() {
    this.modalConfirmacionReactivar = false;
    this.alumnoSeleccionadoId = null;
  }

  esPagoVisible(alumno: any): boolean {
    return true; 
  }

  verHistorialPagos(a: Alumno){
    this.pagosSrv.historial(a.id).subscribe(res => {
      this.historialAlumno = { id: a.id, nombre: a.nombre, apellido: a.apellido };

      this.historialPagos = (res.historial ?? []).map((p: any) => {
        const dt = p.fechaPago ? new Date(p.fechaPago) : null;

        const mes = (p.mes != null && p.mes !== '') ? Number(p.mes)
          : (dt && !isNaN(dt.getTime()) ? dt.getMonth() + 1 : null);

        const anio = (p.anio != null && p.anio !== '') ? Number(p.anio)
          : (dt && !isNaN(dt.getTime()) ? dt.getFullYear() : null);

        return { ...p, mes, anio };
      });

      this.historialOpen = true;
    });
  }


  cerrarHistorial(){ this.historialOpen = false; }

}


