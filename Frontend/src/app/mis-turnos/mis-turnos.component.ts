import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { HorariosService } from '../services/horarios.service';
import { CommonModule, NgIf } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env/environment';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-mis-turnos',
  standalone: true,
  imports: [CommonModule, NgIf],
  templateUrl: './mis-turnos.component.html',
  styleUrls:['./mis-turnos.component.css']
})
export class MisTurnosComponent implements OnInit, OnDestroy {
  
  dias: string[] = [];
  fechaInicioSemana: Date = new Date();
  horas: string[] = ['08:00', '09:00', '10:00', '11:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'];
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
  mostrarModalRecuperacion = false;
  cantidadRecuperaciones = 0;
  ausenciasPorFecha = new Map<string, { fecha: string; tipo: 'dia'|'manana'|'tarde'|'horario'; hora?: string }[]>();
  private recalcTimer: any;
  reservasVisibles: any[] = [];
  tituloConfirmacion = '';
  yaMostradoModalRecuperacion = false;
  planMensual: '0' | '4' | '8' | '12' | null = null;
  avisoSemana: { count: number; label: string } | null = null;
  modalAsistencia: boolean = false;
  asistenciaNombre: string = '';
  asistenciaApellido: string = '';
  asistenciaCiclos: any[] = [];
  asistenciaCicloActual: any | null = null;
  modalHistorialCiclos = false;
  historialPorAnio: Array<{ anio: number; ciclos: any[] }> = [];
  expandedCiclos = new Set<string>();
  semanaDesdeYMD = '';
  semanaHastaYMD = '';

  private api = environment.apiUrl;
  private destroy$ = new Subject<void>();

  constructor(
    private horariosService: HorariosService,
    private http: HttpClient
    ) {}

  trackByCiclo = (_: number, ciclo: any) => this.cicloKey(ciclo);
  trackByAnio = (_: number, bloque: any) => bloque.anio;
    
  nivelCss(nivel: string) {
    return (nivel || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // saca acentos
      .replace(/\s+/g, '-');
  }

  ngOnDestroy() {
    if (this.recalcTimer) {
      clearInterval(this.recalcTimer);
    }

    this.destroy$.next();
    this.destroy$.complete();
  }

  ngOnInit() {
    this.planMensual = (localStorage.getItem('planMensual') as '0'|'4'|'8'|'12') ?? '4';
    console.log('[MisTurnos] planMensual =', this.planMensual);

    // ✅ ausencias$ (queda)
    this.horariosService.ausencias$
      .pipe(takeUntil(this.destroy$))
      .subscribe(mapYMD => {
        const nuevo = new Map<string, { fecha: string; tipo: 'dia'|'manana'|'tarde'|'horario'; hora?: string }[]>();
        for (const [ymd, lista] of mapYMD.entries()) {
          const key = this.formatearFechaArg(ymd);
          nuevo.set(key, (lista || []).map(a => ({ fecha: key, tipo: a.tipo, hora: a.hora })));
        }
        this.ausenciasPorFecha = nuevo;
        this.recomputeReservasVisibles();
      });

    // ✅ Carga inicial = igual que gestión
    this.refrescarSemanaComoGestionTurnos();

    // ✅ Cuando cambia algo, recargar todo igual que gestión
    this.horariosService.reservasChanged$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.refrescarSemanaComoGestionTurnos());

    // ✅ Timer
    this.recalcTimer = setInterval(() => this.recalcularRecuperacionesLocal(), 60_000);
  }

  private refrescarSemanaComoGestionTurnos() {
    this.horariosService.getHorariosDeLaSemana()
      .pipe(takeUntil(this.destroy$))
      .subscribe(data => {
        const fechasYMD = (data.map(h => h.fecha).filter(Boolean) as string[]).sort();
        if (!fechasYMD.length) return;

        const desdeYMD = fechasYMD[0];
        const hastaYMD = fechasYMD[fechasYMD.length - 1];

        // ✅ guardo el rango actual
        this.semanaDesdeYMD = desdeYMD;
        this.semanaHastaYMD = hastaYMD;

        this.generarDiasConFechas(new Date(`${desdeYMD}T12:00:00-03:00`));

        this.horariosService.cargarAusencias(desdeYMD, hastaYMD)
          .pipe(takeUntil(this.destroy$))
          .subscribe();

        this.cargarMisReservas(desdeYMD, hastaYMD);
        this.refrescarSaldoRecuperacionDesdeBackend();
      });
  }

  private nowAR(): Date {
    return new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' })
    );
  }

  private cargarMisReservas(desdeYMD?: string, hastaYMD?: string) {
    this.horariosService.getMisReservas()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data: any[]) => {

          // 1) Normalizar
          const norm = (r: any) => ({
            ...r,
            fechaTurno: String(r?.fechaTurno ?? '').slice(0, 10),
            estado: String(r?.estado ?? '').toLowerCase(),
            tipo: String(r?.tipo ?? '').toLowerCase(),
            automatica: (r?.automatica === true) || String(r?.tipo ?? '').toLowerCase() === 'automatica',
            horario: {
              ...(r?.horario ?? {}),
              hora: String(r?.horario?.hora ?? '').slice(0, 5),
            },
          });

          let fixed = (data || []).map(norm);

          // 2) Filtrar por la semana visible (Lun..Vie de /horarios/semana)
          if (desdeYMD && hastaYMD) {
            fixed = fixed.filter(r => r.fechaTurno >= desdeYMD && r.fechaTurno <= hastaYMD);
          }

          // 3) Guardar reservas "base" (incluye cancelación momentánea para pintar rojo)
          //    - cancelación permanente NO se muestra
          this.misReservas = fixed.filter(r => {
            if (r.estado !== 'cancelado') return true;

            // mostrar SOLO si es momentánea (rojo)
            return r?.cancelacionMomentanea === true && r?.cancelacionPermanente !== true;
          });

          // 4) Recalcular lo visible en la grilla:
          //    - oculta recuperaciones/sueltas vencidas (+1h)
          //    - oculta cancelaciones momentáneas vencidas (cuando ya pasó la clase)
          //    - oculta cierres por ausencias
          this.recomputeReservasVisibles(this.nowAR());

          // 5) Conteos informativos (NO afectan el saldo real del plan)
          const ahora = this.nowAR();

          const countSueltasSemana = (this.misReservas || []).filter(r =>
            r?.tipo === 'suelta' && this.esRecuperacionVigente(r, ahora)
          ).length;

          // Esto es “cuántas recuperaciones/sueltas PLANEADAS esta semana” (para compat si lo usás)
          const countRecupPlaneadasSemana = (this.misReservas || []).filter(r =>
            !r?.automatica && r?.tipo !== 'suelta' && this.esRecuperacionVigente(r, ahora)
          ).length;

          // Si querés mantener el número “planeadas” (sin mezclar con saldo):
          this.cantidadRecuperaciones = countRecupPlaneadasSemana;

          // 6) IMPORTANTE:
          // El aviso “Tenés X recuperaciones disponibles” sale del backend (saldoRecuperacion),
          // así que NO lo pisamos acá con sueltas.
          //
          // Pero si querés mostrar info extra de sueltas en UI (sin tocar avisoSemana),
          // podés guardar countSueltasSemana en una variable aparte.
          // Ej: this.cantidadSueltas = countSueltasSemana;

          // 7) El modal/aviso de saldo lo maneja refrescarSaldoRecuperacionDesdeBackend()
          // (lo llamás en refrescarSemanaComoGestionTurnos, así que acá no hace falta)
        },
        error: (err) => console.error('❌ Error al cargar mis reservas', err),
      });
  }

  generarDiasConFechas(base?: Date) {
    const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

    const ref = base ? new Date(base) : this.nowAR();
    const diaActual = ref.getDay();
    const diasDesdeLunes = (diaActual + 6) % 7;

    const lunes = new Date(ref);
    lunes.setDate(ref.getDate() - diasDesdeLunes);

    this.fechaInicioSemana = lunes;

    this.dias = Array.from({ length: 5 }, (_, i) => {
      const fecha = new Date(lunes);
      fecha.setDate(lunes.getDate() + i);
      const nombreDia = diasSemana[fecha.getDay()];
      const fechaStr = `${String(fecha.getDate()).padStart(2, '0')}/${String(fecha.getMonth() + 1).padStart(2, '0')}/${fecha.getFullYear()}`;
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
    if (!reservaId) return;

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

        // Cerrar modales y bloquear UI
        this.uiBloqueadoAlumnoCancel = true;
        this.mostrarModalConfirmarAccion = false;
        this.modalAbierto = false;

        // ✅ Recargar TODO coherente con la semana visible (igual que Gestión Turnos)
        this.refrescarSemanaComoGestionTurnos();
      },
      error: (err) => {
        this.mensajeUsuarioCancel = err?.error?.message || '❌ No se pudo cancelar la reserva.';
        this.esErrorUsuarioCancel = true;
        this.mostrarConfirmacionUsuario = true;

        // (Opcional) no cierres modales si hubo error
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
    this.refrescarSemanaComoGestionTurnos();
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

  private recomputeReservasVisibles(now = this.nowAR()) {
    this.reservasVisibles = (this.misReservas || []).filter((r: any) => {

      const est = String(r?.estado ?? '').toLowerCase();

      // ✅ 1) Si el estudio está cerrado por ausencia en ese día/hora => no se ve
      if (this.cerradoPorAusencia(r.fechaTurno, r.horario.hora)) return false;

      // construir fecha/hora de la clase (Argentina)
      const inicio = new Date(`${r.fechaTurno}T${r.horario.hora}:00-03:00`);
      const limite = new Date(inicio.getTime() + 60 * 60 * 1000); // +1 hora

      // ✅ 2) Canceladas
      if (est === 'cancelado') {
        // permanente: nunca se ve en grilla
        if (r?.cancelacionPermanente === true) return false;

        // momentánea: se ve SOLO hasta +1h del inicio, después desaparece
        if (r?.cancelacionMomentanea === true) {
          return now < limite;
        }

        // otras canceladas sin flags => no se muestran
        return false;
      }

      // ✅ 3) Recuperaciones y sueltas (no automáticas) se ven hasta +1h
      if (r.automatica !== true) {
        return now < limite;
      }

      // ✅ 4) Turno fijo normal (automática): se ve siempre dentro de la semana
      return true;
    });
  }

  private getUserIdFromToken(): number | null {
    const token = localStorage.getItem('token');
    if (!token) return null;

    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const id = Number(payload.sub ?? payload.userId ?? payload.id);
      return Number.isFinite(id) && id > 0 ? id : null;
    } catch {
      return null;
    }
  }

  private hoyYMDAR(): string {
    const ahoraAR = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' })
    );
    const y = ahoraAR.getFullYear();
    const m = String(ahoraAR.getMonth() + 1).padStart(2, '0');
    const d = String(ahoraAR.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private cicloKey(c: any): string {
    const i = String(c?.cicloInicio ?? '').slice(0,10);
    const f = String((c?.cicloFin ?? c?.finVentana) ?? '').slice(0,10);
    return `${i}|${f}`;
  }

  toggleCiclo(ciclo: any) {
    const k = this.cicloKey(ciclo);
    if (this.expandedCiclos.has(k)) this.expandedCiclos.delete(k);
    else this.expandedCiclos.add(k);
  }

  isCicloExpandido(ciclo: any): boolean {
    return this.expandedCiclos.has(this.cicloKey(ciclo));
  }

  abrirHistorialCiclos() { this.modalHistorialCiclos = true; }
  cerrarHistorialCiclos() { this.modalHistorialCiclos = false; }

  private agruparCiclosPorAnio(ciclos: any[]): Array<{ anio: number; ciclos: any[] }> {
    const map = new Map<number, any[]>();
    for (const c of ciclos) {
      const inicio = (c.cicloInicio ?? '').slice(0, 10);
      const anio = inicio ? Number(inicio.slice(0, 4)) : 0;
      if (!map.has(anio)) map.set(anio, []);
      map.get(anio)!.push(c);
    }
    for (const [anio, arr] of map.entries()) {
      arr.sort((a, b) => (b.cicloInicio ?? '').localeCompare(a.cicloInicio ?? ''));
    }
    return Array.from(map.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([anio, ciclos]) => ({ anio, ciclos }));
  }

  // si querés, podés reutilizar tu quitarCiclosSolapados tal cual la del admin
  private quitarCiclosSolapados(ciclos: any[]): any[] {
    const norm = (c: any) => ({
      ...c,
      _ini: String(c?.cicloInicio ?? '').slice(0, 10),
      _fin: String((c?.cicloFin ?? c?.finVentana) ?? '').slice(0, 10),
    });

    const arr = (ciclos ?? [])
      .map(norm)
      .filter(c => c._ini && c._fin)
      .sort((a, b) => a._ini.localeCompare(b._ini)); // ASC

    const out: any[] = [];
    let lastFin = '';

    for (const c of arr) {
      if (!lastFin) { out.push(c); lastFin = c._fin; continue; }
      if (c._ini <= lastFin) continue; // solapa
      out.push(c);
      lastFin = c._fin;
    }

    return out.map(({ _ini, _fin, ...rest }) => rest);
  }

  get tieneHistorialFinalizado(): boolean {
    if (!this.historialPorAnio?.length) return false;
    return this.historialPorAnio.some(b => Array.isArray(b.ciclos) && b.ciclos.length > 0);
  }

  verMiAsistencia() {
    const userId = this.getUserIdFromToken();
    const nombre = localStorage.getItem('nombreUsuario') || '';
    const apellido = localStorage.getItem('apellidoUsuario') || '';

    if (!userId) return;

    this.http.get<any[]>(`${this.api}/reservas/asistencia-ciclos/${userId}`, {
      params: { _: Date.now().toString() }
    }).subscribe((ciclos) => {
      const hoy = this.hoyYMDAR();

      const ciclosLimpios = this.quitarCiclosSolapados(ciclos ?? [])
        .slice()
        .sort((a, b) => (b.cicloInicio ?? '').localeCompare(a.cicloInicio ?? ''));

      const cicloActual = ciclosLimpios.find(c => {
        const ini = String(c?.cicloInicio ?? '').slice(0, 10);
        const fin = String((c?.cicloFin || c?.finVentana || '')).slice(0, 10);
        return ini && fin && hoy >= ini && hoy <= fin;
      }) ?? null;

      this.asistenciaCicloActual = cicloActual;

      const anteriores = cicloActual
        ? ciclosLimpios.filter(c => c !== cicloActual)
        : ciclosLimpios;

      this.historialPorAnio = this.agruparCiclosPorAnio(anteriores);

      this.asistenciaNombre = nombre;
      this.asistenciaApellido = apellido;
      this.modalAsistencia = true;
    });
  }

  cerrarModalAsistencia() {
    this.modalAsistencia = false;
  }

  // ✅ Ordena fechas YYYY-MM-DD en forma ascendente (de más vieja a más nueva)
  ordenarFechasAsc(arr: string[] | null | undefined): string[] {
    if (!arr?.length) return [];
    return [...arr].sort((a, b) => a.localeCompare(b));
  }

  // ✅ Formato Argentina dd/MM/yyyy
  formatearFechaAR(ymd: string | null | undefined): string {
    if (!ymd) return '';
    const s = String(ymd).slice(0, 10);
    const [y, m, d] = s.split('-');
    if (!y || !m || !d) return s;
    return `${d}/${m}/${y}`;
  }

  private refrescarSaldoRecuperacionDesdeBackend() {
    const userId = this.getUserIdFromToken();
    if (!userId) return;

    this.http.get<any[]>(`${this.api}/reservas/asistencia-ciclos/${userId}`, {
      params: { _: Date.now().toString() }
    }).subscribe({
      next: (data) => {
        const ciclos = data ?? [];

        // Si no hay ciclos, limpiamos avisos/modales
        if (!ciclos.length) {
          this.avisoSemana = null;
          this.mostrarModalRecuperacion = false;
          this.yaMostradoModalRecuperacion = false;
          return;
        }

        const hoy = this.hoyYMDAR();

        // Ordenar por cicloInicio DESC (más nuevo primero)
        const ordenados = [...ciclos].sort((a, b) =>
          String(b?.cicloInicio ?? '').localeCompare(String(a?.cicloInicio ?? ''))
        );

        // ✅ Elegir ciclo vigente por FECHA (igual que admin)
        const cicloVigente = ordenados.find(c => {
          const ini = String(c?.cicloInicio ?? '').slice(0, 10);
          const fin = String((c?.cicloFin || c?.finVentana || '')).slice(0, 10);
          return ini && fin && hoy >= ini && hoy <= fin;
        }) ?? null;

        // Si no hay ciclo vigente hoy, no mostramos saldo
        const saldo = Number(cicloVigente?.saldoRecuperacion ?? 0);

        if (saldo > 0) {
          this.avisoSemana = {
            count: saldo,
            label: saldo > 1 ? 'recuperaciones disponibles' : 'recuperación disponible',
          };

          // Modal inicial (si lo querés mantener)
          if (!this.yaMostradoModalRecuperacion) {
            this.mostrarModalRecuperacion = true;
            this.yaMostradoModalRecuperacion = true;
          }
        } else {
          this.avisoSemana = null;
          this.mostrarModalRecuperacion = false;
          this.yaMostradoModalRecuperacion = false;
        }
      },
      error: () => {
        // si falla el endpoint, no rompas la pantalla
      },
    });
  }

  esCanceladaMomentanea(dia: string, hora: string): boolean {
    const r = this.getReserva(dia, hora);
    if (!r) return false;
    return String(r?.estado ?? '').toLowerCase() === 'cancelado'
      && r?.cancelacionMomentanea === true
      && r?.cancelacionPermanente !== true;
  }

}
