import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EstadoInvitacion, Invitacion } from './invitaciones.entity';
import { User } from '../users/user.entity';


@Injectable()
export class InvitacionesService {
  constructor(
    @InjectRepository(Invitacion)
    private readonly invitacionRepo: Repository<Invitacion>,
  ) {}

  // Buscar invitación por token
  async findByToken(token: string): Promise<Invitacion | null> {
    return this.invitacionRepo.findOne({
      where: { token }
    });
  }


  async marcarComoUsada(id: number): Promise<void> {
    await this.invitacionRepo.update(id, { estado: 'usado' as EstadoInvitacion });
  }


  async crearInvitacion(telefono: string, nivel: string, token: string): Promise<Invitacion> {
    const existePendiente = await this.invitacionRepo.findOne({
      where: { telefono, estado: 'pendiente' as EstadoInvitacion },
    });
    if (existePendiente) {
      throw new BadRequestException('Ya existe una invitación pendiente para este teléfono.');
    }

    const expira = new Date();
    expira.setDate(expira.getDate() + 7); // 7 días

    const invitacion = this.invitacionRepo.create({
      telefono,
      nivel_asignado: nivel,
      token,
      estado: 'pendiente',
      expiraEn: expira,
    });
    return this.invitacionRepo.save(invitacion);
  }


}