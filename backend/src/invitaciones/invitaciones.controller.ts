import { Controller, Get, Query, NotFoundException, BadRequestException } from '@nestjs/common';
import { InvitacionesService } from './invitaciones.service';
import { Public } from 'src/auth/public.decorator';
import { VerifyInvitationDto } from './dto/verify-invitation.dto';

@Controller('invitaciones')
export class InvitacionesController {
  constructor(private readonly invitacionesService: InvitacionesService) {}

  // Verificar invitación (GET /invitaciones/verificar?token=abc123)
  @Public()
  @Get('verificar')
  async verificar(@Query() q: VerifyInvitationDto) {
    const { token } = q;
    if (!token) throw new BadRequestException('Falta token');

    const invitacion = await this.invitacionesService.findByToken(token);

    // buenas prácticas: además de estado, chequeá expiración
    if (!invitacion || invitacion.estado !== 'pendiente' || (invitacion.expiraEn && new Date(invitacion.expiraEn) < new Date())) {
      throw new NotFoundException('Invitación inválida o expirada');
    }

    // devolvé solo lo necesario (evitá filtrar datos sensibles)
    return {
      valida: true,
      telefono: invitacion.telefono,
      rol: invitacion.rol, 
      nivel: invitacion.rol === 'alumno' ? invitacion.nivel_asignado : null,
    };
  }
}


