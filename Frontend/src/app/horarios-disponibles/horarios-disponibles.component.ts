import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { HorariosService } from '../services/horarios.service';
import { HorarioSemana } from '../interfaces/horario-semana.interface';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

type TipoAusencia = 'dia' | 'manana' | 'tarde' | 'horario';

@Component({
  selector: 'app-horarios-disponibles',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './horarios-disponibles.component.html',
  styleUrls: ['./horarios-disponibles.component.css']
})
export class HorariosDisponiblesComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  horarios: any[] = [];
  nivelHorarios: any[] = [];
  dias: string[] = ['Lunes','Martes','Miércoles','Jueves','Viernes'];
  horas: string[] = ['08:00','09:00','10:00','11:00','15:00','16:00','17:00','18:00'];
  usuarioNivel = '';
  mostrarMensajeActualizacion = false;

  ausenciasPorFecha = new Map<string, { fecha: string; tipo: TipoAusencia; hora?: string }[]>();

  // índice reservas
  private reservasPorFecha = new Map<string, number>();
  private key(horarioId: number, fechaYMD: string) { return `${horarioId}|${fechaYMD}`; }
  private ocupadasEn(id: number, fechaYMD: string): number {
  if (!this.reservasPorFecha) return 0;

  const key=this.key(id, fechaYMD);
  const ocupadas = this.reservasPorFecha.get (key) || 0; 
  return ocupadas;
  }

  // 👉 Funciones que debes usar para actualizar el Map correctamente:
  private incrementarReservasPorFecha(horarioId: number, fechaYMD: string): void {
    const key = this.key(horarioId, fechaYMD);
    const actuales = this.reservasPorFecha.get(key) || 0;
    this.reservasPorFecha.set(key, actuales + 1);
  }

  private decrementarReservasPorFecha(horarioId: number, fechaYMD: string): void {
    const key = this.key(horarioId, fechaYMD);
    const actuales = this.reservasPorFecha.get(key) || 0;
    this.reservasPorFecha.set(key, Math.max(0, actuales - 1));
  }


  constructor(private router: Router, private horariosService: HorariosService) {
    this.usuarioNivel = localStorage.getItem('nivelUsuario') || '';
  }

  nivelCss(nivel: string) {
    return (nivel || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '-');
  }

    ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // === Cálculos unificados ===

  ngOnInit(): void {

    // ✅ 0) ausencias$: UNA sola suscripción viva (no adentro de horarios$)
    this.horariosService.ausencias$
      .pipe(takeUntil(this.destroy$))
      .subscribe(mapYMD => {
        const nuevo = new Map<string, { fecha: string; tipo: TipoAusencia; hora?: string }[]>();
        for (const [ymd, lista] of mapYMD.entries()) {
          const key = this.formatearFecha(ymd); // dd/MM/yyyy
          nuevo.set(key, (lista || []).map(a => ({ fecha: key, tipo: a.tipo, hora: a.hora })));
        }
        this.ausenciasPorFecha = nuevo;
      });

    // ✅ 1) Escucho SIEMPRE el stream del service (con takeUntil)
    this.horariosService.horarios$
      .pipe(takeUntil(this.destroy$))
      .subscribe((data) => {
        const horarios = (data || []) as HorarioSemana[];

        this.horarios = horarios;

        // días con fecha visibles (orden L→V)
        const ordenDias = ['Lunes','Martes','Miércoles','Jueves','Viernes'];
        const diasUnicos = Array.from(
          new Set(horarios.map(h => `${h.dia} ${this.formatearFecha(h.fecha)}`))
        );
        this.dias = ordenDias
          .map(d => diasUnicos.find(x => x?.startsWith(d)))
          .filter(Boolean) as string[];

        // horas
        this.horas = Array.from(new Set(horarios.map(h => h.hora)))
          .sort((a,b) => parseInt(a) - parseInt(b));

        // por nivel del usuario (si corresponde)
        this.usuarioNivel = localStorage.getItem('nivelUsuario') || '';
        this.nivelHorarios = this.usuarioNivel
          ? horarios.filter(h => (h.nivel || '').toLowerCase() === this.usuarioNivel.toLowerCase())
          : horarios;

        // rango visible para ausencias + reservas índice
        const fechasYMD = (horarios.map(h => h.fecha).filter(Boolean) as string[]).sort();
        if (fechasYMD.length > 0) {
          const desdeYMD = fechasYMD[0];
          const hastaYMD = fechasYMD[fechasYMD.length - 1];

          // ✅ Trigger de carga (no suscripción extra a ausencias$ acá)
          this.horariosService.cargarAusencias(desdeYMD, hastaYMD)
            .pipe(takeUntil(this.destroy$))
            .subscribe();

          // ÍNDICE simple de reservas no canceladas (fallback/controles)
          this.horariosService.getReservasDeLaSemana(desdeYMD, hastaYMD)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
              next: rows => {
                this.reservasPorFecha.clear();
                for (const r of rows) {
                  if ((r as any).cancelada) continue;
                  const hId   = Number((r as any).horarioId);
                  const fecha = String((r as any).fechaTurno || '').slice(0,10);
                  if (!Number.isFinite(hId) || !fecha) continue;
                  const k = this.key(hId, fecha);
                  this.reservasPorFecha.set(k, (this.reservasPorFecha.get(k) || 0) + 1);
                }
              },
              error: () => this.reservasPorFecha.clear()
            });
        } else {
          // si no hay fechas, limpio
          this.reservasPorFecha.clear();
        }

        this.mostrarMensajeTemporal();
      });

    // ✅ 2) Cuando algo cambie, recargo del back (con takeUntil)
    this.horariosService.reservasChanged$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.horariosService.cargarHorarios();
      });

    // ✅ 3) Primer snapshot
    this.horariosService.cargarHorarios();
  }

  getDisponibles(diaConFecha: string, hora: string, nivel: string): number {
    const [dia, ddmmyyyy] = diaConFecha.split(' ');
    const turno = this.horarios.find(h =>
      h.dia === dia &&
      this.formatearFecha(h.fecha) === ddmmyyyy &&
      h.hora === hora &&
      (h.nivel || '').toLowerCase() === (nivel || '').toLowerCase()
    );
    if (!turno) return 0;

    const total      = Number((turno as any).totalReformers ?? 5);
    const bloqueados = Math.max(0, Number((turno as any).blockedReformers ?? 0));

    const reservadosFromBack = Number((turno as any).reformersReservados ?? NaN);
    if (Number.isFinite(reservadosFromBack)) {
      return Math.max(0, total - reservadosFromBack - bloqueados);
    }

    const id       = Number((turno as any).id ?? (turno as any).idHorario);
    const fechaYMD = String((turno as any).fecha || '');
    const ocupadas = this.ocupadasEn(id, fechaYMD);

    return Math.max(0, total - ocupadas - bloqueados);
  }

  getDisponiblesFijo(diaConFecha: string, hora: string, nivel: string): number {
    const [dia, ddmmyyyy] = diaConFecha.split(' ');
    const turno = this.horarios.find(h =>
      h.dia === dia &&
      this.formatearFecha(h.fecha) === ddmmyyyy &&
      h.hora === hora &&
      (h.nivel || '').toLowerCase() === (nivel || '').toLowerCase()
    );
    if (!turno) return 0;

    const v = Number((turno as any).reformersFijosDisponibles ?? NaN);
    return Number.isFinite(v) ? v : 0;
  }

  isDisponible(diaConFecha: string, hora: string, nivel: string): boolean {
    if (this.estadoCierre(diaConFecha, hora) !== 'ninguno') return false;
    if (!nivel || nivel === 'No disponible') return false;
    return this.getDisponibles(diaConFecha, hora, nivel) > 0;
  }

  isClickable(diaConFecha: string, hora: string, nivel: string): boolean {
    if (this.estadoCierre(diaConFecha, hora) !== 'ninguno') return false;
    if (!nivel || nivel === 'No disponible') return false;
    return !!this.usuarioNivel
        && this.usuarioNivel.toLowerCase() === nivel.toLowerCase()
        && this.getDisponibles(diaConFecha, hora, nivel) > 0;
  }

  getNivelParaHorario(diaConFecha: string, hora: string): string {
    const [dia, ddmmyyyy] = diaConFecha.split(' ');
    const t = this.horarios.find(h =>
      h.dia === dia && this.formatearFecha(h.fecha) === ddmmyyyy && h.hora === hora
    );
    return t ? t.nivel : 'No disponible';
  }

  reservar(diaConFecha: string, hora: string, nivel: string) {
    if (this.estadoCierre(diaConFecha, hora) !== 'ninguno') return;
    if (!nivel || nivel === 'No disponible') return;
    const [dia, fecha] = diaConFecha.split(' ');
    this.router.navigate(['/gestion-turnos'], { queryParams: { dia, hora, nivel, fecha } });
  }

  // === Ausencias / Cierre ===

  private esCerradoFijo(diaConFecha: string, hora: string): boolean {
    const [dia] = diaConFecha.split(' ');
    return (
      (dia === 'Miércoles' && (hora === '11:00' || hora === '15:00'|| hora === '16:00' || hora === '17:00')) ||
      (dia === 'Viernes'   && (hora === '08:00' || hora === '18:00' || hora === '19:00' || hora === '20:00')) ||
      (dia === 'Martes'    && (hora === '19:00' || hora === '20:00')) ||
      (dia === 'Jueves'    && (hora === '15:00' ||hora === '19:00' || hora === '20:00'))
    );
  }

  estadoCierre(diaConFecha: string, hora: string): 'ninguno'|'ausencia'|'cerrado_fijo' {
    if (this.esCerradoFijo(diaConFecha, hora)) return 'cerrado_fijo';
    return this.hayAusencia(diaConFecha, hora) ? 'ausencia' : 'ninguno';
  }

  hayAusencia(diaConFecha: string, hora: string): boolean {
    const [, ddmmyyyy] = diaConFecha.split(' ');
    const aus = this.ausenciasPorFecha.get(ddmmyyyy);
    if (!aus || aus.length === 0) return false;

    const toMin = (h: string) => { const [HH, MM] = h.split(':').map(Number); return HH*60+MM; };
    const m = toMin(hora);
    const MANIANA_INI = toMin('07:00'), MANIANA_FIN = toMin('13:59');
    const TARDE_INI   = toMin('14:00'), TARDE_FIN   = toMin('22:00');

    for (const a of aus) {
      if (a.tipo === 'dia') return true;
      if (a.tipo === 'horario' && a.hora?.slice(0,5) === hora.slice(0,5)) return true;
      if (a.tipo === 'manana' && m >= MANIANA_INI && m <= MANIANA_FIN)    return true;
      if (a.tipo === 'tarde'  && m >= TARDE_INI   && m <= TARDE_FIN)      return true;
    }
    return false;
  }

  // === Util ===

  mostrarMensajeTemporal() {
    this.mostrarMensajeActualizacion = true;
    setTimeout(() => { this.mostrarMensajeActualizacion = false; }, 4000);
  }

  formatearFecha(fecha: string): string {
    const d = new Date(`${fecha}T12:00:00-03:00`);
    return d.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
  }

  tieneAlgoDisponible(diaConFecha: string, hora: string, nivel: string): boolean {
    if (this.estadoCierre(diaConFecha, hora) !== 'ninguno') return false;
    if (!nivel || nivel === 'No disponible') return false;

    const libres = this.getDisponibles(diaConFecha, hora, nivel);
    const fijos  = this.getDisponiblesFijo(diaConFecha, hora, nivel);

    return (libres > 0) || (fijos > 0);
  }

  esSoloFijo(diaConFecha: string, hora: string, nivel: string): boolean {
    if (this.estadoCierre(diaConFecha, hora) !== 'ninguno') return false;
    if (!nivel || nivel === 'No disponible') return false;

    const libres = this.getDisponibles(diaConFecha, hora, nivel);
    const fijos  = this.getDisponiblesFijo(diaConFecha, hora, nivel);

    return (libres <= 0) && (fijos > 0);
  }

}
