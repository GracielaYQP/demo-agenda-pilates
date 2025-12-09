import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder } from '@angular/forms';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '@env/environment';

type AlumnosAsistenciaVM = {
  anio: number; mes: number;
  alumnosActivos: number;
  asistenciaPromedioPct: number;        // 0..100
  cancelaciones: number;
  recuperaciones: number;
  nuevosAlumnos: number;
  rankingTop5: Array<{ alumno: string; pct: number }>;
};

@Component({
  selector: 'app-alumnos-asistencia',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './alumnos-asistencia.component.html',
  styleUrls: ['./alumnos-asistencia.component.css']
})
export class AlumnosAsistenciaComponent implements OnInit {
  private fb = inject(FormBuilder);
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  hoy = new Date();
  form = this.fb.group({
    anio: this.hoy.getFullYear(),
    mes: this.hoy.getMonth() + 1,
  });

  loading = signal(false);
  data = signal<AlumnosAsistenciaVM | null>(null);
  error = signal<string | null>(null);

  ngOnInit() {
    this.fetch();
    this.form.valueChanges.subscribe(() => this.fetch());
  }

  fetch() {
    this.loading.set(true);
    this.error.set(null);

    const p = new HttpParams()
      .set('anio', String(this.form.value.anio!))
      .set('mes', String(this.form.value.mes!));

    this.http.get<any>(`${this.api}/dashboard/alumnos-asistencia`, { params: p })
      .subscribe({
        next: (d: any) => {
          const top5 = (d?.rankingTop5 ?? []).map((x: any, i: number) => ({
            alumno:
              x.alumno ??
              x.nombreCompleto ??
              (x.apellido && x.nombre ? `${x.apellido} ${x.nombre}` : `—`),
            pct: Number(x.pct ?? x.porcentaje ?? 0),
          }));

          const vm: AlumnosAsistenciaVM = {
            anio: Number(d?.anio ?? this.form.value.anio!),
            mes: Number(d?.mes ?? this.form.value.mes!),
            alumnosActivos: Number(d?.alumnosActivos ?? 0),
            asistenciaPromedioPct: Number(d?.asistenciaPromedioPct ?? d?.asistenciaPromedio ?? 0),
            cancelaciones: Number(d?.cancelaciones ?? 0),
            recuperaciones: Number(d?.recuperaciones ?? 0),
            nuevosAlumnos: Number(d?.nuevosAlumnos ?? 0),
            rankingTop5: top5,
          };

          this.data.set(vm);
          this.loading.set(false);
        },
        error: (e) => {
          console.error(e);
          this.error.set('No se pudo cargar Alumnos y Asistencia.');
          this.loading.set(false);
        }
      });
  }

}
