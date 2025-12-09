import { Component, HostListener } from '@angular/core';
import { HorariosService } from '../services/horarios.service';
import { CommonModule, NgIf } from '@angular/common';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-mis-turnos',
  standalone: true,
  imports: [CommonModule, NgIf],
  templateUrl: './mis-turnos.component.html',
  styleUrls:['./mis-turnos.component.css']
})
export class MisTurnosComponent {

  dias: string[] = [];
  fechaInicioSemana: Date = new Date();
  horas: string[] = ['08:00', '09:00', '10:00', '11:00', '15:00', '16:00', '17:00', '18:00'];
  misReservas: any[] = [];
  modalAbierto = false;
  turnoAEliminar: any = null;
  mostrarModalConfirmarAccion = false;  // segundo modal de confirmación final
  tipoCancelacionSeleccionado: 'momentanea' | 'permanente' = 'momentanea';
  textoConfirmacion = '';
  mensajeUsuarioCancel = '';
  mostrarConfirmacionUsuario = false;
  esErrorUsuarioCancel = false;
  uiBloqueadoAlumnoCancel = false;      // bloquea todo salvo “Cerrar” luego del éxito
  modalRecuperacionPendiente = false;
  mostrarModalRecuperacion = false;
  cantidadRecuperaciones = 0;
  ausenciasPorFecha = new Map<string, { fecha: string; tipo: 'dia'|'manana'|'tarde'|'horario'; hora?: string }[]>();
  private recalcTimer: any;
  reservasVisibles: any[] = [];
  tituloConfirmacion = '';
  yaMostradoModalRecuperacion = false;
  planMensual: '0' | '4' | '8' | '12' | null = null;
  avisoSemana: { count: number; label: string } | null = null;

  constructor(
    private horariosService: HorariosService,
    private http: HttpClient
    ) {}
    
  nivelCss(nivel: string) {
    return (nivel || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // saca acentos
      .replace(/\s+/g, '-');
  }

  ngOnInit() {
    // 1) Traer plan (desde login o backend). Fallback a '4' para no quedar null.
    this.planMensual = (localStorage.getItem('planMensual') as '0'|'4'|'8'|'12') ?? '4';
    console.log('[MisTurnos] planMensual =', this.planMensual);

    this.generarDiasConFechas();

    this.horariosService.getHorariosDeLaSemana().subscribe(data => {
      const fechasYMD = (data.map(h => h.fecha).filter(Boolean) as string[]).sort();
      if (fechasYMD.length > 0) {
        const desdeYMD = fechasYMD[0];
        const hastaYMD = fechasYMD[fechasYMD.length - 1];

        this.horariosService.cargarAusencias(desdeYMD, hastaYMD).subscribe();
        this.horariosService.ausencias$.subscribe(mapYMD => {
          const nuevo = new Map<string, { fecha: string; tipo: 'dia'|'manana'|'tarde'|'horario'; hora?: string }[]>();
          for (const [ymd, lista] of mapYMD.entries()) {
            const key = this.formatearFechaArg(ymd);
            nuevo.set(key, (lista || []).map(a => ({ fecha: key, tipo: a.tipo, hora: a.hora })));
          }
          this.ausenciasPorFecha = nuevo;
          // re-pintamos por si las ausencias ocultan algo
          this.recomputeReservasVisibles();
        });
      }
    });

    this.cargarMisReservas();

    this.horariosService.reservasChanged$.subscribe(() => {
      this.cargarMisReservas();
    });

    this.recalcTimer = setInterval(() => this.recalcularRecuperacionesLocal(), 60_000);
  }


  ngOnDestroy() {
    if (this.recalcTimer) {
      clearInterval(this.recalcTimer);
    }
  }

  // get avisoSemana(): { count: number; label: string } | null {
  //   const ahora = new Date();

  //   if (this.planMensual === '0') {
  //     // 👉 “suelta / de prueba” (cuenta solo las sueltas vigentes)
  //     const countSueltas = (this.misReservas || []).filter(r =>
  //       r?.tipo === 'suelta' && this.esRecuperacionVigente(r, ahora)
  //     ).length;

  //     if (countSueltas > 0) {
  //       return {
  //         count: countSueltas,
  //         label: countSueltas > 1 ? 'clases sueltas/de prueba' : 'clase suelta/de prueba'
  //       };
  //     }
  //     return null;
  //   }

  //   // 👉 “recuperación” (no automáticas vigentes y que NO sean suelta)
  //   const countRecup = (this.misReservas || []).filter(r =>
  //     !r?.automatica && r?.tipo !== 'suelta' && this.esRecuperacionVigente(r, ahora)
  //   ).length;

  //   if (countRecup > 0) {
  //     return {
  //       count: countRecup,
  //       label: countRecup > 1 ? 'clases de recuperación' : 'clase de recuperación'
  //     };
  //   }
  //   return null;
  // }

  private cargarMisReservas() {
    this.horariosService.getMisReservas().subscribe({
      next: (data: any[]) => {
        this.misReservas = (data || []).filter(r => r.estado !== 'cancelado');
        console.log('[MisTurnos] misReservas =', this.misReservas);
        this.recomputeReservasVisibles();

        const ahora = new Date();

        // 1) Contar SUELTAS/PRUEBA (siempre priorizan)
        const countSueltas = (this.misReservas || []).filter(r =>
          (r?.tipo === 'suelta' || (!r?.automatica && r?.tipo === 'suelta')) && // explícito
          this.esRecuperacionVigente(r, ahora)
        ).length;

        // 2) Contar RECUPERACIONES (no automáticas y no sueltas)
        const countRecup = (this.misReservas || []).filter(r =>
          !r?.automatica &&
          r?.tipo !== 'suelta' &&
          this.esRecuperacionVigente(r, ahora)
        ).length;

        // 3) Prioridad: si hay sueltas, mostramos sueltas; si no, recuperaciones
        if (countSueltas > 0) {
          this.avisoSemana = {
            count: countSueltas,
            label: countSueltas > 1 ? 'clases sueltas/de prueba' : 'clase suelta/de prueba'
          };
        } else if (countRecup > 0) {
          this.avisoSemana = {
            count: countRecup,
            label: countRecup > 1 ? 'clases de recuperación' : 'clase de recuperación'
          };
        } else {
          this.avisoSemana = null;
        }

        // (opcional) mantener compat con tu variable existente
        this.cantidadRecuperaciones = this.avisoSemana?.count ?? 0;

        // Modal inicial
        if (this.avisoSemana && !this.yaMostradoModalRecuperacion) {
          this.mostrarModalRecuperacion = true;
          this.yaMostradoModalRecuperacion = true;
        } else if (!this.avisoSemana) {
          this.mostrarModalRecuperacion = false;
          this.yaMostradoModalRecuperacion = false; // permite reabrir más tarde si vuelven a aparecer
        }
      },
      error: (err) => console.error('❌ Error al cargar mis reservas', err)
    });
  }


  generarDiasConFechas() {
    const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

    const hoy = new Date();
    const diaActual = hoy.getDay(); // 0 (domingo) a 6 (sábado)
    const diasDesdeLunes = (diaActual + 6) % 7; // cuántos días retroceder hasta llegar a lunes
    const lunes = new Date(hoy);
    lunes.setDate(hoy.getDate() - diasDesdeLunes);

    this.dias = Array.from({ length: 5 }, (_, i) => {
      const fecha = new Date(lunes);
      fecha.setDate(lunes.getDate() + i);
      const nombreDia = diasSemana[fecha.getDay()];
      const fechaStr = `${fecha.getDate().toString().padStart(2, '0')}/${(fecha.getMonth() + 1)
        .toString().padStart(2, '0')}/${fecha.getFullYear()}`;
      return `${nombreDia} ${fechaStr}`;
    });
  }

  hasReserva(diaCompleto: string, hora: string): boolean {
    if (this.hayAusencia(diaCompleto, hora)) return false;
    const fechaFormateada = this.obtenerFechaFormateadaDesdeDia(diaCompleto);
    return this.reservasVisibles.some(r =>
      r.fechaTurno === fechaFormateada && r.horario.hora === hora
    );
  }

  getNivel(diaCompleto: string, hora: string): string {
    if (this.hayAusencia(diaCompleto, hora)) return '';
    const fechaFormateada = this.obtenerFechaFormateadaDesdeDia(diaCompleto);
    const r = this.reservasVisibles.find(x =>
      x.fechaTurno === fechaFormateada && x.horario.hora === hora
    );
    return r ? r.horario.nivel : '';
  }

  getReserva(diaCompleto: string, hora: string): any | null {
    if (this.hayAusencia(diaCompleto, hora)) return null;
    const fechaFormateada = this.obtenerFechaFormateadaDesdeDia(diaCompleto);
    return this.reservasVisibles.find(r =>
      r.fechaTurno === fechaFormateada && r.horario.hora === hora
    ) || null;
  }

  abrirModalDesdeCelda(diaCompleto: string, hora: string) {
   if (this.hayAusencia(diaCompleto, hora)) return;
   const fechaFormateada = this.obtenerFechaFormateadaDesdeDia(diaCompleto);

    // 🔎 Buscar SOLO en lo visible (ya excluye recuperaciones vencidas)
    const reserva = this.reservasVisibles.find(r =>
      r.fechaTurno === fechaFormateada && r.horario.hora === hora
    );

    // Si no está visible, no abrimos nada (pudo vencer o ser cancelada)
    if (!reserva) return;

    // 🛡️ Doble guardia: si es recuperación y ya no está vigente, no abrir
    if (!reserva.automatica && !this.esRecuperacionVigente(reserva)) return;

    this.turnoAEliminar = reserva;

    // 🔒 Bloqueo si faltan < 2hs
    const fechaHoraReserva = new Date(`${reserva.fechaTurno}T${reserva.horario.hora}:00-03:00`);
    const ahora = new Date();
    this.uiBloqueadoAlumnoCancel = (fechaHoraReserva.getTime() - ahora.getTime()) / (1000 * 60 * 60) < 2;

    const esSuelta = reserva?.tipo === 'suelta';
    const etiqueta = esSuelta ? 'reserva suelta/de prueba' : 'reserva de recuperación';

    if (reserva.automatica) {
      this.modalAbierto = true;
    } else {
      const [_, fechaDDMMYYYY] = diaCompleto.split(' ');
      this.textoConfirmacion = `¿Querés cancelar esta ${etiqueta} (${fechaDDMMYYYY} ${hora})?`;
      this.tituloConfirmacion = `Cancelar ${etiqueta}`;
      this.mostrarModalConfirmarAccion = true;
    }
  }

  private obtenerFechaFormateadaDesdeDia(diaCompleto: string): string {
    const partes = diaCompleto.split(' '); // ["Martes", "30/07/2025"]
    const fechaTexto = partes[1];          // "30/07/2025"
    const fechaParts = fechaTexto.split('/'); // ["30", "07", "2025"]
    return `${fechaParts[2]}-${fechaParts[1]}-${fechaParts[0]}`; // "2025-07-30"
  }

  getNombreCompleto(diaCompleto: string, hora: string): string {
    const fechaFormateada = this.obtenerFechaFormateadaDesdeDia(diaCompleto);
    const reserva = this.misReservas.find(r =>
      r.fechaTurno === fechaFormateada &&
      r.horario.hora === hora
    );
    return reserva ? `${reserva.nombre} ${reserva.apellido}` : '';
  }

  abrirModalCancelacion(reserva: any) {
    this.turnoAEliminar = reserva;
    this.modalAbierto = true;
  }

  confirmarCancelacion(tipo: 'momentanea' | 'permanente') {
    if (!this.turnoAEliminar || !this.turnoAEliminar.id) {
      console.error('❌ Reserva inválida:', this.turnoAEliminar);
      this.mensajeUsuarioCancel = '❌ No se pudo cancelar: reserva inválida.';
      this.esErrorUsuarioCancel = true;
      this.mostrarConfirmacionUsuario = true;
      return;
    }

    this.tipoCancelacionSeleccionado = tipo;

    const fechaArg = this.formatearFechaArg(this.turnoAEliminar.fechaTurno);
    const dia = this.turnoAEliminar?.horario?.dia ?? '';
    const hora = this.turnoAEliminar?.horario?.hora ?? '';

    if (tipo === 'momentanea') {
      this.textoConfirmacion = `¿Querés cancelar la reserva del día ${dia} ${fechaArg} a las ${hora}?`;
    } else {
      this.textoConfirmacion = `¿Querés cancelar permanentemente tu reserva de ${dia} ${hora} (${fechaArg})?`;
    }

     // 👇 título según tipo y si es habitual o recuperación
    this.tituloConfirmacion = this.turnoAEliminar.automatica
    ? (tipo === 'momentanea' ? 'Cancelar por esta vez' : 'Cancelar reserva permanente')
    : 'Cancelar reserva de recuperación';
    // Cerramos el primer modal y abrimos el de confirmación final
    this.modalAbierto = false;
    this.mostrarModalConfirmarAccion = true;
  }

  aceptarCancelacion() {
    const reservaId = this.turnoAEliminar?.id;
    if (!reservaId) {
      // ... (manejo de error)
      return;
    }

    // En automáticas: momentánea/permanente; en recuperaciones da igual (el back borra)
    const tipo = this.turnoAEliminar.automatica
      ? this.tipoCancelacionSeleccionado
      : 'momentanea';

    this.horariosService.anularReserva(reservaId, tipo).subscribe({
      next: () => {
        const esSuelta = this.turnoAEliminar?.tipo === 'suelta';
        const etiqueta = esSuelta ? 'reserva clase suelta/de prueba' : 'reserva de recuperación';

        this.mensajeUsuarioCancel = this.turnoAEliminar.automatica
          ? (tipo === 'momentanea'
              ? '✅ La reserva fue cancelada por esta vez. Podrás recuperarla.'
              : '✅ La reserva fue cancelada permanentemente.')
          : `✅ La ${etiqueta} fue cancelada.`;
        this.esErrorUsuarioCancel = false;
        this.mostrarConfirmacionUsuario = true;

        // 2) Cerrar modales y bloquear la UI
        this.uiBloqueadoAlumnoCancel = true;
        this.mostrarModalConfirmarAccion = false;
        this.modalAbierto = false;

        // 3) ✅ Re-cargar las reservas AHORA, después de que el backend confirme la cancelación
        this.horariosService.getMisReservas().subscribe(rs => {
          this.misReservas = rs.filter(x => x.estado !== 'cancelado');
          this.recomputeReservasVisibles();
          const recuperaciones = this.misReservas.filter(x => !x.automatica && this.esRecuperacionVigente(x));
          this.cantidadRecuperaciones = recuperaciones.length;
        });
      },
      error: (err) => {
        // ... (manejo de error)
      },
    });
  }

  cerrarModal() {
    this.turnoAEliminar = null;
    this.modalAbierto = false;
    this.mostrarModalConfirmarAccion = false;
    this.uiBloqueadoAlumnoCancel = false;
    this.mostrarConfirmacionUsuario = false;
    this.mensajeUsuarioCancel = '';
    this.esErrorUsuarioCancel = false;
  }

  cerrarConfirmacionFinal() {
    // Si la reserva era permanente, vuelve a abrir el modal original
    if (this.turnoAEliminar?.automatica) {
      this.mostrarModalConfirmarAccion = false;
      this.modalAbierto = true;
    } else {
      // Si era temporal, cerramos todo
      this.mostrarModalConfirmarAccion = false;
      this.turnoAEliminar = null;
    }
  }

  esRecuperacion(dia: string, hora: string): boolean {
    const r = this.getReserva(dia, hora);
    if (!r) return false;
    // recuperación = no automática, no suelta, y vigente
    return !r.automatica && r.tipo !== 'suelta' && this.esRecuperacionVigente(r);
  }

  esSuelta(dia: string, hora: string): boolean {
    const r = this.getReserva(dia, hora);
    return r ? r.tipo === 'suelta' : false;
  }

  esAutomatica(dia: string, hora: string): boolean {
    const r = this.getReserva(dia, hora);
    if (!r) return false;
    return typeof r.tipo === 'string' ? r.tipo === 'automatica' : r.automatica === true;
  }

  formatearFechaArg(yyyyMmDd: string): string {
    // "2025-07-30" -> "30/07/2025"
    if (!yyyyMmDd) return '';
    const [y, m, d] = yyyyMmDd.split('-');
    return `${d}/${m}/${y}`;
  }

  hayAusencia(diaConFecha: string, hora: string): boolean {
  const [, fechaDDMMYYYY] = diaConFecha.split(' ');
  const aus = this.ausenciasPorFecha.get(fechaDDMMYYYY);
  if (!aus || aus.length === 0) return false;

  const toMin = (h: string) => { const [HH, MM] = h.split(':').map(Number); return HH*60+MM; };
  const m = toMin(hora);
  const MANIANA_INI = toMin('07:00'), MANIANA_FIN = toMin('13:59');
  const TARDE_INI   = toMin('14:00'), TARDE_FIN   = toMin('22:00');

  for (const a of aus) {
    if (a.tipo === 'dia') return true;
    if (a.tipo === 'horario' && a.hora && a.hora.slice(0,5) === hora.slice(0,5)) return true;
    if (a.tipo === 'manana' && m >= MANIANA_INI && m <= MANIANA_FIN) return true;
    if (a.tipo === 'tarde'  && m >= TARDE_INI   && m <= TARDE_FIN)   return true;
  }
  return false;
  }

  @HostListener('window:focus')
  onFocus() {
    this.cargarMisReservas();
  }

  private esRecuperacionVigente(r: any, ahora = new Date()): boolean {
    if (r.estado === 'cancelado') return false;
    if (r.automatica === true) return false; // solo recuperaciones

    // Construye la fecha/hora local (Argentina -03:00)
    const inicio = new Date(`${r.fechaTurno}T${r.horario.hora}:00-03:00`);
    const limite = new Date(inicio.getTime() + 60 * 60 * 1000); // +1 hora
    return ahora < limite; // si ya pasó 1h, deja de contar
  }

  private cerradoPorAusencia(fechaYMD: string, hora: string): boolean {
    // hayAusencia espera "DIA DD/MM/YYYY", usamos marcador "X " + fecha
    const ddmmyyyy = this.formatearFechaArg(fechaYMD);
    return this.hayAusencia('X ' + ddmmyyyy, hora);
  }

  private recalcularRecuperacionesLocal() {
    const ahora = new Date();

    this.recomputeReservasVisibles(ahora);

    const countSueltas = (this.misReservas || []).filter(r =>
      r?.tipo === 'suelta' && this.esRecuperacionVigente(r, ahora)
    ).length;

    const countRecup = (this.misReservas || []).filter(r =>
      !r?.automatica && r?.tipo !== 'suelta' && this.esRecuperacionVigente(r, ahora)
    ).length;

    if (countSueltas > 0) {
      this.avisoSemana = {
        count: countSueltas,
        label: countSueltas > 1 ? 'clases sueltas/de prueba' : 'clase suelta/de prueba'
      };
    } else if (countRecup > 0) {
      this.avisoSemana = {
        count: countRecup,
        label: countRecup > 1 ? 'clases de recuperación' : 'clase de recuperación'
      };
    } else {
      this.avisoSemana = null;
    }

    this.cantidadRecuperaciones = this.avisoSemana?.count ?? 0;

    if (this.avisoSemana && !this.yaMostradoModalRecuperacion) {
      this.mostrarModalRecuperacion = true;
      this.yaMostradoModalRecuperacion = true;
    } else if (!this.avisoSemana) {
      this.mostrarModalRecuperacion = false;
      this.yaMostradoModalRecuperacion = false;
    }
  }


  private recomputeReservasVisibles(now = new Date()) {
      this.reservasVisibles = (this.misReservas || []).filter((r: any) => {
        // fuera por cancelado
        if (r.estado === 'cancelado') return false;

        // fuera si el estudio está cerrado por ausencia en ese día/hora
        if (this.cerradoPorAusencia(r.fechaTurno, r.horario.hora)) return false;

        // si es recuperación (no automática), mostrar solo hasta 1h después del inicio
        if (!r.automatica) {
          const inicio = new Date(`${r.fechaTurno}T${r.horario.hora}:00-03:00`);
          const limite = new Date(inicio.getTime() + 60 * 60 * 1000);
          if (now >= limite) return false;
        }
        return true;
      });
  }

}
