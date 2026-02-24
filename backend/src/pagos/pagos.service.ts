import { Injectable, BadRequestException } from '@nestjs/common';
import { LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Pago } from './pagos.entity';
import { UpsertPagoDto } from './dto/upsert-pago.dto';
import { ReservaService } from 'src/reserva/reserva.service';
import { UpsertPagoCicloDto } from './dto/upsert-pago-ciclo.dto';

type PlanTipo = 'suelta'|'4'|'8'|'12';

@Injectable()
export class PagosService {
  constructor(@InjectRepository(Pago) private repo: Repository<Pago>,
  private reservaService: ReservaService,
) {}

  // --- helpers de fecha AR ---
  private nowInArgentina(): Date {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
  }

  private ymdTodayAR(): string {
    const d = this.nowInArgentina();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private addDaysYMD(ymd: string, days: number) {
    const d = new Date(`${ymd}T00:00:00-03:00`);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0,10);
  }


  private async getCicloCobroActual(userId: number, hoyYMD: string): Promise<{
    cicloInicio: string;
    cicloFin: string;
    // opcional para debug/UI:
    base?: any;
    } | null> {

    const cicloActivo = await this.reservaService.getCicloPlanActual(userId, hoyYMD);

    if (cicloActivo) {
      const inicio = String(cicloActivo.inicio).slice(0, 10);
      const finVentana = String(cicloActivo.finVentana).slice(0, 10);

      // ✅ Mientras esté dentro del ciclo activo, el cobro corresponde a ese ciclo
      return { cicloInicio: inicio, cicloFin: finVentana, base: cicloActivo };
    }

    // ✅ Si no hay ciclo activo (por ejemplo: ya terminó la última clase),
    // buscamos el último ciclo conocido y calculamos el próximo cobro.
    const last = await this.reservaService.getUltimoCicloPorCantidad(userId, hoyYMD);
    if (!last) return null;

    const baseFin = String(last.finReal || last.finVentana).slice(0, 10);
    const inicioCobro = this.addDaysYMD(baseFin, 1);
    const finCobro = this.addDaysYMD(inicioCobro, 29);

    return { cicloInicio: inicioCobro, cicloFin: finCobro, base: last };
  }

  
  // ✅ NUEVO: estado del pago por CICLO (esto pinta el $)
// pagos.service.ts (BACKEND)

  private pickCicloKeyDesdeAsistencia(ciclos: any[], hoy: string) {
    const ymd = (x: any) => String(x ?? '').slice(0, 10);

    const vigente = (ciclos ?? []).find(c => {
      const ini = ymd(c.cicloInicio);
      const finVentana = ymd(c.finVentana);
      return ini && finVentana && hoy >= ini && hoy <= finVentana;
    });

    const mkNext = (finBase: string) => {
      const inicioCobro = this.addDaysYMD(finBase, 1);
      const finCobro = this.addDaysYMD(inicioCobro, 29);
      return { cicloInicio: inicioCobro, cicloFin: finCobro, cicloActual: null, prePago: false };
    };

    // ✅ Si hay vigente…
    if (vigente) {
      const cicloInicio = ymd(vigente.cicloInicio);
      const cicloFin = ymd(vigente.finVentana);

      const planMax = Number(vigente.planMax ?? 0);
      const usadas = Number(vigente.usadasALaFecha ?? 0);
      const completo = Boolean(vigente.completo) || (planMax > 0 && usadas >= planMax);

      // 🔑 Si está completo, el cobro corresponde al “próximo ciclo”
      if (completo) {
        const finReal = ymd(vigente.finReal) || ymd(vigente.cicloFin) || ymd(vigente.finVentana);
        if (!finReal) return null;
        return { ...mkNext(finReal), prePago: true }; // “habilitado para pagar nuevo ciclo”
      }

      // Si NO está completo => cobro del ciclo vigente
      return { cicloInicio, cicloFin, cicloActual: vigente, prePago: false };
    }

    // ✅ Si NO hay vigente hoy => próximo cobro desde el último ciclo
    const last = [...(ciclos ?? [])].sort((a, b) =>
      ymd(b.cicloInicio).localeCompare(ymd(a.cicloInicio))
    )[0];

    const finBase = ymd(last?.finReal) || ymd(last?.cicloFin) || ymd(last?.finVentana);
    if (!finBase) return null;

    return mkNext(finBase);
  }

  async estadoCicloActual(userId: number) {
    const hoy = this.ymdTodayAR();

    const ciclos = await this.reservaService.getAsistenciaCiclos(userId);
    if (!ciclos?.length) return { userId, ok: false, motivo: 'Sin ciclos' };

    const picked = this.pickCicloKeyDesdeAsistencia(ciclos, hoy);
    if (!picked) return { userId, ok: false, motivo: 'No se pudo resolver ciclo cobro' };

    const { cicloInicio, cicloFin, cicloActual, prePago } = picked;

    // 1) Primero intento match exacto (si existe)
    let pago = await this.repo.findOne({ where: { userId, cicloInicio, cicloFin } });

    // 2) Si NO hay, busco un pago que CONTENGA el ciclo actual completo
    if (!pago) {
      pago = await this.repo.findOne({
        where: {
          userId,
          cicloInicio: LessThanOrEqual(cicloInicio), // empieza antes o igual al inicio del ciclo actual
          cicloFin: MoreThanOrEqual(cicloFin),       // termina después o igual al fin del ciclo actual
        },
        order: { fechaPago: 'DESC' as any },
      });
    }

    // 3) Si NO hay pago del ciclo actual ni solapado, busco pago ADELANTADO
    let pagoAdelantado = false;

    if (!pago) {
      const hoy = this.ymdTodayAR();

      const nextPago = await this.repo.findOne({
        where: {
          userId,
          cicloInicio: MoreThanOrEqual(this.addDaysYMD(hoy, 1)), // estrictamente futuro
        } as any,
        order: { cicloInicio: 'ASC' as any, fechaPago: 'DESC' as any },
      });

      if (nextPago) {
        pago = nextPago;
        pagoAdelantado = true;
      }
    }


    const isPago = !!pago?.fechaPago;
    const pagoMatch =
      !pago ? 'none'
      : pagoAdelantado ? 'adelantado'
      : (pago.cicloInicio === cicloInicio && pago.cicloFin === cicloFin ? 'exacto' : 'solapado');


    // métricas SOLO si hay cicloActual (si es “próximo cobro”, puede no tener asistencias aún)
    const planMax = Number(cicloActual?.planMax ?? 0);
    const usadasALaFecha = Number(cicloActual?.usadasALaFecha ?? 0);
    const restantesPlan = planMax > 0 ? Math.max(0, planMax - usadasALaFecha) : 0;

    // ✅ Fases según tu política
    // - ok (verde): pagado para ese ciclo
    // - warn (gris): por vencer (resta 1 clase) OR prePago (ya habilitado a pagar nuevo ciclo)
    // - vencido (rojo): no pagó y ya usó >= 1 clase del ciclo vigente
    let fase: 'ok' | 'warn' | 'vencido';

    if (isPago) {
      fase = 'ok'; 
    } else if (prePago) {
      fase = 'warn';
    } else if (restantesPlan === 1) {
      fase = 'warn';
    } else {
      fase = usadasALaFecha >= 1 ? 'vencido' : 'warn';
    }

    return {
      userId,
      ok: true,
      cicloInicio,
      cicloFin,
      isPago,
      pago: pago ?? null,
      planMax,
      usadasALaFecha,
      restantesPlan,
      fase,
      prePago,
      pagoMatch,
    };
  }

  /**
   * 🔑 CLAVE: acá poné la misma regla que usa tu ReservaService para finVentana.
   * Si tu ventana es "inicio + 30 días", dejalo así.
   * Si es otra (28, 31, etc.), ajustalo.
   */
  private calcularFinVentanaDesdeInicio(inicioYMD: string) {
    // EJEMPLO: ventana de 30 días
    return this.addDaysYMD(inicioYMD, 29);
  }

  async upsertConfirmadoCiclo(dto: UpsertPagoCicloDto) {
    const hoy = this.ymdTodayAR();

    const ciclos = await this.reservaService.getAsistenciaCiclos(dto.userId);
    if (!ciclos?.length) throw new BadRequestException('Sin ciclos para el usuario');

    const picked = this.pickCicloKeyDesdeAsistencia(ciclos, hoy);
    if (!picked) throw new BadRequestException('No se pudo resolver ciclo cobro');

    const { cicloInicio, cicloFin } = picked;

    const row = {
      userId: dto.userId,
      planTipo: dto.planTipo,
      montoARS: dto.montoARS,
      metodo: dto.metodo,
      notas: dto.notas,
      cicloInicio,
      cicloFin,
      mes: null,
      anio: null,
      fechaPago: this.nowInArgentina(),
    };

    await this.repo.upsert(row, { conflictPaths: ['userId', 'cicloInicio', 'cicloFin'] });

    return this.repo.findOne({ where: { userId: dto.userId, cicloInicio, cicloFin } });
  }
  
  // --- (Opcional) LEGACY por mes/año ---
  async estadoPorMes(userId: number, mes: number, anio: number) {
    const pago = await this.repo.findOne({ where: { userId, mes, anio } });
    return { userId, mes, anio, isPago: !!(pago?.fechaPago), pago };
  }
 
  async historial(userId: number, anio?: number) {
    const qb = this.repo.createQueryBuilder('p')
      .where('p.userId = :userId', { userId })
      .select([
        'p.id        AS "id"',
        'p.cicloInicio AS "cicloInicio"',
        'p.cicloFin  AS "cicloFin"',
        'p.fechaPago AS "fechaPago"',
        'p.planTipo  AS "planTipo"',
        'p.montoARS  AS "montoARS"',
        'p.metodo    AS "metodo"',
        'p.notas     AS "notas"',
      ]);

    if (anio) {
      const start = new Date(Date.UTC(anio, 0, 1, 0, 0, 0));
      const end   = new Date(Date.UTC(anio + 1, 0, 1, 0, 0, 0));
      qb.andWhere('p.fechaPago >= :start AND p.fechaPago < :end', { start, end });
    }

    const pagos = await qb
      .orderBy('p.fechaPago', 'DESC')
      .addOrderBy('p.createdAt', 'DESC')
      .getRawMany();

    return { userId, historial: pagos };
  }

  async resumenMensual(anio: number, mes: number) {
    // rango UTC del mes (sirve bien para timestamptz)
    const start = new Date(`${anio}-${String(mes).padStart(2,'0')}-01T00:00:00-03:00`);
    const endMes = mes === 12 ? 1 : mes + 1;
    const endAnio = mes === 12 ? anio + 1 : anio;
    const end = new Date(`${endAnio}-${String(endMes).padStart(2,'0')}-01T00:00:00-03:00`);


    const rows = await this.repo.createQueryBuilder('p')
      .innerJoin('p.user', 'u')
      .where('p.fechaPago IS NOT NULL')
      .andWhere('p.fechaPago >= :start AND p.fechaPago < :end', { start, end })
      .select([
        'p.userId      AS "userId"',
        'u.apellido    AS "apellido"',
        'u.nombre      AS "nombre"',
        'p.fechaPago   AS "fechaPago"',
        'p.planTipo    AS "planTipo"',
        'p.montoARS    AS "montoARS"',
        'p.metodo      AS "metodo"',
      ])
      .orderBy('p.fechaPago', 'DESC')
      .addOrderBy('u.apellido', 'ASC')
      .addOrderBy('u.nombre', 'ASC')
      .getRawMany<{
        userId: number; apellido: string; nombre: string;
        fechaPago: Date; planTipo: PlanTipo; montoARS: number; metodo?: string;
      }>();

    const ingresosTotalesARS = rows.reduce((a, r) => a + (Number(r.montoARS) || 0), 0);
    const pagosCount = rows.length;

    const porPlan: Record<PlanTipo, number> = { suelta: 0, '4': 0, '8': 0, '12': 0 };
    for (const r of rows) porPlan[r.planTipo] += Number(r.montoARS) || 0;

    return {
      anio, mes,
      ingresosTotalesARS,
      pagosCount,
      porPlan,
      items: rows.map(r => ({
        userId: r.userId,
        apellido: r.apellido ?? '',
        nombre: r.nombre ?? '',
        fechaPago: r.fechaPago,
        planTipo: r.planTipo,
        montoARS: Number(r.montoARS) || 0,
        metodo: r.metodo ?? null,
      })),
    };
  }

  async eliminar(id: number) {
    const pago = await this.repo.findOne({ where: { id } });
    if (!pago) throw new BadRequestException('Pago no encontrado');
    return this.repo.remove(pago);
  }

}

