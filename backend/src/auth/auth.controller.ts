import { Controller, Post, Body, BadRequestException, NotFoundException, Param, Get, UsePipes, ValidationPipe, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { InvitacionesService } from '../invitaciones/invitaciones.service';
import { RegisterInvitacionDto } from './register-invitacion.dto';
import { v4 as uuidv4 } from 'uuid';
import { UsersService } from '../users/users.service';
import { LoginDto } from './login.dto';
import { Public } from './public.decorator';
import { JwtAuthGuard } from './jwt.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';

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

    if (invitacion.expiraEn && new Date(invitacion.expiraEn) < new Date()) {
      throw new BadRequestException('Invitación expirada.');
    }

    const esAdmin = invitacion.rol === 'admin';

    // ✅ Si es alumno, nivel debe existir
    if (!esAdmin && (!invitacion.nivel_asignado || !invitacion.nivel_asignado.trim())) {
      throw new BadRequestException('Invitación inválida: falta nivel asignado.');
    }

    // ✅ crear usuario
    const user = await this.authService.createUser({
      email: dto.email,
      nombre: dto.nombre,
      apellido: dto.apellido,
      dni: dto.dni,
      telefono: invitacion.telefono,
      password: dto.password,

      nivel: esAdmin ? 'Básico' : invitacion.nivel_asignado!,
      planMensual: esAdmin ? '0' : dto.planMensual,
    });

    // ✅ si era invitación admin, elevar rol
    if (esAdmin) {
      await this.usersService.update(user.id, { rol: 'admin' });
    }

    // ✅ marcar invitación usada
    await this.invitacionesService.marcarComoUsada(invitacion.id);

    // ✅ autologin usando el teléfono (o email) + password
    const login = await this.authService.loginFlexible(invitacion.telefono, dto.password);

    return {
      success: true,
      message: 'Registro exitoso',
      ...login, // access_token, nombre, apellido, dni, rol, nivel
    };
  }


  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post('invitar')
  async invitar(@Body() dto: { telefono: string; nivel?: string; rol?: 'admin' | 'alumno' }) {

    if (!dto.telefono) {
      throw new BadRequestException('Teléfono es requerido');
    }

    const rol: 'admin' | 'alumno' = dto.rol ?? 'alumno';

    // ✅ nivel solo obligatorio para alumno
    if (rol === 'alumno' && (!dto.nivel || !dto.nivel.trim())) {
      throw new BadRequestException('Nivel es requerido para invitar alumnos');
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

    // Si no existe, generamos invitación
    const token = uuidv4();

    // 👇 si es admin, nivel va null
    const nivel = rol === 'admin' ? null : dto.nivel!.trim();

    await this.invitacionesService.crearInvitacion(dto.telefono, nivel, token, rol);

    return { token, rol };
  }

  @Public()
  @Get('validar/:token')
    async validar(@Param('token') token: string) {
      const invitacion = await this.invitacionesService.findByToken(token);

      if (!invitacion || invitacion.estado !== 'pendiente' || (invitacion.expiraEn && new Date(invitacion.expiraEn) < new Date())) {
        throw new NotFoundException('Invitación inválida o expirada.');
      }

      return {
        telefono: invitacion.telefono,
        rol: invitacion.rol,
        nivel: invitacion.rol === 'alumno' ? invitacion.nivel_asignado : null,
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



