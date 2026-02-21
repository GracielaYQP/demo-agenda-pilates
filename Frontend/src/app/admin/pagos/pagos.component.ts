import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subscription, take } from 'rxjs';
import { EstadoPago, UpsertPago, MetodoPago } from '../../services/pagos.service';
import { ValorPlanVM, ValorPlanesService, PlanTipo } from '../../services/valor-planes.service';
      

export interface Alumno {
  id: number;
  nombre: string;
  apellido: string;
  dni: string;
  telefono: string;
  email: string;
  nivel: string;
  planMensual: string; // 'suelta' | '4' | '8' | '12'
  activo: boolean;
  _pagoMesActual?: EstadoPago;
}

@Component({
  selector: 'app-pagos',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './pagos.component.html',
  styleUrls: ['./pagos.component.css']
})
export class PagosComponent implements OnChanges, OnDestroy {
  @Input() alumno!: Alumno;
  @Input() estado!: EstadoPago | undefined;
  @Input() mes!: number;
  @Input() anio!: number;

  @Output() confirmar = new EventEmitter<UpsertPago>();
  @Output() eliminar = new EventEmitter<{ pagoId: number; userId: number }>();
  @Output() cerrar = new EventEmitter<void>();

  form!: FormGroup;
  modoEdicion = false;

  private planSub?: Subscription;
  private planes: ValorPlanVM[] = []; // 👈 cache local de precios

  constructor(
    private fb: FormBuilder,
    private valorSrv: ValorPlanesService, // 👈 usamos tu servicio
  ) {}

  ngOnChanges(_: SimpleChanges): void {
    const planUsuario = this.normalizarPlan(this.alumno?.planMensual) || '4';

    // Si ya está pago y NO está en edición -> se muestra el detalle (tu HTML ya lo hace)
    // Si entra en edición o si NO está pago -> armamos form con plan/monto bloqueados.
    const montoExistente = this.estado?.pago?.montoARS ?? null;
    const planExistente = this.estado?.pago?.planTipo ?? planUsuario;

    this.form = this.fb.group({
      planTipo: [{ value: planExistente, disabled: true }, Validators.required],
      montoARS: [{ value: montoExistente, disabled: true }, [Validators.required, Validators.min(0)]],
      metodo: [this.estado?.pago?.metodo || 'efectivo' as MetodoPago],
      notas: [this.estado?.pago?.notas || '']
    });

    this.modoEdicion = false;

    // Si NO está pago, precargamos el monto desde valor-planes
    if (!this.estado?.isPago) {
      if (this.planes.length === 0) {
        this.valorSrv.getPublic().pipe(take(1)).subscribe({
          next: (planes) => {
            this.planes = planes ?? [];
            if (montoExistente === null) {
              this.setPrecioSugerido(planUsuario);
            }
          }
        });
      } else if (montoExistente === null) {
        this.setPrecioSugerido(planUsuario);
      }
    }

    // Si está pago y tocan "Editar": solo podrán cambiar método y notas;
    // plan/monto siguen deshabilitados. 
  }

  ngOnDestroy(): void {
    this.planSub?.unsubscribe();
  }

  get titulo(): string {
    return `Pago de ${this.alumno?.apellido ?? ''} ${this.alumno?.nombre ?? ''}`.trim();
  }

  onConfirmar() {
    if (this.form.invalid) return;

    // Incluye los disabled (plan/monto)
    const raw = this.form.getRawValue();

    this.confirmar.emit({
      userId: this.alumno.id,
      planTipo: raw.planTipo as PlanTipo,
      montoARS: +raw.montoARS,
      metodo: raw.metodo,
      notas: raw.notas
    });
  }

  onEliminar() {
    const pagoId = this.estado?.pago?.id;
    if (!pagoId) return; // o mostrás mensaje
    this.eliminar.emit({ pagoId, userId: this.alumno.id });

  }

  // --- Helpers ---

  /** Normaliza a 'suelta'|'4'|'8'|'12' si viniera con mayúsculas o espacios */
  private normalizarPlan(p: string | undefined | null): PlanTipo | null {
    if (!p) return null;
    const s = String(p).toLowerCase().trim();
    if (s === 'suelta' || s === '4' || s === '8' || s === '12') return s as PlanTipo;
    return null;
  }

  /** Busca el precio sugerido para el plan y lo setea en el form (editable por el usuario) */
  private setPrecioSugerido(tipo: PlanTipo) {
    if (!tipo) return;
    const match = this.planes.find(p => p.tipo === tipo);
    if (match && typeof match.precioARS === 'number' && match.precioARS >= 0) {
      this.form.get('montoARS')!.setValue(match.precioARS, { emitEvent: false });
    }
  }

}

