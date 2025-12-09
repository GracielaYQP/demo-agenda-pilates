import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { RouterModule, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { environment } from '@env/environment';
import { EstadoPago, PagosService, UpsertPago } from '../../services/pagos.service';
import { HorariosService } from '../../services/horarios.service';
import { PagosComponent } from '../pagos/pagos.component';




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
  asistenciaMeses: string[] = []; 
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


  private api = environment.apiUrl;

  constructor(
    private http: HttpClient, 
    private router: Router, 
    private horariosService: HorariosService,
    private pagosSrv: PagosService
  ) {}

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

        // 🔹 NUEVO: pedir estado de pago corriente para cada alumno
        this.alumnos.forEach((a) => {
          this.pagosSrv
            .estado(a.id, this.mesActual, this.anioActual)
            .subscribe((est) => (a._pagoMesActual = est));
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
    this.pagosSrv.confirmar(evt).subscribe({
      next: () => {
        // refrescar estado para pintar el $ en verde
        this.pagosSrv.estado(evt.userId, this.mesActual, this.anioActual).subscribe(est => {
          const idx = this.alumnos.findIndex(x => x.id === evt.userId);
          if (idx >= 0) this.alumnos[idx]._pagoMesActual = est;
          this.cerrarModal();
        });
      }
    });
  }

  // Eliminar pago del mes
  eliminarPago({ userId, mes, anio }: { userId: number; mes: number; anio: number }) {
    this.pagosSrv.eliminar(userId, mes, anio).subscribe({
      next: () => {
        // refrescar estado (pasa a pendiente)
        this.pagosSrv.estado(userId, this.mesActual, this.anioActual).subscribe(est => {
          const idx = this.alumnos.findIndex(x => x.id === userId);
          if (idx >= 0) this.alumnos[idx]._pagoMesActual = est;
          this.cerrarModal();
        });
      }
    });
  }
  
  get alumnosFiltrados() {
    return this.alumnos
      .filter(alumno =>
        alumno.apellido.toLowerCase().includes(this.filtroApellido.toLowerCase()) &&
        alumno.dni.toString().includes(this.filtroDni) &&
        alumno.telefono.toString().includes(this.filtroTelefono) &&
        (this.mostrarInactivos || alumno.activo) // 👈 esto es clave
      )
      .sort((a, b) => {
        const apellidoA = a.apellido?.toLowerCase() || '';
        const apellidoB = b.apellido?.toLowerCase() || '';
        if (apellidoA < apellidoB) return -1;
        if (apellidoA > apellidoB) return 1;
        const nombreA = a.nombre?.toLowerCase() || '';
        const nombreB = b.nombre?.toLowerCase() || '';
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
 
  cerrarModalAsistencia() {
    this.modalAsistencia = false;
  }

  verAsistencia(userId: number, nombre: string, apellido: string) {
    this.http.get<Record<string, any>>(`${this.api}/reservas/asistencia-mensual/${userId}`)
      .subscribe(data => {
        console.log('🧾 Asistencia mensual recibida:', data);
        this.asistenciaData = data;
        // Orden por año/mes (si lo querés ordenado)
        this.asistenciaMeses = Object.keys(data).sort((a, b) => {
          const [ma, ya] = a.split(' de ');
          const [mb, yb] = b.split(' de ');
          const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
          const ia = parseInt(ya, 10) * 12 + months.indexOf(ma.toLowerCase());
          const ib = parseInt(yb, 10) * 12 + months.indexOf(mb.toLowerCase());
          return ia - ib;
        });
        this.asistenciaNombre = nombre;
        this.asistenciaApellido = apellido;
        this.modalAsistencia = true;
      });
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
    this.pagosSrv.historial(a.id /*, this.anioActual */).subscribe(res => {
      this.historialAlumno = { id: a.id, nombre: a.nombre, apellido: a.apellido };
      this.historialPagos = res.historial;
      this.historialOpen = true;
    });
  }

  cerrarHistorial(){ this.historialOpen = false; }

}


