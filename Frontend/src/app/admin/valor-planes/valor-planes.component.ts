import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ValorPlanesService, ValorPlanVM } from '../../services/valor-planes.service';


@Component({
  selector: 'app-valor-planes',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './valor-planes.component.html',
  styleUrls: ['./valor-planes.component.css']
})
export class ValorPlanesComponent implements OnInit {
  form!: FormGroup;
  token = localStorage.getItem('token') || '';
  modalVisible: boolean = false;
  mensajeModal: string = '';
  esError: boolean = false;

  constructor(
    private fb: FormBuilder, 
    private valorSrv: ValorPlanesService,  
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit() {
    this.form = this.fb.group({
      suelta_precio: [0],
      cuatro_precio: [0],
      ocho_precio: [0],
      doce_precio: [0],
    });

    this.valorSrv.getAllAdmin(this.token).subscribe(rows => {
      const byTipo = Object.fromEntries(rows.map(r => [r.tipo, r]));
      this.form.patchValue({
        suelta_precio: byTipo['suelta']?.precioARS ?? 0,
        cuatro_precio: byTipo['4']?.precioARS ?? 0,
        ocho_precio: byTipo['8']?.precioARS ?? 0,
        doce_precio: byTipo['12']?.precioARS ?? 0,
      });
    });
  }

  guardar() {
    const v = this.form.value as any;
    const payloads: ValorPlanVM[] = [
      { tipo: 'suelta', precioARS: +v.suelta_precio, visible: true },
      { tipo: '4', precioARS: +v.cuatro_precio, visible: true },
      { tipo: '8', precioARS: +v.ocho_precio, visible: true },
      { tipo: '12', precioARS: +v.doce_precio, visible: true },
    ];

    let ok = true; // asumimos que todo sale bien

    payloads.forEach(p => {
      this.valorSrv.upsert(p, this.token).subscribe({
        error: (err) => {
          ok = false;
          this.mensajeModal = '❌ Error al guardar: ' + (err.error?.message || err.message);
          this.esError = true;
          this.modalVisible = true;
          setTimeout(() => this.modalVisible = false, 3000);
        }
      });
    });

    if (ok) {
      this.mensajeModal = '✅ Valores guardados correctamente';
      this.esError = false;
      this.modalVisible = true;
      setTimeout(() => {
        this.modalVisible = false;
      }, 3000);
    }
  }

  cerrarFormulario() {
    this.router.navigate(['/horarios-disponibles']);
  }
}

