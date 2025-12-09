import { Component, OnInit } from '@angular/core';
import { FormBuilder, Validators, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { AusenciaProfe, ClasesSuspendidasService, TipoAusencia } from '../../services/clases-suspendidas.service';

@Component({
  selector: 'app-clases-suspendidas',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './clases-suspendidas.component.html',
  styleUrls: ['./clases-suspendidas.component.css']
})
export class ClasesSuspendidasComponent implements OnInit {

  hoyISO = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  cargando = false;
  ausencias: AusenciaProfe[] = [];
  modalEliminarAbierto = false;
  ausenciaSeleccionada?: AusenciaProfe;

  tipos: { value: TipoAusencia; label: string }[] = [
    { value: 'dia',     label: 'Todo el día' },
    { value: 'manana',  label: 'Mañana' },
    { value: 'tarde',   label: 'Tarde' },
    { value: 'horario', label: 'Horario puntual' },
  ];
  readonly HORAS_VALIDAS: string[] = [
    '08:00','09:00','10:00','11:00',
    '15:00','16:00','17:00','18:00','19:00','20:00'
  ];

  // la creamos después, en ngOnInit
  form!: FormGroup;

// rango: hoy a +7 días (ajustá a tu flujo)
 rango: { desde: string, hasta: string } = (() => {
    const fechaHasta = new Date();
    fechaHasta.setDate(fechaHasta.getDate() + 7);
    return {
    desde: this.hoyISO,
    hasta: fechaHasta.toISOString().slice(0, 10),
    };
    })();

  constructor(private fb: FormBuilder, private api: ClasesSuspendidasService) {}

  ngOnInit(): void {
    this.form = this.fb.group({
      fecha: [this.hoyISO, [Validators.required]],
      tipo: ['dia' as TipoAusencia, [Validators.required]],
      hora: [''],   // si tipo = 'horario', la completamos con una de las válidas
      motivo: [''],
    });

    // cuando cambia el tipo, limpiamos o preseleccionamos la primera hora válida
    this.form.get('tipo')?.valueChanges.subscribe(t => {
      if (t !== 'horario') {
        this.form.get('hora')?.setValue('');
      } else if (!this.form.value.hora) {
        this.form.get('hora')?.setValue(this.HORAS_VALIDAS[0]);
      }
    });

    this.cargar();
  }

  get tipo() { return this.form.value.tipo as TipoAusencia; }

  labelTipo(tipo: TipoAusencia | null | undefined): string {
    if (!tipo) return '';
    const found = this.tipos.find(t => t.value === tipo);
    return found ? found.label : String(tipo);
  }

  private validarHora(): boolean {
    if (this.tipo !== 'horario') return true;
    const h = (this.form.value.hora || '').trim();
    return this.HORAS_VALIDAS.includes(h);  // ✅ solo aceptamos las horas definidas
  }

  async cargar() {
    this.cargando = true;
    console.log('GET /feriados/ausencias-profe', this.rango.desde, this.rango.hasta);
    this.api.listar(this.rango.desde, this.rango.hasta).subscribe({
      next: (ausencias: AusenciaProfe[]) => {
        this.ausencias = ausencias;
        this.cargando = false;
      },
      error: (err) => {
        console.error('⚠️ No se pudieron cargar ausencias', err);
        this.ausencias = []; 
        this.cargando = false;
      }
    });
  }

  guardar() {
    if (this.form.invalid || !this.validarHora()) {
      this.form.markAllAsTouched();
      return;
    }
    const { fecha, tipo, hora, motivo } = this.form.value;
    this.api.crear({ fecha: fecha!, tipo: tipo!, hora: hora || undefined, motivo: motivo || undefined })
      .subscribe(() => {
        this.cargar();
      });
  }

  borrar(a: AusenciaProfe) {
    if (!confirm('¿Eliminar esta clase suspendida?')) return;
    this.api.eliminar(a.id).subscribe(() => this.cargar());
  }

  // opcional: cambiar rango de consulta
  actualizarRango(d: HTMLInputElement, h: HTMLInputElement) {
    this.rango.desde = d.value || this.rango.desde;
    this.rango.hasta = h.value || this.rango.hasta;
    this.cargar();
  }

  abrirModalEliminar(a: AusenciaProfe) {
    this.ausenciaSeleccionada = a;
    this.modalEliminarAbierto = true;
  }

  cerrarModalEliminar() {
    this.modalEliminarAbierto = false;
    this.ausenciaSeleccionada = undefined;
  }

  confirmarEliminar() {
    if (!this.ausenciaSeleccionada) return;
    this.api.eliminar(this.ausenciaSeleccionada.id).subscribe(() => {
      this.cargar();
      this.cerrarModalEliminar();
    });
  }
}
