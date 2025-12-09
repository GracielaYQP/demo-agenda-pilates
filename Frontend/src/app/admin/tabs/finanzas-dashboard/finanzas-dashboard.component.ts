import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder } from '@angular/forms';
import { PagosDashboardService, ResumenMensualVM, DeudoresResp, UpsertPagoDto, DeudorVM } from '../../../services/dashboard.service';
import { forkJoin } from 'rxjs';
import { PagosComponent } from '../../pagos/pagos.component';
import { EstadoPago, PagosService, UpsertPago } from '../../../services/pagos.service';
import { ResumenMensual } from '../../../services/pagos.service';

type AlumnoModal = {
  id: number;
  nombre: string;
  apellido: string;
  dni: string;
  telefono: string;
  email: string;
  nivel: string;
  activo: boolean;
  planMensual: 'suelta'|'4'|'8'|'12';
  _pagoMesActual?: EstadoPago;
};

@Component({
  selector: 'app-finanzas-dashboard',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, PagosComponent],
  templateUrl: './finanzas-dashboard.component.html',
  styleUrls: ['./finanzas-dashboard.component.css'],
})
export class FinanzasDashboardComponent implements OnInit {
  private fb = inject(FormBuilder);
  private svc = inject(PagosDashboardService);
  private pagosSrv = inject(PagosService);

  showPagoModal = false;
  modalAlumno: AlumnoModal | null = null;
  modalEstado: EstadoPago | undefined;

  get mesActual()  { return Number(this.form.value.mes); }
  get anioActual() { return Number(this.form.value.anio); }


  hoy = new Date();
  form = this.fb.group({
    anio: this.hoy.getFullYear(),
    mes: this.hoy.getMonth() + 1, // 1..12
  });

  loading = signal(false);
  errorMsg = signal<string | null>(null);

  resumen = signal<ResumenMensual | null>(null);
  deudores = signal<DeudoresResp | null>(null);

  // mini helpers
  mesAnioLabel = computed(() => {
    const m = this.form.value.mes as number;
    const a = this.form.value.anio as number;
    return `${m.toString().padStart(2,'0')}/${a}`;
  });

  ngOnInit() {
    this.cargarTodo();
    this.form.valueChanges.subscribe(() => this.cargarTodo());
  }

  cargarTodo() {
    this.loading.set(true);
    this.errorMsg.set(null);

    const anio = this.anioActual;
    const mes  = this.mesActual;

    forkJoin({
      resumen: this.pagosSrv.resumen(mes, anio),  // 👈 usa PagosService
      deudores: this.svc.getDeudores(anio, mes),
    }).subscribe({
      next: ({ resumen, deudores }) => {
        this.resumen.set(resumen);
        this.deudores.set(deudores);
        this.loading.set(false);
      },
      error: (err) => {
        console.error(err);
        this.errorMsg.set('No se pudieron cargar los datos del dashboard.');
        this.loading.set(false);
      }
    });
  }


  /** Abre el mismo modal de pagos que en Listar Alumnos, adaptando el item de deudor. */
  abrirPagoDesdeDeudor(i: DeudorVM) {       // 👈 tipamos bien el ítem
    const [nombre, ...rest] = (i.alumno || '').trim().split(' ');
    const apellido = rest.join(' ') || '';

    const alumno: AlumnoModal = {
      id: i.userId,
      nombre,
      apellido,
      dni: '',                               // defaults para cumplir el tipo
      telefono: i.contactos.telefono ?? '',
      email: i.contactos.email ?? '',
      nivel: 'General',
      activo: true,
      planMensual: i.plan,
    };

    this.pagosSrv.estado(i.userId, this.mesActual, this.anioActual).subscribe(est => {
      this.modalAlumno = { ...alumno, _pagoMesActual: est };
      this.modalEstado = est;
      this.showPagoModal = true;
    });
  }


  cerrarModal() {
    this.showPagoModal = false;
    this.modalAlumno = null;
    this.modalEstado = undefined;
  }

  /** Confirmar (crear/editar) pago desde el modal */
  confirmarPago(evt: UpsertPago) {
    this.pagosSrv.confirmar(evt).subscribe({
      next: () => {
        // refresco: reconsulto tablero + cierro modal
        this.cargarTodo();
        this.cerrarModal();
      },
      error: () => {
        this.errorMsg.set('Error al registrar el pago.');
      }
    });
  }

  /** Eliminar pago del mes/año desde el modal */
  eliminarPago(evt: { userId:number; mes:number; anio:number }) {
    this.pagosSrv.eliminar(evt.userId, evt.mes, evt.anio).subscribe({
      next: () => {
        this.cargarTodo();
        this.cerrarModal();
      },
      error: () => {
        this.errorMsg.set('Error al eliminar el pago.');
      }
    });
  }

}
