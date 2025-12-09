// src/feriados/ausencia-profe.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AusenciaProfe } from './ausencia-profe.entity';
import { CreateAusenciaDto } from './ausencia-profe.dto';
import { ListResponse } from './ausencia-profe.types';
import { WhatsAppService } from 'src/whatsapp/whatsapp.service';
import { UsersService } from 'src/users/users.service';

@Injectable()
export class AusenciaProfeService {
  constructor(
    @InjectRepository(AusenciaProfe) private repo: Repository<AusenciaProfe>,
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

  async hayCierre(fechaYMD: string, horaHHmm: string): Promise<null | 'dia' | 'manana' | 'tarde' | 'horario'> {
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
    await this.notificarAusencia(saved); 
    return saved;
  }

  private async notificarAusencia(a: AusenciaProfe) {
    // 1) Traer alumnos activos con teléfono
    const alumnos = await this.usersService.findActivosConTelefono();
    if (!alumnos?.length) return;

    // 2) Fecha y tramo legible
    const fechaObj = new Date(a.fecha);
    const fechaLarga = this.formatFechaLarga(fechaObj);

    const tramo =
      a.tipo === 'dia'
        ? ''
        : a.tipo === 'manana'
        ? ' por la mañana'
        : a.tipo === 'tarde'
        ? ' por la tarde'
        : a.hora
        ? ` a las ${a.hora.slice(0, 5)}`
        : '';

    const motivo = a.motivo || 'motivos personales';

    // 3) Enviar template a cada alumno
    await Promise.all(
      alumnos.map(async (alumno) => {
        if (!alumno.telefono) return;

        try {
          await this.whatsapp.sendTemplateClasesSuspendidas(
            alumno.telefono,                // 👈 crudo, lo formatea WhatsAppService
            alumno.nombre || 'alumno/a',    // {{1}}
            fechaLarga,                     // {{2}}
            tramo,                          // {{3}}
            motivo,                         // {{4}}
          );
        } catch (e) {
          console.error('Error enviando WhatsApp a', alumno.id, e);
        }
      }),
    );
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
