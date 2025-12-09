import { Injectable, BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Pago } from './pagos.entity';
import { UpsertPagoDto } from './dto/upsert-pago.dto';

type PlanTipo = 'suelta'|'4'|'8'|'12';

@Injectable()
export class PagosService {
  constructor(@InjectRepository(Pago) private repo: Repository<Pago>) {}

  private nowInArgentina(): Date {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
  }

  private periodoActual() {
    const now = this.nowInArgentina();
    const mes = now.getMonth() + 1; // 1..12
    const anio = now.getFullYear();
    return { mes, anio };
  }

  async estado(userId: number, mes: number, anio: number) {
    const pago = await this.repo.findOne({ where: { userId, mes, anio } });
    return { userId, mes, anio, isPago: !!(pago?.fechaPago), pago };
  }

  async estadoActual(userId: number) {
    const { mes, anio } = this.periodoActual();
    return this.estado(userId, mes, anio);
  }

  async upsertConfirmado(dto: UpsertPagoDto) {
    const row = {
      ...dto,
      fechaPago: new Date(),
    };
    await this.repo.upsert(row, { conflictPaths: ['userId','mes','anio'] });
    return this.repo.findOne({ where: { userId: dto.userId, mes: dto.mes, anio: dto.anio } });
  }

    async historial(userId: number, anio?: number) {
      const where: any = { userId };
      if (anio) where.anio = anio;

      // Sólo lo necesario para el listado
      const pagos = await this.repo.find({
        where,
        select: ['anio','mes','fechaPago','planTipo','montoARS','metodo','notas'],
        order: { anio: 'DESC', mes: 'DESC', fechaPago: 'DESC', createdAt: 'DESC' },
      });

      return {
        userId,
        historial: pagos,
      };
    }

  async resumenMensual(anio: number, mes: number) {
    // Traemos pagos confirmados del período, con apellido/nombre
    const rows = await this.repo.createQueryBuilder('p')
      .innerJoin('p.user', 'u')
      .where('p.anio = :anio AND p.mes = :mes AND p.fechaPago IS NOT NULL', { anio, mes })
      .select([
        'p.userId      AS "userId"',
        'u.apellido    AS "apellido"',
        'u.nombre      AS "nombre"',
        'p.fechaPago   AS "fechaPago"',
        'p.planTipo    AS "planTipo"',
        'p.montoARS    AS "montoARS"',
        'p.metodo      AS "metodo"',
      ])
      .orderBy('u.apellido', 'ASC')
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

  async eliminar(userId: number, mes: number, anio: number) {
    const pago = await this.repo.findOne({ where: { userId, mes, anio } });
    if (!pago) throw new BadRequestException('Pago no encontrado');
    return this.repo.remove(pago);
  }
}

