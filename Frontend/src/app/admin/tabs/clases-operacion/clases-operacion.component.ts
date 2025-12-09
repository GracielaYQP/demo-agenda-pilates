import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder } from '@angular/forms';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '@env/environment';

type ClasesOperacionVM = {
  anio:number; mes:number;
  clasesDictadas: number;
  tasaOcupacionPct: number;           // 0..100
  capacidadLibrePerdida: number;      // camas/día perdidas
  topHorarios: Array<{ label: string; ocupacionPct: number }>;
  // futuro: por profesor
  // porProfesor?: Array<{ profesor: string; clases: number }>;
};

@Component({
  selector: 'app-clases-operacion',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './clases-operacion.component.html',
  styleUrls: ['./clases-operacion.component.css']
})
export class ClasesOperacionComponent implements OnInit {
  private fb = inject(FormBuilder);
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  hoy = new Date();
  form = this.fb.group({
    anio: this.hoy.getFullYear(),
    mes: this.hoy.getMonth() + 1,
  });

  loading = signal(false);
  data = signal<ClasesOperacionVM | null>(null);
  error = signal<string | null>(null);

  ngOnInit(){ this.fetch(); this.form.valueChanges.subscribe(()=>this.fetch()); }

  fetch(){
    this.loading.set(true); this.error.set(null);
    const p = new HttpParams().set('anio', this.form.value.anio!).set('mes', this.form.value.mes!);
    this.http.get<ClasesOperacionVM>(`${this.api}/dashboard/clases-operacion`, { params: p })
      .subscribe({
        next: d => { this.data.set(d); this.loading.set(false); },
        error: e => { console.error(e); this.error.set('No se pudo cargar Clases y Operación.'); this.loading.set(false); }
      });
  }
}

