import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HorariosService } from '../services/horarios.service';
import { ActivatedRoute } from '@angular/router';
import { FormsModule, FormControl, ReactiveFormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { HorarioSemana } from '../interfaces/horario-semana.interface';

type TipoAusencia = 'dia' | 'manana' | 'tarde' | 'horario';

@Component({
  selector: 'app-gestion-turnos',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './gestion-turnos.component.html',
  styleUrls: ['./gestion-turnos.component.css'],
})
export class GestionTurnosComponent implements OnInit {
  usuarioNivel = '';
  dias: string[] = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
  horas: string[] = ['08:00','09:00','10:00','11:00','15:00','16:00','17:00','18:00'];
  horarios: any[] = [];
  rolUsuario = '';
  // tipoReserva: 'automatica' | 'recuperacion' | 'suelta' = 'automatica';
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

  // ausencias
  ausenciasPorFecha = new Map<string, { fecha: string; tipo: TipoAusencia; hora?: string }[]>();

  // índice reservas: (horarioId|fechaYMD) -> ocupadas
  private reservasPorFecha = new Map<string, number>();
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

  nivelCss(nivel: string) {
    return (nivel || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '-');
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

    // 1) SIEMPRE me alimento del stream central:
    this.horariosService.horarios$.subscribe((data) => {
      // normalizo ids de reservas (tu lógica tal cual)
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
        if (!Number.isFinite(id)) {
          console.warn('⚠️ Horario sin ID válido:', h);
        }
        return {
          ...h,
          id,
          idHorario: id
        };
      }) as any[];

      // headers de tabla
      const diasUnicos = Array.from(new Set(
        this.horarios.map(h => `${h.dia} ${this.formatearFecha(h.fecha)}`)
      ));
      const ordenDias = ['Lunes','Martes','Miércoles','Jueves','Viernes'];
      this.dias = ordenDias.map(d => diasUnicos.find(x => x?.startsWith(d))).filter(Boolean) as string[];

      this.horas = Array.from(new Set(this.horarios.map(h => h.hora))).sort((a,b) => parseInt(a) - parseInt(b));

      // rango visible → ausencias + índice liviano de reservas (igual que antes)
      const fechasYMD = (this.horarios.map(h => h.fecha).filter(Boolean) as string[]).sort();
      if (fechasYMD.length > 0) {
        const desdeYMD = fechasYMD[0];
        const hastaYMD = fechasYMD[fechasYMD.length - 1];

        this.horariosService.cargarAusencias(desdeYMD, hastaYMD).subscribe();
        this.horariosService.ausencias$.subscribe(mapYMD => {
          const nuevo = new Map<string, { fecha: string; tipo: TipoAusencia; hora?: string }[]>();
          for (const [ymd, lista] of mapYMD.entries()) {
            const key = this.formatearFecha(ymd);
            nuevo.set(key, (lista || []).map(a => ({ fecha: key, tipo: a.tipo, hora: a.hora })));
          }
          this.ausenciasPorFecha = nuevo;
        });

        this.horariosService.getReservasDeLaSemana(desdeYMD, hastaYMD).subscribe({
          next: (rows: any[]) => {
            this.reservasPorFecha.clear();
            for (const r of rows || []) {
              const cancelada = (r as any).cancelada === true
                            || String((r as any).estado || '').toUpperCase() === 'CANCELADA';
              if (cancelada) continue;
              const hId   = Number((r as any).horarioId);
              const fecha = String((r as any).fechaTurno);
              if (!Number.isFinite(hId) || !fecha) continue;
              const k = this.key(hId, fecha);
              this.reservasPorFecha.set(k, (this.reservasPorFecha.get(k) || 0) + 1);
            }
          },
          error: () => this.reservasPorFecha.clear()
        });
      }
    });

    // 2) Cuando el service avisa “cambió algo” (reserva/bloqueo), recargo del back:
    this.horariosService.reservasChanged$.subscribe(() => {
      this.horariosService.cargarHorarios();
    });

    // 3) Primera carga:
    this.horariosService.cargarHorarios();

    // 4) alumnos 
    this.horariosService.obtenerTodosLosAlumnos().subscribe({
      next: (alumnos) => {
        console.log('📋 Alumnos recibidos:', alumnos);

        // si tenés campo "activo", podés filtrar acá
        this.alumnos = (alumnos || []).filter(a => a.activo !== false);

        // Orden: Apellido, Nombre
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

        // lista inicial para el <select>
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

    // 1) Preferir un número de reservados explícito del back
    const reservadosFromBack = Number((turno as any).reformersReservados ?? NaN);
    if (Number.isFinite(reservadosFromBack)) {
      return Math.max(0, total - reservadosFromBack - bloqueados);
    }

    // 2) Fallback a índice local si no vino "reservados"
    const id       = Number((turno as any).id ?? (turno as any).idHorario);
    const fechaYMD = String((turno as any).fecha || '');
    const ocupadas = this.ocupadasEn(id, fechaYMD);

    return Math.max(0, total - ocupadas - bloqueados);
  }

  private esCerradoFijo(diaConFecha: string, hora: string): boolean {
    const [dia] = diaConFecha.split(' ');
    return (
      (dia === 'Miércoles' && (hora === '11:00' || hora === '15:00')) ||
      (dia === 'Viernes'   && (hora === '08:00' || hora === '18:00' || hora === '19:00' || hora === '20:00')) ||
      (dia === 'Martes'    && (hora === '19:00' || hora === '20:00')) ||
      (dia === 'Jueves'    && (hora === '19:00' || hora === '20:00'))
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

  formatearFecha(fecha: string): string {
    const d = new Date(`${fecha}T12:00:00-03:00`);
    return d.toLocaleDateString('es-AR');
  }

  // ======= UI =======

  async abrirTurno(turno: any) {
    // Normalizar ID
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

    console.log('🧪 abrirTurno()', this.turnoSeleccionado);

    if (this.rolUsuario === 'admin') {
      this.abrirEditorDeReservas(this.turnoSeleccionado);
      return;
    }

    // alumno: 1h antes para recup/suelta
    const ahora = new Date();
    const fh = new Date(`${this.turnoSeleccionado.fecha}T${this.turnoSeleccionado.hora}:00-03:00`);
    const diffH = (fh.getTime() - ahora.getTime()) / 3600000;
    if (diffH < 1) {
      this.uiBloqueadoAlumno = true;
      this.mensajeBloqueoRecuperacion = '⚠️ No podés hacer una reserva de recuperación con menos de 1 hora de anticipación.';
    } else {
      this.uiBloqueadoAlumno = false;
      this.mensajeBloqueoRecuperacion = '';
    }

    this.nombreUsuario = localStorage.getItem('nombreUsuario') || 'Desconocido';
    this.apellidoUsuario = localStorage.getItem('apellidoUsuario') || 'Desconocido';
    this.modalAlumnoAbierto = true;
  }


  abrirEditorDeReservas(turno: any) {
    this.turnoSeleccionado = turno;
    this.modalAbierto = true;
  }

  // ======= Admin: agregar =======

  abrirFormAgregar() {
    this.tipoReserva = 'automatica';   
    this.mostrarFormAgregar = true;
    this.modalAbierto = false;
    this.formMsg = '';
    this.formIsError = false;
  }

 
  aplicarFiltroAlumnos() {
    const v = (this.filtroAlumno || '').toLowerCase().trim();
    if (!v) {
      this.alumnosFiltrados = this.alumnosOrdenados;
      return;
    }
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

    // 👇 limpiar buscador y restaurar lista
    this.filtroAlumno = '';
    this.alumnosFiltrados = this.alumnosOrdenados;
  }

  onSelectAlumno(id: number | null) {
    this.usuarioSeleccionadoId = id;
    this.usuarioSeleccionado = id != null ? (this.alumnos.find(a => a.id === id) || null) : null;
    this.formMsg = ''; this.formIsError = false;
  }

  abrirModalConfirmacionFinal() {
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
      console.log('🧪 agregarReserva()', {
      turnoSeleccionado: this.turnoSeleccionado,
      tipoReserva: this.tipoReserva,
      usuarioSeleccionado: this.usuarioSeleccionado,
      usuarioSeleccionadoId: this.usuarioSeleccionadoId,
      busquedaModo: this.busquedaModo
    });
    const turnoId = this.turnoSeleccionado?.id;
    if (!turnoId || isNaN(turnoId)) { this.formMsg = '❌ ID de turno inválido'; this.formIsError = true; return; }

    // 1h antes en recup/suelta
    if (this.tipoReserva !== 'automatica') {
      const ahora = new Date();
      const fh = new Date(`${this.turnoSeleccionado.fecha}T${this.turnoSeleccionado.hora}:00-03:00`);
      const diffMin = (fh.getTime() - ahora.getTime()) / 60000;
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

  cerrarConfirmacion() {
    this.mostrarModalConfirmarAccion = false;
    this.refrescarHorarios();
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

    // nivel coincide (alumno)
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

    // 1h antes para recup/suelta
    if (tipo !== 'automatica') {
      try {
        const ahora = new Date();
        const fh = new Date(`${this.turnoSeleccionado.fecha}T${this.turnoSeleccionado.hora}:00-03:00`);
        const diffMin = (fh.getTime() - ahora.getTime()) / 60000;
        if (diffMin < 60) {
          this.mensajeReserva = '⚠️ Las clases de recuperación deben reservarse con al menos una hora de anticipación.';
          this.esErrorReserva = true;
          this.mostrarConfirmacion = true;
          setTimeout(() => { this.mostrarConfirmacion = false; }, 3000);
          return;
        }
      } catch {}
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
    const propuesta = Math.max(0, actual + delta); // ❗sin cap local

    if (propuesta === actual) return;

    this.horariosService.actualizarBloqueo(id, propuesta).subscribe({
      next: () => {
        // ⚠️ ya no hagas refresco local acá: lo hará el service para TODOS los componentes
      },
      error: err => alert('No se pudo actualizar el bloqueo: ' + (err?.error?.message || err.message || err))
    });
  }


  // ======= Refresco =======

  private refrescarHorarios() {
    this.horariosService.getHorariosDeLaSemana().subscribe(data => {
      this.horarios = data.map(h => ({ ...h, id: h.idHorario || h.id })); // ← unificar

      const fechasYMD = [...new Set(data.map(h => h.fecha))].sort();
      if (fechasYMD.length > 0) {
        const desde = fechasYMD[0];
        const hasta = fechasYMD[fechasYMD.length - 1];

        this.horariosService.getReservasDeLaSemana(desde, hasta).subscribe(rows => {
          this.reservasPorFecha.clear();
          for (const r of rows) {
          if ((r as any).cancelada) continue;
          const k = `${Number((r as any).horarioId)}|${String((r as any).fechaTurno)}`;
          this.reservasPorFecha.set(k, (this.reservasPorFecha.get(k) || 0) + 1);
          }
        });
      }
    });
  }

  // Devuelve los turnos que matchean ese "día con fecha" y hora.
// Respeta cierre fijo/ausencias y filtra por nivel para alumnos.
  getTurnos(diaConFecha: string, hora: string) {
    // si hay cierre fijo o ausencia, no hay turnos clickeables
    if (this.estadoCierre(diaConFecha, hora) !== 'ninguno') return [];

    const [dia, fechaDDMMYYYY] = diaConFecha.split(' '); // "Lunes 20/11/2025"
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

  // (Opcional) Saber si hay al menos un turno visible en esa celda
  hasTurno(diaConFecha: string, hora: string): boolean {
    return this.getTurnos(diaConFecha, hora).length > 0;
  }

  cerrarModal(): void {
    this.modalAbierto = false;
    this.turnoSeleccionado = null;
    document.body.classList.remove('modal-open');
  }


}
