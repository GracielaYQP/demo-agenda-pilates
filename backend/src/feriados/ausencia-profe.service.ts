// src/feriados/ausencia-profe.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AusenciaProfe } from './ausencia-profe.entity';
import { CreateAusenciaDto } from './ausencia-profe.dto';
import { CierreTipo, ListResponse } from './ausencia-profe.types';
import { WhatsAppService } from 'src/whatsapp/whatsapp.service';
import { UsersService } from 'src/users/users.service';
import { Reserva } from 'src/reserva/reserva.entity';
import { In } from 'typeorm';
import { NotificacionCierre } from 'src/notificaciones/notificacion-cierre.entity';

@Injectable()
export class AusenciaProfeService {
  constructor(
    @InjectRepository(AusenciaProfe) private repo: Repository<AusenciaProfe>,
    @InjectRepository(Reserva) private reservaRepo: Repository<Reserva>,
    @InjectRepository(NotificacionCierre) private cierreNotifRepo: Repository<NotificacionCierre>, 
    private readonly whatsapp: WhatsAppService,
    private readonly usersService: UsersService,
  ) {}

  async listar(desde: string, hasta: string): Promise<ListResponse<AusenciaProfe>> {
    const qb = this.repo.createQueryBuilder('a')
      .where('a.fecha BETWEEN :desde::date AND :hasta::date', { desde, hasta })
      .orderBy('a.fecha', 'ASC')
      .addOrderBy('a.id', 'ASC');

    const list = await qb.getMany();
    return { count: list.length, list };
  }

  async hayCierre(fechaYMD: string, horaHHmm: string): Promise<CierreTipo> {
    const regs = await this.repo.find({ where: { fecha: fechaYMD } });
    if (!regs.length) return null;

    const toMin = (h: string) => { const [HH, MM] = h.split(':').map(Number); return HH*60 + MM; };
    const m = toMin(horaHHmm);
    const MANIANA_INI = toMin('07:00'), MANIANA_FIN = toMin('13:59');
    const TARDE_INI   = toMin('14:00'), TARDE_FIN   = toMin('22:00');

    for (const a of regs) {
      if (a.tipo === 'dia') return 'dia';
      if (a.tipo === 'horario' && a.hora && a.hora.slice(0,5) === horaHHmm.slice(0,5)) return 'horario';
      if (a.tipo === 'manana' && m >= MANIANA_INI && m <= MANIANA_FIN) return 'manana';
      if (a.tipo === 'tarde'  && m >= TARDE_INI   && m <= TARDE_FIN)   return 'tarde';
    }
    return null;
  }

  async crear(dto: CreateAusenciaDto) {
    const entity = this.repo.create(dto);
    const saved = await this.repo.save(entity);

    // 1) notificar con reservas aún vigentes
    await this.notificarAusencia(saved);

    // 2) aplicar cierre (cambia estados)
    await this.aplicarCierreAReservasExistentes(saved);

    return saved;
  }


  private rangoHorasParaTipo(tipo: string) {
    if (tipo === 'manana') return { from: '07:00', to: '13:59' };
    if (tipo === 'tarde')  return { from: '14:00', to: '22:00' };
    return null;
  }

  private async notificarAusencia(a: AusenciaProfe) {
    const fechaObj = new Date(`${a.fecha}T00:00:00-03:00`);
    const fechaLarga = this.formatFechaLarga(fechaObj);

    const tramo =
      a.tipo === 'dia' ? 'todo el día' :
      a.tipo === 'manana' ? 'por la mañana' :
      a.tipo === 'tarde' ? 'por la tarde' :
      a.hora ? `a las ${a.hora.slice(0, 5)}` : 'en el horario habitual';

    const motivo = a.motivo || 'motivos personales';

    const qb = this.reservaRepo.createQueryBuilder('r')
      .leftJoinAndSelect('r.usuario', 'u')
      .leftJoinAndSelect('r.horario', 'h')
      .where('r.fechaTurno = :fecha', { fecha: a.fecha })
      .andWhere('u.activo = true')
      .andWhere('u.telefono IS NOT NULL')
      .andWhere(
        `
        (
          r.estado IN (:...vigentes)
          OR (r.cierreEstudio = true AND r.estado IN (:...cerrados))
        )
        `,
        {
          vigentes: ['reservado', 'recuperada'],
          // 👇 cubre tu caso real: a veces queda "cancelado" por cierre
          cerrados: ['cerrado', 'cancelado'],
        },
      );

    if (a.tipo === 'horario' && a.hora) {
      qb.andWhere('LEFT(h.hora, 5) = :hhmm', { hhmm: a.hora.slice(0, 5) });
    } else {
      const rango = this.rangoHorasParaTipo(a.tipo);
      if (rango) {
        qb.andWhere('LEFT(h.hora, 5) >= :from AND LEFT(h.hora, 5) <= :to', rango);
      }
    }

    const reservas = await qb.getMany();
    if (!reservas.length) return;

    // Usuarios únicos
    const alumnosMap = new Map<number, { id: number; telefono: string; nombre: string }>();
    for (const r of reservas) {
      const u = r.usuario;
      if (!u?.id || !u?.telefono) continue;
      if (!alumnosMap.has(u.id)) {
        alumnosMap.set(u.id, { id: u.id, telefono: u.telefono, nombre: u.nombre || 'alumno/a' });
      }
    }

    const alumnos = [...alumnosMap.values()];
    if (!alumnos.length) return;

    // ✅ DEDUPE (sin NULL): horaKey siempre string
    const tipoCierre = a.tipo as 'dia' | 'manana' | 'tarde' | 'horario';
    const horaKey =
      (tipoCierre === 'horario' && a.hora) ? a.hora.slice(0, 5) : tipoCierre;

    for (const alumno of alumnos) {
      try {
        const ya = await this.cierreNotifRepo.findOne({
          where: {
            usuarioId: alumno.id,
            fecha: a.fecha,
            tipoCierre,
            hora: horaKey,
          } as any,
        });

        if (ya) continue; // 🚫 ya se notificó

        await this.whatsapp.sendTemplateClasesSuspendidas(
          alumno.telefono,
          alumno.nombre || 'alumno/a',
          fechaLarga,
          tramo,
          motivo,
        );

        // ✅ marca dedupe (race-safe por UNIQUE)
        try {
          await this.cierreNotifRepo.insert({
            usuarioId: alumno.id,
            fecha: a.fecha,
            tipoCierre,
            hora: horaKey,
          } as any);
        } catch {
          // si ya existía por carrera, ok
        }

      } catch (e) {
        console.error('Error enviando WhatsApp a', alumno.id, e);
      }
    }
  }

  private async aplicarCierreAReservasExistentes(a: AusenciaProfe) {
    const qb = this.reservaRepo.createQueryBuilder('r')
      .leftJoinAndSelect('r.horario', 'h')
      .leftJoinAndSelect('r.usuario', 'u')
      .where('r.fechaTurno = :fecha', { fecha: a.fecha })
      .andWhere('u.activo = true')
      // ✅ solo vigentes (esto es lo que realmente “hay que cerrar”)
      .andWhere('r.estado IN (:...estados)', { estados: ['reservado'] });

    if (a.tipo === 'horario' && a.hora) {
      qb.andWhere('LEFT(h.hora, 5) = :hhmm', { hhmm: a.hora.slice(0, 5) });
    } else if (a.tipo === 'manana') {
      qb.andWhere('LEFT(h.hora, 5) BETWEEN :from AND :to', { from: '07:00', to: '13:59' });
    } else if (a.tipo === 'tarde') {
      qb.andWhere('LEFT(h.hora, 5) BETWEEN :from AND :to', { from: '14:00', to: '22:00' });
    }

    const reservas = await qb.getMany();
    if (!reservas.length) return { ok: true, afectadas: 0 };

    let afectadas = 0;

    for (const r of reservas) {
      // ✅ Si el alumno canceló momentáneamente por su cuenta y NO es cierre, no tocar
      const esCancelAlumno =
        r.estado === 'cancelado' &&
        r.cancelacionMomentanea === true &&
        r.cierreEstudio === false;

      if (esCancelAlumno) continue;

      // ✅ Marcar como CERRADO (consistente con tu sistema)
      r.estado = 'cerrado';
      r.automatica = true;
      r.tipo = 'automatica';

      r.cierreEstudio = true;

      // ✅ crédito de recuperación por cierre
      r.cancelacionMomentanea = true;
      r.cancelacionPermanente = false;
      r.fechaCancelacion = new Date();

      await this.reservaRepo.save(r);
      afectadas++;
    }

    return { ok: true, afectadas };
  }

  private formatFechaLarga(fecha: Date): string {
    // Esto devuelve algo tipo: "lunes, 17 de noviembre"
    const s = fecha.toLocaleDateString('es-AR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    // Capitalizamos la primera letra
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  async eliminar(id: number) {
    await this.repo.delete(id);
    return { ok: true };
  }



}
