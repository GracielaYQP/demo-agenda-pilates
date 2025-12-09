import { Controller, Post, Body, BadRequestException, NotFoundException, Param, Get, UsePipes, ValidationPipe } from '@nestjs/common';
import { AuthService } from './auth.service';
import { InvitacionesService } from '../invitaciones/invitaciones.service';
import { RegisterInvitacionDto } from './register-invitacion.dto';
import { v4 as uuidv4 } from 'uuid';
import { UsersService } from '../users/users.service';
import { LoginDto } from './login.dto';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService, 
              private readonly invitacionesService: InvitacionesService,
              private readonly usersService: UsersService 
            ) {}

  @Post('register')
  register(@Body() dto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  login(@Body() dto: { usuario: string; password: string }) {
    return this.authService.loginFlexible(dto.usuario, dto.password);
  }

  @Public()
  @Post('register-invitacion')
  async registerInvitacion(@Body() dto: RegisterInvitacionDto) {
    const invitacion = await this.invitacionesService.findByToken(dto.token);

    if (!invitacion || invitacion.estado !== 'pendiente') {
      throw new BadRequestException('Invitación inválida o ya usada.');
    }

    // Aquí creas el usuario, usando el nivel asignado en la invitación
    await this.authService.createUser({
      email: dto.email,
      nombre: dto.nombre,
      apellido: dto.apellido,  
      dni: dto.dni,
      telefono: invitacion.telefono,
      password: dto.password,
      nivel: invitacion.nivel_asignado,
      planMensual: dto.planMensual
    });

    // Marcar la invitación como usada para que no se pueda reutilizar
    await this.invitacionesService.marcarComoUsada(invitacion.id);

    return { success: true, message: 'Registro exitoso' };
  }

  @Post('invitar')
  async invitar(@Body() dto: { telefono: string; nivel: string }) {
    if (!dto.telefono || !dto.nivel) {
      throw new BadRequestException('Teléfono y nivel son requeridos');
    }

    // Buscar usuario por teléfono
    const user = await this.usersService.findByTelefono(dto.telefono);
  
    if (user) {
      if (user.activo) {
        throw new BadRequestException('Este usuario ya está registrado y activo.');
      } else {
        return {
          reactivar: true,
          userId: user.id,
          telefono: user.telefono,
          nombre: user.nombre,
          mensaje: 'Este usuario ya estaba registrado como inactivo y fue reactivado.',
        };
      }
    }

      // Si no existe, generamos invitación como siempre
      const token = uuidv4();
      await this.invitacionesService.crearInvitacion(dto.telefono, dto.nivel, token);

      return { token };
    }

  @Public()
  @Get('validar/:token')
    async validar(@Param('token') token: string) {
      const invitacion = await this.invitacionesService.findByToken(token);

      if (!invitacion || invitacion.estado !== 'pendiente') {
        throw new NotFoundException('Invitación inválida o expirada.');
      }

      return {
        telefono: invitacion.telefono,
        nivel: invitacion.nivel_asignado,
      };
  }
    
  @Public()
  @Post('reset-password')
    resetPassword(@Body() body: { token: string; newPassword: string }) {
      return this.authService.resetPassword(body.token, body.newPassword);
  }

  @Public()
  @Post('reset-link-whatsapp')
  resetLinkViaWhatsapp(@Body() body: { usuario: string }) {
    if (!body?.usuario) {
      throw new BadRequestException('Falta el usuario (email o teléfono)');
    }
    return this.authService.sendResetPasswordWhatsappLinkByUsuario(body.usuario);
  }


}



