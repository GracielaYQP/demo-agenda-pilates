import { Component, OnInit, inject, signal, computed, OnDestroy } from '@angular/core';
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
export class FinanzasDashboardComponent implements OnInit, OnDestroy {
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
    document.documentElement.classList.add('allow-x-scroll');
    document.body.classList.add('allow-x-scroll');

    this.cargarTodo();
    this.form.valueChanges.subscribe(() => this.cargarTodo());
  }

  ngOnDestroy() {
    document.documentElement.classList.remove('allow-x-scroll');
    document.body.classList.remove('allow-x-scroll');
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

    this.pagosSrv.estado(i.userId).subscribe(est => {
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
    this.pagosSrv.confirmarCiclo(evt).subscribe({
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
  eliminarPago(evt: { pagoId: number; userId: number }) {
    this.pagosSrv.eliminarPorId(evt.pagoId).subscribe({
      next: () => {
        this.cargarTodo();
        this.cerrarModal();
      },
      error: () => {
        this.errorMsg.set('Error al eliminar el pago.');
      }
    });
  }

  deudoresOrdenados(items: any[] | null | undefined) {
    const arr = [...(items || [])];

    arr.sort((a, b) => {
      const A = this.parseApellidoNombre(a?.alumno || `${a?.apellido || ''} ${a?.nombre || ''}`);
      const B = this.parseApellidoNombre(b?.alumno || `${b?.apellido || ''} ${b?.nombre || ''}`);

      const byApellido = A.apellido.localeCompare(B.apellido, 'es', { sensitivity: 'base' });
      if (byApellido !== 0) return byApellido;

      return A.nombre.localeCompare(B.nombre, 'es', { sensitivity: 'base' });
    });

    return arr;
  }

  private parseApellidoNombre(alumno: string): { apellido: string; nombre: string } {
    const s = (alumno || '').toString().trim();

    // Caso ideal: "Apellido, Nombre"
    if (s.includes(',')) {
      const [ap, nom] = s.split(',').map(x => x.trim());
      return { apellido: ap || '', nombre: nom || '' };
    }

    // Caso frecuente: "Nombre Apellido" o "Nombre Segundo Apellido"
    // Regla práctica: tomamos la ÚLTIMA palabra como apellido y el resto como nombre
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const apellido = parts.pop() || '';
      const nombre = parts.join(' ');
      return { apellido, nombre };
    }

    // Caso raro: solo 1 palabra
    return { apellido: s, nombre: '' };
  }

  nombreFormato(i: any): string {
    const ap = (i?.apellido || '').toString().trim();
    const nom = (i?.nombre || '').toString().trim();

    // Si ya vienen separados, usalos
    if (ap || nom) return `${ap}${ap && nom ? ', ' : ''}${nom}`;

    // Si no, parseá desde alumno
    const parsed = this.parseApellidoNombre((i?.alumno || '').toString());
    return `${parsed.apellido}${parsed.apellido && parsed.nombre ? ', ' : ''}${parsed.nombre}`;
  }

  private overrideNombre: Record<number, { apellido: string; nombre: string }> = {
  
    69: { apellido: 'Cernades Allende', nombre: 'Marianel' },
    28: { apellido: 'Di Martino', nombre: 'Pina' },
  };

  nombreDeudor(i: DeudorVM): string {
    // 1) Overrides (casos especiales) — prioridad total
    const ov = this.overrideNombre[i.userId];
    if (ov) return `${ov.apellido}, ${ov.nombre}`;

    const s = (i.alumno || '').toString().trim();
    if (!s) return '';

    // 2) Si ya viene "Apellido, Nombre" lo dejamos tal cual
    if (s.includes(',')) return s;

    // 3) Si viene "Nombre Apellido" -> lo pasamos a "Apellido, Nombre"
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0];

    const apellido = parts.pop()!;        // última palabra
    const nombre = parts.join(' ');
    return `${apellido}, ${nombre}`;
  }


}
