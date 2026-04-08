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
import { Notificacion } from 'src/notificaciones/notificacion.entity';

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
  nombre: string;
  apellido: string;
  plan: '4' | '8' | '12' | 'suelta';
  montoMensual: number;
  ultimaFechaPago: string | null;
  diasAtraso: number;
  estado: 'En término' | 'Atrasado';
  cicloInicio: string;
  cicloFin: string;
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

type ClasesOperacionVM = {
  anio: number;
  mes: number;
  clasesRealizadas: number;
  reservasTotales: number;
  clasesSuspendidasFeriado: number;
  clasesSuspendidasProfesora: number;
  topHorarios: Array<{ label: string; reservas: number }>;
};

type AlumnosAsistenciaVM = {
  anio: number; mes: number;
  alumnosActivos: number; 
  cancelaciones: number;
  recuperaciones: number;         
  nuevosAlumnos: number;
  distribucionPlanes: {
    plan4: number;
    plan8: number;
    plan12: number;
  };
};

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Pago) private pagosRepo: Repository<Pago>,
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(ValorPlan) private planesRepo: Repository<ValorPlan>,
    @InjectRepository(Reserva) private reservasRepo: Repository<Reserva>,   
    @InjectRepository(Horario) private horariosRepo: Repository<Horario>,
    @InjectRepository(Notificacion)
    private readonly notifRepo: Repository<Notificacion>, 
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
    const alumnosActivos = await this.usersRepo
      .createQueryBuilder('u')
      .where('u.activo = true')
      .andWhere("LOWER(COALESCE(u.rol, '')) NOT IN ('admin', 'superadmin')")
      .getCount();

    const alumnosPorPlan = await this.usersRepo
      .createQueryBuilder('u')
      .select('u.planMensual', 'planMensual')
      .addSelect('COUNT(*)', 'cantidad')
      .where('u.activo = true')
      .andWhere("LOWER(COALESCE(u.rol, '')) NOT IN ('admin', 'superadmin')")
      .andWhere("u.planMensual IN ('4','8','12')")
      .groupBy('u.planMensual')
      .getRawMany<{ planMensual: '4' | '8' | '12'; cantidad: string }>();

    const distribucionPlanes = {
      plan4: 0,
      plan8: 0,
      plan12: 0,
    };

    for (const row of alumnosPorPlan) {
      const cantidad = Number(row.cantidad || 0);
      if (row.planMensual === '4') distribucionPlanes.plan4 = cantidad;
      if (row.planMensual === '8') distribucionPlanes.plan8 = cantidad;
      if (row.planMensual === '12') distribucionPlanes.plan12 = cantidad;
    }

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

    // 3) Cancelaciones y recuperaciones
    const cancelaciones = reservas.filter(r => r.estado === 'cancelado').length;
    const recuperaciones = reservas.filter(r => r.estado === 'recuperada').length;

    // 4) Nuevos alumnos del mes (excluye admin)
    const nuevosAlumnos = await this.usersRepo.createQueryBuilder('u')
      .where('u.createdAt >= :start AND u.createdAt < :end', { start: startYMD, end: endYMD })
      .andWhere("LOWER(COALESCE(u.rol, '')) NOT IN ('admin', 'superadmin')")
      .getCount();

    return {
      anio, mes,
      alumnosActivos,
      cancelaciones,
      recuperaciones,
      nuevosAlumnos,
      distribucionPlanes,
    };
  }

  /* ================================
    Clases y Operación (OK)
    ================================ */
  async getClasesOperacion(anio: number, mes: number): Promise<ClasesOperacionVM> {
    const { startYMD, endYMD } = this.monthUtcRange(anio, mes);

    const reservasRaw = await this.reservasRepo.createQueryBuilder('r')
      .leftJoin('r.horario', 'h')
      .select([
        'r.id AS id',
        'r.estado AS estado',
        'r.fechaTurno AS "fechaTurno"',
        'h.id AS "horarioId"',
        'h.dia AS dia',
        'h.hora AS hora',
      ])
      .where('r.fechaTurno >= :start AND r.fechaTurno < :end', {
        start: startYMD,
        end: endYMD,
      })
      .getRawMany<any>();

    console.log('RESERVA RAW EJEMPLO:', reservasRaw[0]);

    const reservas = reservasRaw.map((r: any) => ({
      id: Number(r.id),
      estado: r.estado as 'reservado' | 'cancelado' | 'recuperada',
      fechaTurno: String(r.fechaTurno ?? r.fechaturno ?? ''),
      horarioId: Number(r.horarioId ?? r.horarioid ?? 0),
      dia: r.dia ? String(r.dia) : undefined,
      hora: r.hora ? String(r.hora) : undefined,
    }));

    const reservasValidas = reservas.filter(
      r => r.estado !== 'cancelado' && r.horarioId > 0 && !!r.fechaTurno
    );

    if (reservasValidas.length === 0) {
      return {
        anio,
        mes,
        clasesRealizadas: 0,
        reservasTotales: 0,
        clasesSuspendidasFeriado: 0,
        clasesSuspendidasProfesora: 0,
        topHorarios: [],
      };
    }

    // Clase realizada = fecha + horario con al menos una reserva no cancelada
    const sesionesRealizadas = new Set<string>();
    for (const r of reservasValidas) {
      sesionesRealizadas.add(`${r.fechaTurno}|${r.horarioId}`);
    }

    const clasesRealizadas = sesionesRealizadas.size;
    const reservasTotales = reservasValidas.length;

    const horarioIds = Array.from(new Set(reservasValidas.map(r => r.horarioId)));

    const horarios = horarioIds.length
      ? await this.horariosRepo.createQueryBuilder('h')
          .select(['h.id', 'h.dia', 'h.hora'])
          .where('h.id IN (:...ids)', { ids: horarioIds })
          .getMany()
      : [];

    const labelByHorario = new Map<number, string>(
      horarios.map(h => [Number(h.id), `${(h as any).dia ?? ''} ${(h as any).hora ?? ''}`.trim()])
    );

    const porHorario = new Map<number, number>();
    for (const r of reservasValidas) {
      porHorario.set(r.horarioId, (porHorario.get(r.horarioId) || 0) + 1);
    }

    const topHorarios = Array.from(porHorario.entries())
      .map(([hid, reservas]) => ({
        label: labelByHorario.get(hid) || `#${hid}`,
        reservas,
      }))
      .sort((a, b) => b.reservas - a.reservas)
      .slice(0, 8);

    const clasesSuspendidasFeriado = 0;
    const clasesSuspendidasProfesora = 0;

    return {
      anio,
      mes,
      clasesRealizadas,
      reservasTotales,
      clasesSuspendidasFeriado,
      clasesSuspendidasProfesora,
      topHorarios,
    };
  }

    /* ================================
    Finanazas
    ================================ */
  /** Resumen mensual para tarjetas y gráficos */
  async getResumenMensual(anio: number, mes: number): Promise<ResumenMensualVM> {
    const start = new Date(`${anio}-${String(mes).padStart(2, '0')}-01T00:00:00-03:00`);
    const endMes = mes === 12 ? 1 : mes + 1;
    const endAnio = mes === 12 ? anio + 1 : anio;
    const end = new Date(`${endAnio}-${String(endMes).padStart(2, '0')}-01T00:00:00-03:00`);

    const pagosMes = await this.pagosRepo.createQueryBuilder('p')
      .where('p.fechaPago IS NOT NULL')
      .andWhere('p.fechaPago >= :start AND p.fechaPago < :end', { start, end })
      .getMany();

    const ingresosTotalesARS = pagosMes.reduce((acc, p) => acc + (p.montoARS || 0), 0);
    const pagosCount = pagosMes.length;
    const ticketPromedioARS = pagosCount ? Math.round(ingresosTotalesARS / pagosCount) : 0;

    const basePorPlan: Record<PlanTipo, number> = {
      suelta: 0,
      '4': 0,
      '8': 0,
      '12': 0,
    };

    for (const p of pagosMes) {
      basePorPlan[p.planTipo] = (basePorPlan[p.planTipo] || 0) + (p.montoARS || 0);
    }

    const porDiaMap = new Map<number, number>();
    for (const p of pagosMes) {
      if (!p.fechaPago) continue;

      const d = new Date(p.fechaPago);
      const dia = d.getDate(); // mejor local que UTC para este caso
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
    // deudores por ciclo vigente (no pagado).

  const alumnosActivos = await this.usersRepo
    .createQueryBuilder('u')
    .select([
      'u.id',
      'u.nombre',
      'u.apellido',
      'u.telefono',
      'u.email',
      'u.planMensual',
      'u.rol',
    ])
    .where('u.activo = true')
    .andWhere("LOWER(COALESCE(u.rol, '')) NOT IN ('admin', 'superadmin')")
    .getMany();

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
        console.log('DEUDOR DEBUG', {
          id: a.id,
          alumno: `${a.apellido} ${a.nombre}`,
          ok: est?.ok,
          motivo: (est as any)?.motivo,
          cicloInicio: est?.cicloInicio,
          cicloFin: est?.cicloFin,
          isPago: est?.isPago,
        });

        if (!est?.cicloInicio || !est?.cicloFin) {
          console.log('OUT sin ciclo', a.id, a.apellido, a.nombre, est);
          return null;
        }

        // ✅ Si ya pagó, no es deudor
        if (est.isPago) {
          console.log('OUT ya pago', a.id, a.apellido, a.nombre);
          return null;
        }

        // ✅ Si el ciclo todavía no empezó, es GRIS, no deudor
        if (hoyYMD < est.cicloInicio) {
          console.log('OUT ciclo no empezó', a.id, {
            hoyYMD,
            cicloInicio: est.cicloInicio,
          });
          return null;
        }

        // ✅ Si no pagó pero todavía no pasó la primera clase del ciclo, sigue siendo GRIS
        const pasoPrimeraClase = await this.yaPasoPrimeraClaseDelCiclo(a.id, est.cicloInicio, est.cicloFin);
        console.log('PRIMERA CLASE', {
          id: a.id,
          alumno: `${a.apellido} ${a.nombre}`,
          pasoPrimeraClase,
          cicloInicio: est.cicloInicio,
          cicloFin: est.cicloFin,
        });

        if (!pasoPrimeraClase) {
          console.log('OUT no pasó primera clase', a.id, a.apellido, a.nombre);
          return null;
        }

        // días atraso: si ya pasó el cicloFin, cuenta días; si está dentro del ciclo, 0
        const fin = new Date(`${est.cicloFin}T00:00:00-03:00`);
        const hoy = new Date(`${hoyYMD}T00:00:00-03:00`);
        const diffMs = hoy.getTime() - fin.getTime();
        const diasAtraso = diffMs > 0 ? Math.floor(diffMs / (1000 * 60 * 60 * 24)) : 0;

        const vm: DeudorVM = {
          userId: a.id,
          nombre: a.nombre ?? '',
          apellido: a.apellido ?? '',
          plan: planTipo,
          montoMensual,
          ultimaFechaPago: est.pago?.fechaPago ? new Date(est.pago.fechaPago).toISOString() : null,
          diasAtraso,
          estado: 'Atrasado',
          cicloInicio: est.cicloInicio,
          cicloFin: est.cicloFin,
          contactos: {
            whatsapp: a.telefono ? `https://wa.me/54${String(a.telefono).replace(/\D/g, '')}` : null,
            telefono: a.telefono ?? null,
            email: a.email ?? null,
          },
        };

        return vm;
      } catch (e) {
        console.error('Error calculando deudor', a.id, a.apellido, a.nombre, e);
        return null;
      }
    });

    const items = results
      .filter((x): x is DeudorVM => !!x)
      // opcional: ordenar para que sea prolijo
      .sort((a, b) => {
        const ap = (a.apellido || '').localeCompare(b.apellido || '', 'es', { sensitivity: 'base' });
        if (ap !== 0) return ap;
        return (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' });
      });

    const totalDeudores = items.length;
    const totalAdeudadoARS = items.reduce((acc, i) => acc + (i.montoMensual || 0), 0);

    return { anio, mes, totalDeudores, totalAdeudadoARS, items };
  }

  async notificarDeudoresWhatsApp(anio: number, mes: number) {
    const deudores = await this.getDeudoresEntre1y10(anio, mes);

    console.log(
      'DEUDORES A NOTIFICAR:',
      deudores.totalDeudores,
      deudores.items.map(x => ({
        userId: x.userId,
        alumno: `${x.apellido} ${x.nombre}`,
        telefono: x.contactos.telefono,
        estado: x.estado
      }))
    );

    const resultados: Array<{ userId: number; ok: boolean; error?: string }> = [];

    for (const item of deudores.items) {
        console.log('INTENTANDO ENVIAR A:', {
          userId: item.userId,
          alumno: `${item.apellido} ${item.nombre}`,
          telefono: item.contactos.telefono
        });
      if (item.estado !== 'Atrasado') continue;

      const nombre = (item.nombre || '').trim() || 'alumno/a';
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
        console.log('✅ ENVIADO OK', item.userId, E164);

        // ✅ REGISTRAR EN TABLA notificaciones
        await this.notifRepo.insert({
          usuarioId: item.userId,
          tipo: 'plan_vencido',
          cicloInicio: item.cicloInicio,
          cicloFin: item.cicloFin,
          fechaAviso: new Date().toISOString().slice(0, 10),
        } as any);

        resultados.push({ userId: item.userId, ok: true });
      } catch (e: any) {
        console.log('❌ ERROR EN ENVIO', item.userId, e?.message);
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

  private async yaPasoPrimeraClaseDelCiclo(userId: number, cicloInicio: string, cicloFin: string): Promise<boolean> {
    const candidatas = await this.reservasRepo.createQueryBuilder('r')
      .leftJoin('r.horario', 'h')
      .leftJoin('r.usuario', 'u')
      .select([
        'r.id AS id',
        'r.fechaTurno AS fechaTurno',
        'r.estado AS estado',
        'h.hora AS hora',
        'h.dia AS dia',
      ])
      .where('u.id = :userId', { userId })
      .andWhere('r.fechaTurno >= :inicio AND r.fechaTurno <= :fin', {
        inicio: cicloInicio,
        fin: cicloFin,
      })
      .orderBy('r.fechaTurno', 'ASC')
      .addOrderBy('h.hora', 'ASC')
      .getRawMany<any>();

    console.log('CANDIDATAS PRIMERA CLASE', {
      userId,
      cicloInicio,
      cicloFin,
      candidatas,
    });

    const primera = candidatas[0];

    console.log('PRIMERA RESERVA TOMADA', {
      userId,
      cicloInicio,
      cicloFin,
      primera,
    });

    const rawFecha = primera?.fechaTurno ?? primera?.fechaturno;
    if (!rawFecha) return false;

    const fechaYMD =
      typeof rawFecha === 'string'
        ? rawFecha.slice(0, 10)
        : new Date(rawFecha).toISOString().slice(0, 10);

    const yaPaso = this.turnoYaPaso(fechaYMD, primera.hora);

    console.log('RESULTADO turnoYaPaso', {
      userId,
      rawFecha,
      fechaYMD,
      hora: primera.hora,
      yaPaso,
      ahoraServidor: new Date().toISOString(),
    });

    return yaPaso;
  }
}  

