import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Pago } from '../pagos/pagos.entity';
import { User } from '../users/user.entity';
import { ValorPlan, PlanTipo } from '../valor-planes/valor-planes.entity';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { Horario } from 'src/horarios/horarios.entity';
import { Reserva } from 'src/reserva/reserva.entity';
import { PagosService } from 'src/pagos/pagos.service';

type ResumenMensualVM = {
  anio: number;
  mes: number;
  ingresosTotalesARS: number;
  pagosCount: number;
  ticketPromedioARS: number;
  porPlan: Record<PlanTipo, number>;
  porDia: Array<{ dia: number; monto: number }>;
};

type DeudorVM = {
  userId: number;
  alumno: string;
  plan: '4' | '8' | '12' | 'suelta';
  montoMensual: number;
  ultimaFechaPago: string | null;
  diasAtraso: number;
  estado: 'En término' | 'Atrasado';
  contactos: {
    whatsapp?: string | null;
    telefono?: string | null;
    email?: string | null;
  };
};

type DeudoresResp = {
  anio: number;
  mes: number;
  totalDeudores: number;
  totalAdeudadoARS: number;
  items: DeudorVM[];
};

type AlumnosAsistenciaVM = {
  anio: number; mes: number;
  alumnosActivos: number;
  asistenciaPromedioPct: number;  
  cancelaciones: number;
  recuperaciones: number;         
  nuevosAlumnos: number;
  rankingTop5: Array<{ alumno: string; pct: number }>;
};

type ClasesOperacionVM = {
  anio: number; mes: number;
  clasesDictadas: number;          // sesiones con actividad (ver nota)
  tasaOcupacionPct: number;        // 0..100
  capacidadLibrePerdida: number;   // asientos no usados x cancelaciones no recuperadas
  topHorarios: Array<{ label: string; ocupacionPct: number }>;
};

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Pago) private pagosRepo: Repository<Pago>,
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(ValorPlan) private planesRepo: Repository<ValorPlan>,
    @InjectRepository(Reserva) private reservasRepo: Repository<Reserva>,   
    @InjectRepository(Horario) private horariosRepo: Repository<Horario>, 
    private readonly whatsapp: WhatsAppService,
    private pagosSrv: PagosService,
  ) {}

  private labelHorario(h: Partial<Horario>) {
    return `${(h as any).dia ?? ''} ${(h as any).hora ?? ''}`.trim();
  }

  // Helpers ya usados
  private monthUtcRange(anio: number, mes1a12: number) {
    const start = new Date(Date.UTC(anio, mes1a12 - 1, 1, 0, 0, 0));
    const end   = new Date(Date.UTC(anio, mes1a12, 1, 0, 0, 0));
    // devolvemos YYYY-MM-DD para comparar contra columna 'date'
    const toYMD = (d: Date) => d.toISOString().slice(0,10);
    return { start, end, startYMD: toYMD(start), endYMD: toYMD(end) };
  }

  /** AR: fechaTurno + hora (HH:mm) → ¿ya pasó? */
  private turnoYaPaso(fechaTurnoYMD: string, horaHHmm?: string) {
    const hora = (horaHHmm ?? '00:00').padStart(5,'0');
    // -03:00 Córdoba/BsAs. Ajustá si usás TZ server distinta.
    const fechaHoraLocal = new Date(`${fechaTurnoYMD}T${hora}:00-03:00`);
    return fechaHoraLocal.getTime() <= Date.now();
  }

  /* ================================
    Alumnos y Asistencia (OK)
    ================================ */
  async getAlumnosAsistencia(anio: number, mes: number): Promise<AlumnosAsistenciaVM> {
    const { startYMD, endYMD } = this.monthUtcRange(anio, mes);

    // 1) Alumnos activos (no admin) — si querés “vigente = pago al día”, acá podés cruzar con pagos del mes.
    const alumnosActivos = await this.usersRepo.count({
      where: { activo: true, rol: Not('admin') } as any,
    });

    // 2) Traer reservas del mes con joins para poder usar usuario/hora
    //    Seleccionamos solo lo necesario y usamos getRawMany
    const reservas = await this.reservasRepo.createQueryBuilder('r')
      .leftJoin('r.usuario', 'u')
      .leftJoin('r.horario', 'h')
      .select([
        'r.id AS id',
        'r.estado AS estado',
        'r.automatica AS automatica',
        'r.cancelacionMomentanea AS cancelacionMomentanea',
        'r.fechaTurno AS fechaTurno',
        'u.id AS userId',
        'h.id AS horarioId',
        'h.hora AS hora',
      ])
      .where('r.fechaTurno >= :start AND r.fechaTurno < :end', { start: startYMD, end: endYMD })
      .getRawMany<{
        id: number; estado: 'reservado'|'cancelado'|'recuperada'; automatica: boolean;
        cancelacionMomentanea: boolean; fechaTurno: string; userId: number; horarioId: number; hora?: string;
      }>();

    // Definiciones:
    // - "reservadas (efectivas)" = estado != 'cancelado'
    // - "asistidas" = (estado='recuperada') OR (estado='reservado' y el turno ya pasó)
    const reservadasEfectivas = reservas.filter(r => r.estado !== 'cancelado');
    const asistidas = reservas.filter(r =>
      r.estado === 'recuperada' || (r.estado === 'reservado' && this.turnoYaPaso(r.fechaTurno, r.hora))
    );

    const asistenciaPromedioPct = reservadasEfectivas.length
      ? Math.round((asistidas.length / reservadasEfectivas.length) * 100)
      : 0;

    // 3) Cancelaciones y recuperaciones
    const cancelaciones = reservas.filter(r => r.estado === 'cancelado').length;
    const recuperaciones = reservas.filter(r => r.estado === 'recuperada').length;

    // 4) Nuevos alumnos del mes (excluye admin)
    const nuevosAlumnos = await this.usersRepo.createQueryBuilder('u')
      .where('u.createdAt >= :start AND u.createdAt < :end', { start: startYMD, end: endYMD })
      .andWhere('(u.rol IS NULL OR u.rol != :admin)', { admin: 'admin' })
      .getCount();

    // 5) Ranking Top 5 por % asistencia (mín. 3 reservas efectivas)
    const MIN_RESERVAS = 3;
    const totByUser = new Map<number, number>();
    const asisByUser = new Map<number, number>();

    for (const r of reservas) {
      if (r.estado !== 'cancelado') {
        totByUser.set(r.userId, (totByUser.get(r.userId) || 0) + 1);
      }
      const contoAsistencia = (r.estado === 'recuperada') || (r.estado === 'reservado' && this.turnoYaPaso(r.fechaTurno, r.hora));
      if (contoAsistencia) {
        asisByUser.set(r.userId, (asisByUser.get(r.userId) || 0) + 1);
      }
    }

    const userIds = Array.from(totByUser.keys());
    const users = userIds.length
      ? await this.usersRepo.createQueryBuilder('u')
          .select(['u.id','u.nombre','u.apellido'])
          .where('u.id IN (:...ids)', { ids: userIds })
          .getMany()
      : [];
    const nameById = new Map<number, string>(users.map(u => [u.id, `${u.nombre ?? ''} ${u.apellido ?? ''}`.trim()]));

    const rankingTop5 = userIds
      .map(uid => {
        const tot = totByUser.get(uid) || 0;
        const asis = asisByUser.get(uid) || 0;
        const pct = tot ? Math.round((asis / tot) * 100) : 0;
        return { alumno: nameById.get(uid) || `#${uid}`, pct, tot };
      })
      .filter(x => x.tot >= MIN_RESERVAS)
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 5)
      .map(x => ({ alumno: x.alumno, pct: x.pct }));

    return {
      anio, mes,
      alumnosActivos,
      asistenciaPromedioPct,
      cancelaciones,
      recuperaciones,
      nuevosAlumnos,
      rankingTop5,
    };
  }

  /* ================================
    Clases y Operación (OK)
    ================================ */
  async getClasesOperacion(anio: number, mes: number): Promise<ClasesOperacionVM> {
    const { startYMD, endYMD } = this.monthUtcRange(anio, mes);

    // Reservas del mes + capacidad por horario
    const reservas = await this.reservasRepo.createQueryBuilder('r')
      .leftJoin('r.horario', 'h')
      .select([
        'r.id AS id',
        'r.estado AS estado',
        'r.fechaTurno AS fechaTurno',
        'h.id AS horarioId',
        'h.hora AS hora',
        'h.totalReformers AS capacidad',   // 👈 tu Horario usa totalReformers como capacidad
      ])
      .where('r.fechaTurno >= :start AND r.fechaTurno < :end', { start: startYMD, end: endYMD })
      .getRawMany<{
        id: number; estado: 'reservado'|'cancelado'|'recuperada'; fechaTurno: string;
        horarioId: number; hora?: string; capacidad: number;
      }>();

    if (reservas.length === 0) {
      return { anio, mes, clasesDictadas: 0, tasaOcupacionPct: 0, capacidadLibrePerdida: 0, topHorarios: [] };
    }

    // Agregar label por horario
    const horarioIds = Array.from(new Set(reservas.map(r => r.horarioId)));
    const horarios = await this.horariosRepo.createQueryBuilder('h')
      .select(['h.id','h.dia','h.hora','h.totalReformers'])
      .where('h.id IN (:...ids)', { ids: horarioIds })
      .getMany();
    const labelByHorario = new Map<number, string>(horarios.map(h => [h.id, this.labelHorario(h)]));

    // Agrupar por sesión (horarioId + fecha)
    type Sesion = {
      horarioId: number; key: string; capacidad: number;
      reservasNoCanceladas: number;
      asistidas: number;
      canceladas: number; // momentáneas (aprox: estado = 'cancelado')
    };
    const pad2 = (n:number)=> String(n).padStart(2,'0');
    const keyOf = (ymd: string, hid: number) => `${ymd}|${hid}`;

    const sesiones = new Map<string, Sesion>();

    for (const r of reservas) {
      const key = keyOf(r.fechaTurno, r.horarioId);
      const cap = Number(r.capacidad) || 0;
      const s = sesiones.get(key) ?? {
        horarioId: r.horarioId,
        key,
        capacidad: cap,
        reservasNoCanceladas: 0,
        asistidas: 0,
        canceladas: 0,
      };

      if (r.estado !== 'cancelado') s.reservasNoCanceladas += 1;

      // asistencia efectiva := recuperada  OR (reservado y ya pasó)
      const contoAsistencia = (r.estado === 'recuperada') || (r.estado === 'reservado' && this.turnoYaPaso(r.fechaTurno, reservas.find(x => x.horarioId===r.horarioId && x.fechaTurno===r.fechaTurno)?.hora));
      if (contoAsistencia) s.asistidas += 1;

      if (r.estado === 'cancelado') s.canceladas += 1;

      sesiones.set(key, s);
    }

    const sesionesArr = Array.from(sesiones.values());

    // Clases dictadas = sesiones con actividad (≥1 reserva en DB)
    const clasesDictadas = sesionesArr.length;

    // Ocupación mensual = sum(min(asistidas, capacidad)) / sum(capacidad)
    const sumAsientosOcup = sesionesArr.reduce((acc, s) => acc + Math.min(s.asistidas, s.capacidad), 0);
    const sumCapacidad    = sesionesArr.reduce((acc, s) => acc + s.capacidad, 0);
    const tasaOcupacionPct = sumCapacidad > 0 ? Math.round((sumAsientosOcup / sumCapacidad) * 100) : 0;

    // Capacidad libre perdida por cancelaciones no recuperadas (aprox):
    // pérdida sesión = min(canceladas, max(0, capacidad - asistidas))
    const capacidadLibrePerdida = sesionesArr.reduce((acc, s) => {
      const huecos = Math.max(0, s.capacidad - s.asistidas);
      return acc + Math.min(s.canceladas, huecos);
    }, 0);

    // Top horarios por % ocupación (sobre sus sesiones con actividad)
    const porHorario = new Map<number, { asis: number; cap: number }>();
    for (const s of sesionesArr) {
      const agg = porHorario.get(s.horarioId) ?? { asis: 0, cap: 0 };
      agg.asis += Math.min(s.asistidas, s.capacidad);
      agg.cap  += s.capacidad;
      porHorario.set(s.horarioId, agg);
    }

    const topHorarios = Array.from(porHorario.entries())
      .map(([hid, v]) => ({
        label: labelByHorario.get(hid) || `#${hid}`,
        ocupacionPct: v.cap > 0 ? Math.round((v.asis / v.cap) * 100) : 0,
      }))
      .sort((a,b) => b.ocupacionPct - a.ocupacionPct)
      .slice(0, 8);

    return {
      anio, mes,
      clasesDictadas,
      tasaOcupacionPct,
      capacidadLibrePerdida,
      topHorarios,
    };
  }

    /* ================================
    Finanazas
    ================================ */
  /** Resumen mensual para tarjetas y gráficos */
  async getResumenMensual(anio: number, mes: number): Promise<ResumenMensualVM> {
    const pagosMes = await this.pagosRepo.find({ where: { anio, mes } });

    const ingresosTotalesARS = pagosMes.reduce((acc, p) => acc + (p.montoARS || 0), 0);
    const pagosCount = pagosMes.length;
    const ticketPromedioARS = pagosCount ? Math.round(ingresosTotalesARS / pagosCount) : 0;

    // porPlan (incluimos claves para todos los tipos por seguridad)
    const basePorPlan: Record<PlanTipo, number> = {
      suelta: 0,
      '4': 0,
      '8': 0,
      '12': 0,
    };
    for (const p of pagosMes) {
      basePorPlan[p.planTipo] = (basePorPlan[p.planTipo] || 0) + (p.montoARS || 0);
    }

    // porDia
    const porDiaMap = new Map<number, number>();
    for (const p of pagosMes) {
      if (!p.fechaPago) continue;
      const d = new Date(p.fechaPago);
      const dia = d.getUTCDate(); // usamos UTC para evitar problemas de TZ del server
      porDiaMap.set(dia, (porDiaMap.get(dia) || 0) + p.montoARS);
    }
    const porDia = Array.from(porDiaMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([dia, monto]) => ({ dia, monto }));

    return {
      anio,
      mes,
      ingresosTotalesARS,
      pagosCount,
      ticketPromedioARS,
      porPlan: basePorPlan,
      porDia,
    };
  }

  /**
   * Deudores del 1 al 10:
   * - Toma alumnos activos (User.activo = true)
   * - Saca quienes registraron pago entre el 1 y el 10 (inclusive) del mes/anio
   * - Para el resto, calcula monto por plan (valor_planes) y marca "Atrasado" si el corte ya pasó.
   */
  async getDeudoresEntre1y10(anio: number, mes: number): Promise<DeudoresResp> {
    // ✅ YA NO ES "1 al 10". Es "deudores por ciclo vigente (no pagado)".

    const alumnosActivos = await this.usersRepo.find({
      where: { activo: true, rol: Not('admin') } as any,
      select: ['id', 'nombre', 'apellido', 'telefono', 'email', 'planMensual', 'rol'],
    });

    const planes = await this.planesRepo.find();
    const precioPorPlan = new Map<PlanTipo, number>(planes.map(p => [p.tipo, p.precioARS]));

    // ✅ usar la misma fecha AR que el resto del sistema
    const hoyYMD = (this.pagosSrv as any).ymdTodayAR
      ? (this.pagosSrv as any).ymdTodayAR()
      : new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
          .toISOString()
          .slice(0, 10);

    // --- helper: map con límite de concurrencia ---
    async function mapLimit<T, R>(
      arr: T[],
      limit: number,
      fn: (item: T, idx: number) => Promise<R>,
    ): Promise<R[]> {
      const out: R[] = new Array(arr.length);
      let i = 0;

      const workers = new Array(Math.min(limit, arr.length)).fill(0).map(async () => {
        while (true) {
          const idx = i++;
          if (idx >= arr.length) break;
          out[idx] = await fn(arr[idx], idx);
        }
      });

      await Promise.all(workers);
      return out;
    }

    // ✅ IMPORTANTE: concurrencia moderada (8–15 suele andar perfecto)
    const results = await mapLimit(alumnosActivos, 10, async (a) => {
      try {
        const planTipo = (['4', '8', '12', 'suelta'] as const).includes(a.planMensual as any)
          ? (a.planMensual as '4' | '8' | '12' | 'suelta')
          : '4';

        const montoMensual = precioPorPlan.get(planTipo as any) ?? 0;

        const est = await this.pagosSrv.estadoCicloActual(a.id);

        // si no hay ciclo calculable => no lo mostramos en deudores
        if (!est?.cicloInicio || !est?.cicloFin) return null;

        // ✅ DEUDOR = NO pagó el ciclo vigente (rojo)
        if (est.isPago) return null;

        // días atraso: si ya pasó el cicloFin, cuenta días; si está dentro del ciclo, 0
        const fin = new Date(`${est.cicloFin}T00:00:00-03:00`);
        const hoy = new Date(`${hoyYMD}T00:00:00-03:00`);
        const diffMs = hoy.getTime() - fin.getTime();
        const diasAtraso = diffMs > 0 ? Math.floor(diffMs / (1000 * 60 * 60 * 24)) : 0;

        const vm: DeudorVM = {
          userId: a.id,
          alumno: `${a.nombre} ${a.apellido}`.trim(),
          plan: planTipo,
          montoMensual,
          ultimaFechaPago: est.pago?.fechaPago ? new Date(est.pago.fechaPago).toISOString() : null,
          diasAtraso,
          estado: 'Atrasado',
          contactos: {
            whatsapp: a.telefono ? `https://wa.me/54${String(a.telefono).replace(/\D/g, '')}` : null,
            telefono: a.telefono ?? null,
            email: a.email ?? null,
          },
        };

        return vm;
      } catch (e) {
        // ✅ no rompas todo el listado por 1 alumno que falla
        return null;
      }
    });

    const items = results
      .filter((x): x is DeudorVM => !!x)
      // opcional: ordenar para que sea prolijo
      .sort((a, b) => a.alumno.localeCompare(b.alumno, 'es'));

    const totalDeudores = items.length;
    const totalAdeudadoARS = items.reduce((acc, i) => acc + (i.montoMensual || 0), 0);

    return { anio, mes, totalDeudores, totalAdeudadoARS, items };
  }


  async notificarDeudoresWhatsApp(anio: number, mes: number) {
    const deudores = await this.getDeudoresEntre1y10(anio, mes);

    const resultados: Array<{ userId: number; ok: boolean; error?: string }> = [];

    for (const item of deudores.items) {
      // Por seguridad, aunque la lista ya trae solo atrasados, volvemos a chequear:
      if (item.estado !== 'Atrasado') continue;

      const nombre = item.alumno || 'alumno/a';
      const E164 = this.toE164(item.contactos.telefono);

      if (!E164) {
        resultados.push({
          userId: item.userId,
          ok: false,
          error: 'Teléfono inválido',
        });
        continue;
      }

      // Descripción del plan para el template
      let planTypeDesc: string;
      if (item.plan === 'suelta') {
        planTypeDesc = 'clases sueltas';
      } else {
        planTypeDesc = `${item.plan} clases / mes`;
      }

      try {
        // Tu WhatsAppService: sendTemplatePlanVencido(to, nombre, planType)
        await this.whatsapp.sendTemplatePlanVencido(E164, nombre, planTypeDesc);

        resultados.push({ userId: item.userId, ok: true });
      } catch (e: any) {
        resultados.push({
          userId: item.userId,
          ok: false,
          error: e?.message ?? 'Error',
        });
      }
    }

    return {
      enviados: resultados.filter(r => r.ok).length,
      resultados,
    };
  }


  private toE164(raw?: string | null): string | null {
    if (!raw) return null;
    let digits = raw.replace(/\D/g, '');
    if (digits.startsWith('549')) return `+${digits}`;
    if (digits.startsWith('54') && digits.length >= 11) return `+${digits}`;
    if (digits.length >= 10 && !digits.startsWith('0')) return `+549${digits}`;
    return null;
  }
  
}  

