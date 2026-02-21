import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HorariosService } from '../services/horarios.service';
import { ActivatedRoute } from '@angular/router';
import { FormsModule, FormControl, ReactiveFormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { HorarioSemana } from '../interfaces/horario-semana.interface';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

type TipoAusencia = 'dia' | 'manana' | 'tarde' | 'horario';

@Component({
  selector: 'app-gestion-turnos',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './gestion-turnos.component.html',
  styleUrls: ['./gestion-turnos.component.css'],
})
export class GestionTurnosComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  usuarioNivel = '';
  dias: string[] = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
  horas: string[] = ['08:00','09:00','10:00','11:00','15:00','16:00','17:00','18:00'];
  horarios: any[] = [];
  rolUsuario = '';

  modalAbierto = false;
  turnoSeleccionado: any = null;

  // admin add
  mostrarFormAgregar = false;
  modalConfirmacionFinalAbierta = false;
  formMsg = '';
  formIsError = false;

  // admin cancel
  mostrarModalTipoCancelacion = false;
  mostrarModalConfirmarAccion = false;
  tipoCancelacionSeleccionado: 'momentanea'|'permanente' = 'momentanea';
  textoConfirmacion = '';
  reservaSeleccionada: any = null;

  // alumno
  modalAlumnoAbierto = false;
  nombreUsuario = '';
  apellidoUsuario = '';
  reservaAutomatica = true;
  tipoReserva: 'automatica'|'recuperacion'|'suelta' = 'automatica';
  mensajeBloqueoRecuperacion = '';
  uiBloqueadoAlumno = false;
  mostrarConfirmacion = false;
  mensajeReserva = '';
  esErrorReserva = false;
  filtroAlumno: string = '';

  // admin add - búsqueda
  alumnos: any[] = [];
  alumnosOrdenados: any[] = [];
  alumnosFiltrados: any[] = [];
  buscarAlumnoCtrl = new FormControl('');
  usuarioSeleccionado: any = null;
  usuarioSeleccionadoId: number | null = null;
  busquedaModo: 'nombre-apellido'|'telefono' = 'nombre-apellido';
  telefonoNuevo = '';

  // admin feedback
  mensajeAdminReserva = '';
  mostrarConfirmacionAdmin = false;
  esErrorAdmin = false;

  // ✅ alerta turno pasado
  modalAlertaPasadoAbierto = false;
  modalAlertaPasadoMsg = '';

  // ausencias (dd/mm/yyyy -> lista)
  ausenciasPorFecha = new Map<string, { fecha: string; tipo: TipoAusencia; hora?: string }[]>();

  // índice reservas: (horarioId|fechaYMD) -> ocupadas
  private reservasPorFecha = new Map<string, number>();
  private reservasFijasPorFecha = new Map<string, number>();
  private key(horarioId: number, fechaYMD: string) { return `${horarioId}|${fechaYMD}`; }
  ocupadasEn(horarioId: number, fechaYMD: string): number {
    return this.reservasPorFecha.get(this.key(horarioId, fechaYMD)) || 0;
  }
  public readonly max = Math.max;

  constructor(
    private horariosService: HorariosService,
    private route: ActivatedRoute,
    private http: HttpClient
  ) {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  nivelCss(nivel: string) {
    return (nivel || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '-');
  }

  // ✅ Parser robusto (evita issues de timezone/strings)
  private parseFechaHoraLocal(fechaYMD: string, horaHHmm: string): Date | null {
    try {
      const [y, m, d] = String(fechaYMD || '').slice(0, 10).split('-').map(n => parseInt(n, 10));
      const [HH, MM] = String(horaHHmm || '').slice(0, 5).split(':').map(n => parseInt(n, 10));
      if (!y || !m || !d || !Number.isFinite(HH) || !Number.isFinite(MM)) return null;
      return new Date(y, m - 1, d, HH, MM, 0, 0); // local time
    } catch {
      return null;
    }
  }

  private minutosHastaTurno(fechaYMD: string, horaHHmm: string): number {
    const turno = this.parseFechaHoraLocal(fechaYMD, horaHHmm);
    if (!turno) return -999999;
    const ahora = new Date();
    return Math.floor((turno.getTime() - ahora.getTime()) / 60000);
  }

  private esTurnoPasado(fechaYMD: string, horaHHmm: string): boolean {
    const diffMin = this.minutosHastaTurno(fechaYMD, horaHHmm);
    return diffMin < 0; // ya pasó
  }

  private cerrarTodosLosModales() {
    this.modalAbierto = false;
    this.mostrarFormAgregar = false;
    this.modalConfirmacionFinalAbierta = false;

    this.mostrarModalTipoCancelacion = false;
    this.mostrarModalConfirmarAccion = false;

    this.modalAlumnoAbierto = false;

    // reseteos
    this.turnoSeleccionado = null;
    this.reservaSeleccionada = null;

    this.formMsg = '';
    this.formIsError = false;

    this.mensajeReserva = '';
    this.esErrorReserva = false;
    this.mostrarConfirmacion = false;

    document.body.classList.remove('modal-open');
  }

  private abrirAlertaPasado(msg: string) {
    this.cerrarTodosLosModales();
    this.modalAlertaPasadoMsg = msg;
    this.modalAlertaPasadoAbierto = true;
  }

  cerrarAlertaPasado() {
    this.modalAlertaPasadoAbierto = false;
    this.modalAlertaPasadoMsg = '';
    this.refrescarHorarios();
  }

  formatearFecha(fecha: string): string {
    const d = new Date(`${fecha}T12:00:00-03:00`);
    return d.toLocaleDateString('es-AR');
  }

  ngOnInit() {
    const nivelGuardado = localStorage.getItem('nivelUsuario');
    const rolGuardado = localStorage.getItem('rol');
    if (!nivelGuardado || !rolGuardado) {
      console.error('❌ Nivel o rol de usuario no encontrado.');
      return;
    }
    this.usuarioNivel = nivelGuardado.trim();
    this.rolUsuario = rolGuardado.trim().toLowerCase();

    // ✅ 1) SUBSCRIBE UNA SOLA VEZ a ausencias$ (evita duplicación)
    this.horariosService.ausencias$
      .pipe(takeUntil(this.destroy$))
      .subscribe(mapYMD => {
        const nuevo = new Map<string, { fecha: string; tipo: TipoAusencia; hora?: string }[]>();
        for (const [ymd, lista] of mapYMD.entries()) {
          const key = this.formatearFecha(ymd);
          nuevo.set(key, (lista || []).map(a => ({ fecha: key, tipo: a.tipo, hora: a.hora })));
        }
        this.ausenciasPorFecha = nuevo;
      });

    // ✅ 2) Fuente única: horarios$
    this.horariosService.horarios$
      .pipe(takeUntil(this.destroy$))
      .subscribe((data) => {
        // normalizo ids de reservas
        (data || []).forEach(horario => {
          if (!horario.idHorario) return;
          if (Array.isArray(horario.reservas)) {
            horario.reservas.forEach((r: any) => {
              if (typeof r.id !== 'number') {
                if (typeof r.idReserva === 'number') r.id = r.idReserva;
                else if (typeof r.reservaId === 'number') r.id = r.reservaId;
              }
              if (typeof r.id !== 'number') {
                const nombre = (r.nombre || 'NN').trim();
                const apellido = (r.apellido || 'SN').trim();
                r._visualId = `${horario.idHorario}_${nombre}_${apellido}`.replace(/\s/g, '');
              }
            });
          }
        });

        this.horarios = (data || []).map(h => {
          const id = Number(h.id ?? h.idHorario ?? (h as any).id_horario);
          if (!Number.isFinite(id)) console.warn('⚠️ Horario sin ID válido:', h);
          return { ...h, id, idHorario: id };
        }) as any[];

        // headers de tabla
        const diasUnicos = Array.from(new Set(
          this.horarios.map(h => `${h.dia} ${this.formatearFecha(h.fecha)}`)
        ));
        const ordenDias = ['Lunes','Martes','Miércoles','Jueves','Viernes'];
        this.dias = ordenDias.map(d => diasUnicos.find(x => x?.startsWith(d))).filter(Boolean) as string[];

        this.horas = Array.from(new Set(this.horarios.map(h => h.hora)))
          .sort((a, b) => parseInt(a) - parseInt(b));

        // rango visible → pedir ausencias + índice liviano reservas
        const fechasYMD = (this.horarios.map(h => h.fecha).filter(Boolean) as string[]).sort();
        if (fechasYMD.length > 0) {
          const desdeYMD = fechasYMD[0];
          const hastaYMD = fechasYMD[fechasYMD.length - 1];

          this.horariosService.cargarAusencias(desdeYMD, hastaYMD).subscribe();

          this.horariosService.getReservasDeLaSemana(desdeYMD, hastaYMD).subscribe({
            next: (rows: any[]) => {
              this.reservasPorFecha.clear();
              this.reservasFijasPorFecha.clear();

              for (const r of rows || []) {
                const estado = String((r as any).estado || '').toLowerCase();
                const cancelada = (r as any).cancelada === true || estado === 'cancelada' || estado === 'cancelado';
                if (cancelada) continue;

                const hId   = Number((r as any).horarioId);
                const fecha = String((r as any).fechaTurno || '').slice(0,10);
                if (!Number.isFinite(hId) || !fecha) continue;

                const k = this.key(hId, fecha);

                // A) contador “hoy”
                this.reservasPorFecha.set(k, (this.reservasPorFecha.get(k) || 0) + 1);

                // B) contador “fijas”
                const tipo = String((r as any).tipo || '').toLowerCase();
                if (tipo === 'automatica') {
                  this.reservasFijasPorFecha.set(k, (this.reservasFijasPorFecha.get(k) || 0) + 1);
                }
              }
            },
            error: () => {
              this.reservasPorFecha.clear();
              this.reservasFijasPorFecha.clear();
            }
          });
        }
      });

    // ✅ 3) Cuando cambia algo, recargo del back
    this.horariosService.reservasChanged$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.horariosService.cargarHorarios());

    // ✅ Primera carga
    this.horariosService.cargarHorarios();

    // ✅ alumnos
    this.horariosService.obtenerTodosLosAlumnos().subscribe({
      next: (alumnos) => {
        this.alumnos = (alumnos || []).filter(a => a.activo !== false);

        this.alumnosOrdenados = [...this.alumnos].sort((a, b) => {
          const apA = (a.apellido || '').toLowerCase();
          const apB = (b.apellido || '').toLowerCase();
          if (apA < apB) return -1;
          if (apA > apB) return  1;
          const nomA = (a.nombre || '').toLowerCase();
          const nomB = (b.nombre || '').toLowerCase();
          if (nomA < nomB) return -1;
          if (nomA > nomB) return  1;
          return 0;
        });

        this.alumnosFiltrados = this.alumnosOrdenados;
      },
      error: (err) => {
        console.error('❌ Error al cargar alumnos:', err);
        this.alumnos = [];
        this.alumnosOrdenados = [];
        this.alumnosFiltrados = [];
      }
    });
  }

  libres(turno: any): number {
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

  private esCerradoFijo(diaConFecha: string, hora: string): boolean {
    const [dia] = diaConFecha.split(' ');
    return (
      (dia === 'Miércoles' && (hora === '11:00' || hora === '15:00' || hora === '16:00' || hora === '17:00')) ||
      (dia === 'Viernes'   && (hora === '08:00' || hora === '18:00' || hora === '19:00' || hora === '20:00')) ||
      (dia === 'Martes'    && (hora === '19:00' || hora === '20:00')) ||
      (dia === 'Jueves'    && (hora === '15:00' || hora === '19:00' || hora === '20:00'))
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

  // ======= UI =======

  async abrirTurno(turno: any) {
    const turnoId = Number(turno.id ?? turno.idHorario);
    if (!Number.isFinite(turnoId)) {
      console.error('❌ abrirTurno: turno sin ID válido', turno);
      return;
    }

    this.turnoSeleccionado = {
      ...turno,
      id: turnoId,
      idHorario: turnoId,
      fecha: turno.fecha
    };

    // ✅ BLOQUEO CLARO: si el turno ya pasó, NO se abre ningún modal (admin ni alumno)
    if (this.esTurnoPasado(this.turnoSeleccionado.fecha, this.turnoSeleccionado.hora)) {
      const f = this.formatearFecha(this.turnoSeleccionado.fecha);
      const h = String(this.turnoSeleccionado.hora || '').slice(0, 5);

      this.abrirAlertaPasado(
        `Este turno ${f} — ${h} ya pasó. Elegí un horario futuro para reservar.`
      );
      return;
    }

    if (this.rolUsuario === 'admin') {
      this.abrirEditorDeReservas(this.turnoSeleccionado);
      return;
    }

    // ✅ alumno: 1h antes para recup/suelta (robusto)
    const diffMin = this.minutosHastaTurno(this.turnoSeleccionado.fecha, this.turnoSeleccionado.hora);
    if (diffMin < 60) {
      this.uiBloqueadoAlumno = true;
      this.mensajeBloqueoRecuperacion = '⚠️ No podés hacer una reserva de recuperación con menos de 1 hora de anticipación.';
    } else {
      this.uiBloqueadoAlumno = false;
      this.mensajeBloqueoRecuperacion = '';
    }

    this.nombreUsuario = localStorage.getItem('nombreUsuario') || 'Desconocido';
    this.apellidoUsuario = localStorage.getItem('apellidoUsuario') || 'Desconocido';
    this.tipoReserva = 'recuperacion';
    this.modalAlumnoAbierto = true;
  }

  abrirEditorDeReservas(turno: any) {
    this.turnoSeleccionado = turno;
    this.modalAbierto = true;
  }

  // ======= Admin: agregar =======

  abrirFormAgregar() {
    this.tipoReserva = 'recuperacion';
    this.mostrarFormAgregar = true;
    this.modalAbierto = false;
    this.formMsg = '';
    this.formIsError = false;
  }

  aplicarFiltroAlumnos() {
    const v = (this.filtroAlumno || '').toLowerCase().trim();
    if (!v) { this.alumnosFiltrados = this.alumnosOrdenados; return; }
    this.alumnosFiltrados = this.alumnosOrdenados.filter(a => {
      const full = `${a.apellido} ${a.nombre}`.toLowerCase();
      const tel  = String(a.telefono || '').toLowerCase();
      return full.includes(v) || tel.includes(v);
    });
  }

  cerrarFormAgregar() {
    this.mostrarFormAgregar = false;
    this.modalAbierto = true;
    this.formMsg = '';
    this.formIsError = false;
    this.usuarioSeleccionado = null;
    this.usuarioSeleccionadoId = null;
    this.telefonoNuevo = '';

    this.filtroAlumno = '';
    this.alumnosFiltrados = this.alumnosOrdenados;
  }

  onSelectAlumno(id: number | null) {
    this.usuarioSeleccionadoId = id;
    this.usuarioSeleccionado = id != null ? (this.alumnos.find(a => a.id === id) || null) : null;
    this.formMsg = ''; this.formIsError = false;
  }

  abrirModalConfirmacionFinal() {
    // ✅ si el turno pasó mientras el modal estaba abierto, avisar y cerrar todo
    if (this.turnoSeleccionado?.fecha && this.turnoSeleccionado?.hora) {
      if (this.esTurnoPasado(this.turnoSeleccionado.fecha, this.turnoSeleccionado.hora)) {
        const f = this.formatearFecha(this.turnoSeleccionado.fecha);
        const h = String(this.turnoSeleccionado.hora || '').slice(0, 5);
        this.abrirAlertaPasado(
          `Este turno ${f} — ${h} ya pasó. Elegí un horario futuro para reservar.`
        );
        return;
      }
    }

    if (this.busquedaModo === 'nombre-apellido' && !this.usuarioSeleccionado) {
      this.formMsg = '⚠️ Seleccioná un alumno de la lista.'; this.formIsError = true; return;
    }
    if (this.busquedaModo === 'telefono' && !this.telefonoNuevo.trim()) {
      this.formMsg = '⚠️ Ingresá un número de teléfono.'; this.formIsError = true; return;
    }
    this.modalConfirmacionFinalAbierta = true;
    this.mostrarFormAgregar = false;
  }

  cerrarModalConfirmacionFinal() {
    this.modalConfirmacionFinalAbierta = false;
    this.mostrarFormAgregar = true;
  }

  confirmarReservaFinal() { this.agregarReserva(); }

  agregarReserva() {
    if (this.turnoSeleccionado?.fecha && this.turnoSeleccionado?.hora) {
      if (this.esTurnoPasado(this.turnoSeleccionado.fecha, this.turnoSeleccionado.hora)) {
        const f = this.formatearFecha(this.turnoSeleccionado.fecha);
        const h = String(this.turnoSeleccionado.hora || '').slice(0, 5);
        this.abrirAlertaPasado(
          `Este turno ${f} — ${h} ya pasó. Elegí un horario futuro para reservar.`
        );
        return;
      }
    }

    const turnoId = this.turnoSeleccionado?.id;
    if (!turnoId || isNaN(turnoId)) { this.formMsg = '❌ ID de turno inválido'; this.formIsError = true; return; }

    // ✅ 1h antes en recup/suelta (robusto)
    if (this.tipoReserva !== 'automatica') {
      const diffMin = this.minutosHastaTurno(this.turnoSeleccionado.fecha, this.turnoSeleccionado.hora);
      if (diffMin < 60) { this.formMsg = '⏰ Debe reservarse al menos 1 hora antes.'; this.formIsError = true; return; }
    }

    const reservarPara = (u: { id:number; nombre:string; apellido:string }) => {
      this.horariosService.reservarComoAdmin(
        turnoId, u.nombre, u.apellido, u.id, this.turnoSeleccionado.fecha, this.tipoReserva
      ).subscribe({
        next: () => {
          this.formMsg = '✅ Reserva creada correctamente';
          this.formIsError = false;
          this.modalConfirmacionFinalAbierta = false;
          this.mostrarFormAgregar = false;
          this.modalAbierto = false;
          this.refrescarHorarios();
        },
        error: (err: HttpErrorResponse) => {
          const msg = this.getBackendMessage(err);
          this.formMsg = msg; this.formIsError = true;
          this.modalConfirmacionFinalAbierta = false;
          this.mostrarFormAgregar = true;
          this.modalAbierto = false;
          this.refrescarHorarios();
        }
      });
    };

    if (this.busquedaModo === 'nombre-apellido') {
      const u = this.usuarioSeleccionado;
      if (!u) { this.formMsg='⚠️ Seleccioná un alumno de la lista.'; this.formIsError=true; return; }
      reservarPara({ id: u.id, nombre: u.nombre, apellido: u.apellido });
    } else {
      const tel = this.telefonoNuevo.trim();
      if (!tel) { this.formMsg='⚠️ Ingresá un número de teléfono'; this.formIsError=true; return; }
      this.horariosService.buscarPorTelefono(tel).subscribe({
        next: (u) => {
          if (!u?.id) { this.formMsg='❌ Usuario no encontrado por teléfono.'; this.formIsError=true; return; }
          reservarPara({ id: u.id, nombre: u.nombre, apellido: u.apellido });
        },
        error: (err: HttpErrorResponse) => {
          this.formMsg = '❌ Usuario no encontrado: ' + this.getBackendMessage(err);
          this.formIsError = true;
        }
      });
    }
  }

  private getBackendMessage(err: any): string {
    const e = err?.error;
    if (typeof e === 'string' && e.trim()) return e;
    if (e && typeof e.message === 'string' && e.message.trim()) return e.message;
    if (Array.isArray(e?.message)) return e.message.filter(Boolean).join(' ');
    if (typeof err?.message === 'string' && err.message.trim()) return err.message;
    try { return JSON.stringify(e ?? err); } catch { return 'Error desconocido'; }
  }

  // ======= Admin: cancelar =======

  abrirModalTipoCancelacion(reserva: any) {
    this.reservaSeleccionada = { ...reserva };
    this.mostrarModalTipoCancelacion = true;
    this.modalAbierto = false;
  }

  cerrarModalTipoCancelacion() {
    this.mostrarModalTipoCancelacion = false;
    this.modalAbierto = true;
  }

  confirmarCancelacion(tipo: 'momentanea'|'permanente') {
    this.tipoCancelacionSeleccionado = tipo;
    if (tipo === 'momentanea') {
      const f = this.turnoSeleccionado?.fecha || 'la fecha indicada';
      this.textoConfirmacion = `¿Querés cancelar la reserva del día ${f}?`;
    } else {
      const alumno = `${this.reservaSeleccionada?.nombre ?? ''} ${this.reservaSeleccionada?.apellido ?? ''}`.trim();
      this.textoConfirmacion = `¿Querés cancelar permanentemente la reserva de ${alumno || 'este alumno'}?`;
    }
    this.mostrarModalTipoCancelacion = false;
    this.mostrarModalConfirmarAccion = true;
  }

  cerrarModalConfirmarAccion() {
    this.mostrarModalConfirmarAccion = false;
    this.modalAbierto = true;
    this.refrescarHorarios();
  }

  ejecutarCancelacion() { this.aceptarCancelacion(); }

  aceptarCancelacion() {
    const raw = this.reservaSeleccionada?.id ?? this.reservaSeleccionada?.idReserva ?? this.reservaSeleccionada?.reservaId;
    const id = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(id)) {
      this.mensajeAdminReserva = '❌ No se pudo cancelar: ID de reserva inválido.';
      this.esErrorAdmin = true;
      this.mostrarConfirmacionAdmin = true;
      this.mostrarModalConfirmarAccion = false;
      setTimeout(() => this.mostrarConfirmacionAdmin = false, 3000);
      return;
    }

    this.horariosService.anularReserva(id, this.tipoCancelacionSeleccionado).subscribe({
      next: () => {
        this.mensajeAdminReserva = this.tipoCancelacionSeleccionado === 'momentanea'
          ? '✅ La reserva fue cancelada por este día.'
          : '✅ La reserva fue cancelada permanentemente.';
        this.esErrorAdmin = false;
        this.mostrarConfirmacionAdmin = true;
        this.mostrarModalConfirmarAccion = false;
        this.reservaSeleccionada = null;
        this.refrescarHorarios();
        setTimeout(() => { this.mostrarConfirmacionAdmin = false; }, 3000);
      },
      error: (err) => {
        this.mensajeAdminReserva = '❌ Error al cancelar: ' + (err.error?.message || err.message);
        this.esErrorAdmin = true;
        this.mostrarConfirmacionAdmin = true;
        this.mostrarModalConfirmarAccion = false;
        setTimeout(() => { this.mostrarConfirmacionAdmin = false; }, 3000);
      }
    });
  }

  // ======= Alumno: confirmar =======

  onCambioTipoReserva() {
    this.mensajeBloqueoRecuperacion = '';
    this.uiBloqueadoAlumno = false;
  }

  confirmarReserva() {
    const idHorario = this.turnoSeleccionado.id;
    if (!idHorario || isNaN(idHorario)) {
      this.mensajeReserva = '❌ No se pudo obtener el ID del turno';
      this.esErrorReserva = true;
      this.mostrarConfirmacion = true;
      return;
    }

    if (this.turnoSeleccionado?.fecha && this.turnoSeleccionado?.hora) {
      if (this.esTurnoPasado(this.turnoSeleccionado.fecha, this.turnoSeleccionado.hora)) {
        const f = this.formatearFecha(this.turnoSeleccionado.fecha);
        const h = String(this.turnoSeleccionado.hora || '').slice(0, 5);

        this.abrirAlertaPasado(
          `Este turno ${f} — ${h} ya pasó. Elegí un horario futuro para reservar.`
        );
        return;
      }
    }
    if (this.rolUsuario !== 'admin') {
      const nivelTurno = (this.turnoSeleccionado.nivel || '').toLowerCase().trim();
      const nivelUsuario = (this.usuarioNivel || '').toLowerCase().trim();
      if (nivelTurno !== nivelUsuario) {
        this.mensajeReserva = '⚠️ Este turno no corresponde a tu nivel. Consultá a la administración.';
        this.esErrorReserva = true;
        this.mostrarConfirmacion = true;
        setTimeout(() => (this.mostrarConfirmacion = false), 3000);
        return;
      }
    }

    const tipo: 'automatica'|'recuperacion'|'suelta' = this.tipoReserva;

    // ✅ 1h antes para recup/suelta (robusto)
    if (tipo !== 'automatica') {
      const diffMin = this.minutosHastaTurno(this.turnoSeleccionado.fecha, this.turnoSeleccionado.hora);
      if (diffMin < 60) {
        this.mensajeReserva = '⚠️ Las clases de recuperación deben reservarse con al menos una hora de anticipación.';
        this.esErrorReserva = true;
        this.mostrarConfirmacion = true;
        setTimeout(() => { this.mostrarConfirmacion = false; }, 3000);
        return;
      }
    }

    this.horariosService.reservar(
      idHorario,
      this.nombreUsuario,
      this.apellidoUsuario,
      this.turnoSeleccionado.fecha,
      tipo
    ).subscribe({
      next: () => {
        this.mensajeReserva = '✅ ¡Turno reservado exitosamente!';
        this.esErrorReserva = false;
        this.mostrarConfirmacion = true;
        this.uiBloqueadoAlumno = true;
        setTimeout(() => { this.mostrarConfirmacion = false; this.cerrarModalAlumno(); }, 3000);
      },
      error: (err) => {
        const raw = this.getBackendMessage(err);
        if (tipo === 'automatica') {
          const norm = (raw || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
          if (norm.includes('ya alcanzaste tu limite mensual')) {
            this.mensajeReserva = '⚠️ Ya alcanzaste el máximo de clases de tu plan mensual. Solo podés reservar como recuperación.';
          } else if (norm.includes('ya alcanzaste tu limite semanal')) {
            this.mensajeReserva = '⚠️ Ya alcanzaste el límite semanal de clases de tu plan. Solo podés reservar como recuperación.';
          } else {
            this.mensajeReserva = '❌ No se pudo reservar: ' + raw;
          }
        } else {
          this.mensajeReserva = '❌ No se pudo reservar: ' + raw;
        }
        this.esErrorReserva = true;
        this.mostrarConfirmacion = true;
        setTimeout(() => { this.mostrarConfirmacion = false; }, 3000);
      }
    });
  }

  cerrarModalAlumno() {
    this.modalAlumnoAbierto = false;
    this.turnoSeleccionado = null;
    this.uiBloqueadoAlumno = false;
    this.refrescarHorarios();
  }

  // ======= Bloqueo reformers =======

  ajustarBloqueo(turno: any, delta: number) {
    if (this.rolUsuario !== 'admin') return;

    const id = Number(turno.id) || Number(turno.idHorario);
    if (!Number.isFinite(id)) return;

    const actual    = Math.max(0, Number(turno.blockedReformers || 0));
    const propuesta = Math.max(0, actual + delta);

    if (propuesta === actual) return;

    this.horariosService.actualizarBloqueo(id, propuesta).subscribe({
      next: () => {
        // nada: el service emite reservasChanged$ o actualiza stream
      },
      error: err => alert('No se pudo actualizar el bloqueo: ' + (err?.error?.message || err.message || err))
    });
  }

  // ✅ Refresco: vuelve al stream central
  private refrescarHorarios() {
    this.horariosService.cargarHorarios();
  }

  ocupadasFijasEnFecha(turno: any): number {
    // ✅ prioridad: lo que viene del back
    const fromBack = Number((turno as any).reformersFijosReservados ?? NaN);
    if (Number.isFinite(fromBack)) return Math.max(0, fromBack);

    // fallback viejo (por si algún día el back no lo manda)
    const id = Number(turno?.id ?? turno?.idHorario);
    const fecha = String(turno?.fecha || '').slice(0,10);
    return this.reservasFijasPorFecha.get(this.key(id, fecha)) || 0;
  }

  capacidadTurno(turno: any): number {
    const total = Number(turno?.totalReformers ?? 5);
    const bloqueados = Math.max(0, Number(turno?.blockedReformers ?? 0));
    return Math.max(0, total - bloqueados);
  }

  disponiblesFijos(turno: any): number {
    // ✅ prioridad: si el back ya te manda disponibles fijos, usalo directo
    const fromBackDisp = Number((turno as any).reformersFijosDisponibles ?? NaN);
    if (Number.isFinite(fromBackDisp)) return Math.max(0, fromBackDisp);

    // si no, calculo con fijos reservados
    return Math.max(0, this.capacidadTurno(turno) - this.ocupadasFijasEnFecha(turno));
  }

  disponibleFijoYN(turno: any): 'Y' | 'N' {
    return this.disponiblesFijos(turno) > 0 ? 'Y' : 'N';
  }

  private normEstado(v: any): string {
  return String(v || '').toLowerCase().trim();
}

  esCancelacionMomentanea(r: any, turno: any): boolean {
    // ✅ solo si tiene flag momentánea
    const cm = r?.cancelacionMomentanea === true;

    // ✅ y corresponde a esa fecha de turno (por las dudas)
    const rFecha = String(r?.fechaTurno || r?.fecha || '').slice(0, 10);
    const tFecha = String(turno?.fecha || '').slice(0, 10);

    // ✅ muchos backends guardan estado cancelado/cancelada
    const est = this.normEstado(r?.estado);
    const esCancel = est === 'cancelado' || est === 'cancelada';

    // ✅ si tu modelo usa cancelacionPermanente, la excluimos
    const cp = r?.cancelacionPermanente === true;

    return cm && !cp && esCancel && !!tFecha && rFecha === tFecha;
  }

  esReservaVisibleEnCelda(r: any, turno: any): boolean {
    const est = this.normEstado(r?.estado);
    const esReservado = est === 'reservado';

    // visible si está reservado o si es cancelación momentánea
    return esReservado || this.esCancelacionMomentanea(r, turno);
  }

  getTurnos(diaConFecha: string, hora: string) {
    if (this.estadoCierre(diaConFecha, hora) !== 'ninguno') return [];

    const [dia, fechaDDMMYYYY] = diaConFecha.split(' ');
    const nivelUsuario = (this.usuarioNivel || '').toLowerCase();

    return (this.horarios || []).filter(h =>
      h.dia === dia &&
      this.formatearFecha(h.fecha) === fechaDDMMYYYY &&
      h.hora === hora &&
      (
        this.rolUsuario === 'admin' ||
        ((h.nivel || '').toLowerCase() === nivelUsuario)
      )
    );
  }

  hasTurno(diaConFecha: string, hora: string): boolean {
    return this.getTurnos(diaConFecha, hora).length > 0;
  }

  cerrarModal(): void {
    this.modalAbierto = false;
    this.turnoSeleccionado = null;
    document.body.classList.remove('modal-open');
  }
}
