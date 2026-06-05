import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not } from 'typeorm';
import { CiclosAsistencia } from './ciclos-asistencia.entity';
import { ReservaService } from '../reserva/reserva.service';
import { Cron } from '@nestjs/schedule';
import { User } from '../users/user.entity';

@Injectable()
export class CiclosAsistenciaService {
  constructor(
    @InjectRepository(CiclosAsistencia)
    private readonly ciclosRepo: Repository<CiclosAsistencia>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @Inject(forwardRef(() => ReservaService))
    private readonly reservaService: ReservaService,
  ) {}
 
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
      if (ultimo && ini <= ymd(ultimo.cicloFin)) continue;

      limpios.push(c);
    }

    return limpios.sort((a, b) =>
      ymd(b.cicloInicio).localeCompare(ymd(a.cicloInicio))
    );
  }
  async getHistorial(userId: number) {
    return this.ciclosRepo.find({
      where: { userId },
      order: { cicloInicio: 'DESC' as any },
    });
  }

  async rebuildUserCycles(userId: number) {
    throw new Error(
      'rebuildUserCycles deshabilitado: usar syncCicloAbierto(userId) para no pisar históricos cerrados.',
    );
  }

  private ymdTodayAR(): string {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return fmt.format(new Date());
  }

  async rebuildAllUsers() {
    throw new Error(
      'rebuildAllUsers deshabilitado: no usar rebuild-all porque pisa históricos cerrados.',
    );
  }

  async getCicloAbierto(userId: number) {
    return this.ciclosRepo.findOne({
      where: { userId, abierto: true },
      order: { cicloInicio: 'DESC' as any },
    });
  }

  private ymdToComparable(ymd: string | null | undefined): string {
    return String(ymd || '').slice(0, 10);
  }

  private async mapearCicloActualDesdeCalculo(userId: number) {
    const ciclosRaw = await this.reservaService.getAsistenciaCiclos(userId);
    const ciclos = this.limpiarCiclosSolapados(ciclosRaw);
    if (!ciclos?.length) return null;

    const hoy = this.ymdToComparable(this.ymdTodayAR());

    // el cálculo ya viene DESC en tu sistema
    const c = ciclos[0];
    const completo = !!c.completo;
    const finVentana = this.ymdToComparable(c.finVentana);
    const vencido = hoy > finVentana;

    let abierto = false;
    let motivoCierre = 'fin_ventana';

    if (!completo && !vencido) {
      abierto = true;
      motivoCierre = 'abierto';
    } else if (completo) {
      motivoCierre = 'consumo_completo';
    }

    return {
      userId,
      cicloInicio: this.ymdToComparable(c.cicloInicio),
      cicloFin: this.ymdToComparable(c.cicloFin),
      finVentana,
      finReal: c.finReal ? this.ymdToComparable(c.finReal) : null,
      planMax: c.planMax ?? 0,
      asistidas: c.asistidas ?? 0,
      recuperadas: c.recuperadas ?? 0,
      usadasALaFecha: c.usadasALaFecha ?? 0,
      canceladas: c.canceladas ?? 0,
      canceladasAlumno: c.canceladasAlumno ?? 0,
      cerrado: c.cerrado ?? 0,
      derechoRecuperacion: c.derechoRecuperacion ?? 0,
      saldoRecuperacion: c.saldoRecuperacion ?? 0,
      recuperacionesReservadas: c.recuperacionesReservadas ?? 0,
      fechasAsistidas: c.fechasAsistidas ?? [],
      fechasRecuperadas: c.fechasRecuperadas ?? [],
      fechasRecupReservadas: c.fechasRecupReservadas ?? [],
      fechasCanceladas: c.fechasCanceladas ?? [],
      fechasSueltas: c.fechasSueltas ?? [],
      fechasCerrado: c.fechasCerrado ?? [],
      excedePlan: !!c.excedePlan,
      completo,
      abierto,
      motivoCierre,
    };
  }

  async syncCicloAbierto(userId: number) {
    const nuevoActual = await this.mapearCicloActualDesdeCalculo(userId);

    // Si no hay ciclo calculable, no tocamos nada
    if (!nuevoActual) {
      return null;
    }

    // ✅ Protección anti-solape:
    // No permite guardar un ciclo cuyo rango se pisa con otro ciclo existente
    // de distinto inicio.
    const ciclosExistentes = await this.ciclosRepo.find({
      where: { userId } as any,
      order: { cicloInicio: 'ASC' as any },
    });

    const cicloSolapado = ciclosExistentes.find((c: any) => {
      const mismoInicio = c.cicloInicio === nuevoActual.cicloInicio;

      const finExistente = c.completo && c.finReal
        ? c.finReal
        : c.cicloFin;

      const haySolape =
        nuevoActual.cicloInicio <= finExistente &&
        nuevoActual.cicloFin >= c.cicloInicio;

      return !mismoInicio && haySolape;
    });

    if (cicloSolapado) {
      return {
        ok: false,
        motivo: 'Se detectó un ciclo solapado. No se sincronizó.',
        cicloCalculado: {
          inicio: nuevoActual.cicloInicio,
          fin: nuevoActual.cicloFin,
        },
        cicloExistente: {
          id: cicloSolapado.id,
          inicio: cicloSolapado.cicloInicio,
          fin: cicloSolapado.cicloFin,
        },
      };
    }

    // ✅ Seguridad extra:
    // No sincronizar ciclos históricos cerrados por accidente.
    if (!nuevoActual.abierto) {
      const ultimoGuardado = await this.ciclosRepo.findOne({
        where: { userId } as any,
        order: { cicloInicio: 'DESC' as any },
      });

      if (
        ultimoGuardado &&
        nuevoActual.cicloInicio < ultimoGuardado.cicloInicio
      ) {
        return {
          ok: false,
          motivo:
            'El ciclo calculado no es abierto y es anterior al último ciclo guardado. No se tocó la tabla.',
          cicloCalculado: nuevoActual.cicloInicio,
          ultimoGuardado: ultimoGuardado.cicloInicio,
        };
      }
    }

    // ✅ Seguridad: cerrar TODOS los ciclos abiertos del usuario.
    await this.ciclosRepo.update(
      { userId, abierto: true } as any,
      {
        abierto: false,
        motivoCierre: 'cerrado_por_sync',
      } as any,
    );

    // ✅ Antiduplicado por userId + cicloInicio
    const existentesMismoInicio = await this.ciclosRepo.find({
      where: {
        userId,
        cicloInicio: nuevoActual.cicloInicio,
      } as any,
      order: { id: 'ASC' as any },
    });

    if (existentesMismoInicio.length > 0) {
      const principal = existentesMismoInicio[0];

      const duplicados = existentesMismoInicio
        .filter((x: any) => x.id !== principal.id)
        .map((x: any) => x.id);

      if (duplicados.length > 0) {
        await this.ciclosRepo.delete(duplicados);
      }

      Object.assign(principal, nuevoActual);

      principal.abierto = !!nuevoActual.abierto;

      return this.ciclosRepo.save(principal);
    }

    // ✅ Crear nuevo ciclo
    const nuevo = this.ciclosRepo.create({
      ...nuevoActual,
      userId,
      abierto: !!nuevoActual.abierto,
    });

    return this.ciclosRepo.save(nuevo);
  }
  
  private async syncSoloUsuariosConCicloAbierto() {
    const abiertos = await this.ciclosRepo.find({
      where: { abierto: true } as any,
      select: ['userId'] as any,
    });

    const userIds = [...new Set(
      abiertos
        .map(x => Number(x.userId))
        .filter(id => Number.isFinite(id))
    )];

    for (const userId of userIds) {
      try {
        await this.syncCicloAbierto(userId);
      } catch (e) {
        console.error(`❌ Error sincronizando ciclo abierto userId=${userId}`, e);
      }
    }
  }

  @Cron('*/30 * * * *', { timeZone: 'America/Argentina/Buenos_Aires' })
  async cronSyncCiclosAbiertos() {
    console.log('🕒 [CRON] Sincronizando ciclos abiertos...');
    await this.syncSoloUsuariosConCicloAbierto();
    console.log('✅ [CRON] Ciclos abiertos sincronizados');
  }
}