import { Injectable, BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Pago } from './pagos.entity';
import { ReservaService } from '../reserva/reserva.service';
import { UpsertPagoCicloDto } from './dto/upsert-pago-ciclo.dto';
import { CiclosAsistenciaService } from '../ciclos-asistencia/ciclos-asistencia.service';

type PlanTipo = 'suelta'|'4'|'8'|'12';

@Injectable()
export class PagosService {
  constructor(@InjectRepository(Pago) private repo: Repository<Pago>,
  private reservaService: ReservaService,
  private ciclosAsistenciaService: CiclosAsistenciaService,
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

  private limpiarCiclosSolapados(ciclos: any[]) {
    const ymd = (x: any) => String(x ?? '').slice(0, 10);

    const ordenados = [...(ciclos ?? [])].sort((a, b) =>
      ymd(a.cicloInicio).localeCompare(ymd(b.cicloInicio))
    );

    const limpios: any[] = [];

    for (const c of ordenados) {
      const ini = ymd(c.cicloInicio);
      const fin = ymd(c.cicloFin);
      if (!ini || !fin) continue;

      const ultimo = limpios[limpios.length - 1];

      if (ultimo) {
        const ultimoFin = ymd(ultimo.cicloFin);

        // Si se superpone con el anterior, descartamos el ciclo nuevo falso
        if (ini <= ultimoFin) {
          continue;
        }
      }

      limpios.push(c);
    }

    return limpios.sort((a, b) =>
      ymd(b.cicloInicio).localeCompare(ymd(a.cicloInicio))
    );
  }

  private async buscarSiguienteCicloDesdeAsistencia(userId: number, ciclos: any[], cicloActual: any) {
    const ymd = (x: any) => String(x ?? '').slice(0, 10);

    const actualInicio = ymd(cicloActual?.cicloInicio);
    if (!actualInicio) return null;

    const ciclosOrdenados = [...(ciclos ?? [])].sort((a, b) =>
      ymd(a.cicloInicio).localeCompare(ymd(b.cicloInicio))
    );

    const idx = ciclosOrdenados.findIndex(c => ymd(c.cicloInicio) === actualInicio);
    if (idx < 0) return null;

    // el siguiente cronológico dentro de asistencia
    const siguiente = ciclosOrdenados[idx + 1];
    if (!siguiente) return null;

    return {
      cicloInicio: ymd(siguiente.cicloInicio),
      cicloFin: ymd(siguiente.cicloFin),
    };
  }

  // estado del pago por CICLO (esto pinta el $)
  private async resolverEstadoCobroDesdeAsistencia(userId: number, ciclos: any[], hoy: string) {
    const ymd = (x: any) => String(x ?? '').slice(0, 10);

    const ciclosOrdenados = [...(ciclos ?? [])].sort((a, b) =>
      ymd(b.cicloInicio).localeCompare(ymd(a.cicloInicio))
    );

    const cicloActual = ciclosOrdenados.find(c => {
      const ini = ymd(c.cicloInicio);
      const fin = ymd(c.cicloFin);
      return ini && fin && hoy >= ini && hoy <= fin;
    }) ?? null;

    if (!cicloActual) {
      const primerCiclo = await this.resolverPrimerCicloDesdePrimeraReserva(userId);
      if (!primerCiclo) return null;

      return {
        cicloActual: null,
        cicloCobro: {
          cicloInicio: primerCiclo.cicloInicio,
          cicloFin: primerCiclo.cicloFin,
        },
        proximoCiclo: {
          cicloInicio: primerCiclo.cicloInicio,
          cicloFin: primerCiclo.cicloFin,
        },
        habilitarCobroAnticipado: false,
        prePago: false,
      };
    }

    const cicloInicioActual = ymd(cicloActual.cicloInicio);
    const cicloFinActual = ymd(cicloActual.cicloFin);

    const planMax = Number(cicloActual.planMax ?? 0);
    const usadas = Number(cicloActual.usadasALaFecha ?? 0);

    const clasesRestantes = Math.max(0, planMax - usadas);
    const completo = Boolean(cicloActual.completo) || (planMax > 0 && usadas >= planMax);

    const diasParaFinVentana = cicloActual?.finVentana
      ? Math.ceil(
          (
            new Date(`${ymd(cicloActual.finVentana)}T00:00:00-03:00`).getTime() -
            new Date(`${hoy}T00:00:00-03:00`).getTime()
          ) / 86400000
        )
      : null;

    const ventanaPorVencer =
      diasParaFinVentana !== null &&
      diasParaFinVentana >= 0 &&
      diasParaFinVentana <= 7 &&
      !completo;

    const habilitarCobroAnticipado =
      clasesRestantes <= 1 ||
      completo ||
      ventanaPorVencer;

    let proximoCiclo = await this.buscarSiguienteCicloDesdeAsistencia(
      userId,
      ciclos,
      cicloActual,
    );

    if (habilitarCobroAnticipado && !proximoCiclo) {
      const proxInicio = await this.reservaService.getProximaFechaTurnoFijoDespuesDe(
        userId,
        cicloFinActual,
      );

      if (proxInicio) {
        proximoCiclo = {
          cicloInicio: proxInicio,
          cicloFin: this.addDaysYMD(proxInicio, 29),
        };
      }
    }

    if (habilitarCobroAnticipado && proximoCiclo) {
      return {
        cicloActual,
        cicloCobro: {
          cicloInicio: proximoCiclo.cicloInicio,
          cicloFin: proximoCiclo.cicloFin,
        },
        proximoCiclo,
        habilitarCobroAnticipado: true,
        prePago: true,
      };
    }

    return {
      cicloActual,
      cicloCobro: {
        cicloInicio: cicloInicioActual,
        cicloFin: cicloFinActual,
      },
      proximoCiclo: proximoCiclo ?? null,
      habilitarCobroAnticipado: false,
      prePago: false,
    };
  }

  private async buscarPagoDelCiclo(userId: number, cicloInicio: string, cicloFin: string) {
    let pago = await this.repo.findOne({
      where: { userId, cicloInicio, cicloFin },
      order: { fechaPago: 'DESC' as any },
    });

    if (pago) return pago;

    pago = await this.repo.createQueryBuilder('p')
      .where('p.userId = :userId', { userId })
      .andWhere('p.cicloInicio <= :cicloInicio', { cicloInicio })
      .andWhere('p.cicloFin >= :cicloFin', { cicloFin })
      .orderBy('p.fechaPago', 'DESC')
      .getOne();

    return pago ?? null;
  }

  async estadoCicloActual(userId: number) {
    const hoy = this.ymdTodayAR();
    const ciclosRaw = await this.ciclosAsistenciaService.getHistorial(userId);
    const ciclos = this.limpiarCiclosSolapados(ciclosRaw);

    let estadoCobro: any = null;

    if (ciclos?.length) {
      estadoCobro = await this.resolverEstadoCobroDesdeAsistencia(userId, ciclos, hoy);
    } else {
      const primerCiclo = await this.resolverPrimerCicloDesdePrimeraReserva(userId);

      if (!primerCiclo) {
        return {
          userId,
          ok: false,
          motivo: 'Sin ciclos y sin reservas futuras',
          fase: 'warn' as const,
        };
      }

      estadoCobro = {
        cicloActual: null,
        cicloCobro: {
          cicloInicio: primerCiclo.cicloInicio,
          cicloFin: primerCiclo.cicloFin,
        },
        proximoCiclo: {
          cicloInicio: primerCiclo.cicloInicio,
          cicloFin: primerCiclo.cicloFin,
        },
        habilitarCobroAnticipado: false,
        prePago: true,
      };
    }

    if (!estadoCobro?.cicloCobro) {
      return {
        userId,
        ok: false,
        motivo: 'No se pudo resolver ciclo cobro',
        fase: 'warn' as const,
      };
    }

    const cicloInicio = String(estadoCobro.cicloCobro.cicloInicio).slice(0, 10);
    const cicloFin = String(estadoCobro.cicloCobro.cicloFin).slice(0, 10);

    const cicloActual = estadoCobro.cicloActual;

    let pagoCicloActual: any = null;
    let pagoProximo: any = null;

    if (cicloActual) {
      pagoCicloActual = await this.buscarPagoDelCiclo(
        userId,
        String(cicloActual.cicloInicio).slice(0, 10),
        String(cicloActual.cicloFin).slice(0, 10),
      );
    }

    if (estadoCobro.proximoCiclo) {
      pagoProximo = await this.buscarPagoDelCiclo(
        userId,
        String(estadoCobro.proximoCiclo.cicloInicio).slice(0, 10),
        String(estadoCobro.proximoCiclo.cicloFin).slice(0, 10),
      );
    }

    const pagoCicloCobro = await this.buscarPagoDelCiclo(userId, cicloInicio, cicloFin);

    let pago = pagoCicloActual ?? pagoProximo ?? pagoCicloCobro ?? null;
    let fase: 'ok' | 'warn' | 'vencido' = 'warn';
    let isPago = false;
    let prePago = !!estadoCobro.prePago;

    if (pagoCicloActual && pagoProximo) {
      // ✅ ciclo actual pagado + próximo ciclo pagado adelantado
      fase = 'ok';
      isPago = true;
      prePago = true;
      pago = pagoProximo;

    } else if (pagoCicloActual && estadoCobro.habilitarCobroAnticipado) {
        // ✅ Actual pagado, pero todavía falta pagar el próximo.
        // Dejamos pago = null para que el frontend NO muestre el pago anterior
        // y permita abrir el modal de cobro adelantado.
        fase = 'warn';
        isPago = false;
        prePago = true;
        pago = null;

    } else if (pagoCicloActual) {
      // ✅ ciclo actual pagado normal
      fase = 'ok';
      isPago = true;
      prePago = false;
      pago = pagoCicloActual;

    } else if (pagoCicloCobro) {
      // ✅ caso sin ciclo actual todavía, pero ya tiene prepago
      fase = 'ok';
      isPago = true;
      prePago = true;
      pago = pagoCicloCobro;

    } else if (estadoCobro.proximoCiclo && !estadoCobro.habilitarCobroAnticipado) {
      const inicioProximo = String(estadoCobro.proximoCiclo.cicloInicio).slice(0, 10);

      const inicioPaso = await this.reservaService.inicioDeCicloYaPasoQB(
        userId,
        inicioProximo,
      );

      if (!inicioPaso.ok) {
        fase = 'warn';
        isPago = false;
        prePago = true;
        pago = null;
      } else {
        fase = 'vencido';
        isPago = false;
        prePago = false;
        pago = null;
      }

    } else if (estadoCobro.habilitarCobroAnticipado) {
      fase = 'warn';
      isPago = false;
      prePago = true;
      pago = null;

    } else {
      fase = 'vencido';
      isPago = false;
      prePago = false;
      pago = null;
    }

    return {
      userId,
      ok: true,
      cicloInicio,
      cicloFin,
      pago: pago ?? null,
      isPago,
      prePago,
      cicloActual: estadoCobro.cicloActual,
      proximoCiclo: estadoCobro.proximoCiclo,
      habilitarCobroAnticipado: estadoCobro.habilitarCobroAnticipado === true,
      fase,
    };
  }
 
  async upsertConfirmadoCiclo(dto: UpsertPagoCicloDto) {
    const ahora = this.nowInArgentina();
    const hoy = this.ymdTodayAR();

    const ciclosRaw = await this.reservaService.getAsistenciaCiclos(dto.userId);
    const ciclos = this.limpiarCiclosSolapados(ciclosRaw);

    let estadoCobro: any = null;

    if (ciclos?.length) {
      estadoCobro = await this.resolverEstadoCobroDesdeAsistencia(dto.userId, ciclos, hoy);
    } else {
      const primerCiclo = await this.resolverPrimerCicloDesdePrimeraReserva(dto.userId);
      if (!primerCiclo) {
        throw new BadRequestException('Sin ciclos y sin primera reserva futura para el usuario');
      }

      estadoCobro = {
        cicloActual: null,
        cicloCobro: {
          cicloInicio: primerCiclo.cicloInicio,
          cicloFin: primerCiclo.cicloFin,
        },
        proximoCiclo: {
          cicloInicio: primerCiclo.cicloInicio,
          cicloFin: primerCiclo.cicloFin,
        },
        habilitarCobroAnticipado: false,
        prePago: false,
      };
    }

    if (!estadoCobro?.cicloCobro) {
      throw new BadRequestException('No se pudo resolver ciclo cobro');
    }

    let cicloInicio = String(estadoCobro.cicloCobro.cicloInicio).slice(0, 10);
    let cicloFin = String(estadoCobro.cicloCobro.cicloFin).slice(0, 10);

    const hace10Seg = new Date(ahora.getTime() - 10_000);

    const pagoRecienteIgual = await this.repo.createQueryBuilder('p')
      .where('p.userId = :userId', { userId: dto.userId })
      .andWhere('p.planTipo = :planTipo', { planTipo: dto.planTipo })
      .andWhere('p.montoARS = :montoARS', { montoARS: dto.montoARS })
      .andWhere('COALESCE(p.metodo, \'\') = COALESCE(:metodo, \'\')', { metodo: dto.metodo ?? '' })
      .andWhere('COALESCE(p.notas, \'\') = COALESCE(:notas, \'\')', { notas: dto.notas ?? '' })
      .andWhere('p.cicloInicio = :cicloInicio', { cicloInicio })
      .andWhere('p.cicloFin = :cicloFin', { cicloFin })
      .andWhere('p.fechaPago >= :desde', { desde: hace10Seg })
      .orderBy('p.fechaPago', 'DESC')
      .getOne();

    if (pagoRecienteIgual) {
      return pagoRecienteIgual;
    }

    let pagoMismoCiclo = await this.buscarPagoDelCiclo(dto.userId, cicloInicio, cicloFin);

    // ✅ si ese ciclo ya tiene pago, avanzar al siguiente ciclo REAL de asistencia
    if (pagoMismoCiclo) {
      if (!ciclos?.length) {
        throw new BadRequestException('No se pudo calcular el siguiente ciclo desde asistencia.');
      }

      const cicloBase = (ciclos ?? []).find((c: any) =>
        String(c?.cicloInicio ?? '').slice(0, 10) === cicloInicio &&
        String(c?.cicloFin ?? '').slice(0, 10) === cicloFin
      );

      let siguiente = cicloBase
        ? await this.buscarSiguienteCicloDesdeAsistencia(dto.userId, ciclos, cicloBase)
        : null;

      // fallback: si el ciclo cobrado no estaba en la lista actual, intentar con proximoCiclo ya resuelto
      if (!siguiente && estadoCobro?.proximoCiclo) {
        siguiente = {
          cicloInicio: String(estadoCobro.proximoCiclo.cicloInicio).slice(0, 10),
          cicloFin: String(estadoCobro.proximoCiclo.cicloFin).slice(0, 10),
        };
      }
      if (!siguiente) {
        const proxInicio = await this.reservaService.getProximaFechaTurnoFijoDespuesDe(
          dto.userId,
          cicloFin,
        );

        if (!proxInicio) {
          throw new BadRequestException('No se pudo calcular el próximo ciclo real del alumno.');
        }

        siguiente = {
          cicloInicio: proxInicio,
          cicloFin: this.addDaysYMD(proxInicio, 29),
        };
      }

      cicloInicio = siguiente.cicloInicio;
      cicloFin = siguiente.cicloFin;

      // ✅ si incluso ese siguiente también ya estuviera pago, seguir avanzando
      for (let guard = 0; guard < 24; guard++) {
        const pagoExistente = await this.buscarPagoDelCiclo(dto.userId, cicloInicio, cicloFin);
        if (!pagoExistente) break;

        const cicloBaseLoop = (ciclos ?? []).find((c: any) =>
          String(c?.cicloInicio ?? '').slice(0, 10) === cicloInicio &&
          String(c?.cicloFin ?? '').slice(0, 10) === cicloFin
        );

        if (!cicloBaseLoop) {
          throw new BadRequestException('No se pudo seguir avanzando al próximo ciclo real.');
        }

        const siguienteLoop = await this.buscarSiguienteCicloDesdeAsistencia(dto.userId, ciclos, cicloBaseLoop);
        if (!siguienteLoop) {
          throw new BadRequestException('No se pudo avanzar al siguiente ciclo no pago.');
        }

        cicloInicio = siguienteLoop.cicloInicio;
        cicloFin = siguienteLoop.cicloFin;
      }
    }

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
      fechaPago: ahora,
    };

    await this.repo.upsert(row, {
      conflictPaths: ['userId', 'cicloInicio', 'cicloFin'],
    });

    return this.repo.findOne({
      where: {
        userId: dto.userId,
        cicloInicio,
        cicloFin,
      },
    });
  }
  
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

  private async resolverPrimerCicloDesdePrimeraReserva(userId: number) {
    const primeraReserva = await this.reservaService.getPrimeraReservaFutura(userId);

    if (!primeraReserva?.fechaTurno) return null;

    const cicloInicio = String(primeraReserva.fechaTurno).slice(0, 10);
    const cicloFin = this.addDaysYMD(cicloInicio, 29);

    return { cicloInicio, cicloFin };
  }

}

