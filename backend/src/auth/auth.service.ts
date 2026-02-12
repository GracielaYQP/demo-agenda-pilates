import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { CreateUserDto } from '../users/user.dto';
import { MailerService } from './mailer/mailer.service';
import { v4 as uuidv4 } from 'uuid';
import * as bcrypt from 'bcryptjs';
import { User } from '../users/user.entity';
import { ConfigService } from '@nestjs/config';
import { RegisterAdminDemoDto } from './dto/register-admin-demo.dto';
import { BootstrapAdminDto } from './dto/bootstrap-admin.dto';


@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private readonly config: ConfigService,

  ) {}

  private buildResetUrl(token: string): string {
    const base = (this.config.get<string>('CLIENT_BASE_URL') || 'https://agendapilates.thysetech.com').replace(/\/+$/, '');
    return `${base}/reset-password/${token}`;
  }

  // Registro normal
  async register(dto: CreateUserDto) {
    return this.usersService.create(dto); 
  }

  // Login normal
  async loginFlexible(usuario: string, password: string) {
    console.log('🟡 Intentando login con:', usuario);
    const user = await this.usersService.findByEmailOrTelefono(usuario);
    if (!user) throw new UnauthorizedException('Usuario no encontrado');
    console.log('👤 Usuario encontrado:', user.telefono);
    if (!user.activo) {
      throw new ForbiddenException({
        code: 'INACTIVE_USER',
        message: 'Tu cuenta está inactiva. Por favor, comunicate con el estudio para reactivarla.',
      });
    }

    // ✅ Bloqueo por demo vencida (aplica a admin/alumno demo)
    const ahora = new Date();
    if (user.esDemo && user.demoHasta && user.demoHasta < ahora) {
      // opcional: también lo desactivás automáticamente
      await this.usersService.update(user.id, { activo: false });
      throw new ForbiddenException({
        code: 'DEMO_EXPIRED',
        message: 'Tu demo expiró. Contactate para renovar.',
      });
    }

    const cleanPassword = password.trim(); // elimina espacios accidentales
    console.log('🔎 Contraseña limpia recibida desde el frontend:', cleanPassword);

    const passwordValid = await bcrypt.compare(cleanPassword, user.password);
    console.log('🔐 Contraseña válida?', passwordValid);
    if (!passwordValid) {
      throw new UnauthorizedException('Contraseña incorrecta');
    }

    const payload = { sub: user.id, email: user.email, rol: user.rol };
    const token = await this.jwtService.signAsync(payload);

    return {
      access_token: token,
      nombre: user.nombre,
      apellido: user.apellido,
      dni: user.dni,
      rol: user.rol,
      nivel: user.nivel,
    };
  }

  // Crear usuario desde invitación
  async createUser(data: CreateUserDto): Promise<User> {
    // 👇 Le pasamos la password en texto plano y UsersService.create se encarga de hashearla
    return this.usersService.create(data);
  }

  async sendResetPasswordWhatsappLinkByUsuario(usuario: string) {
    const input = (usuario ?? '').trim();
    if (!input) throw new BadRequestException('Falta el usuario (email o teléfono)');

    // ✅ Una sola búsqueda centralizada (retorna User | undefined)
    const user = await this.usersService.findByEmailOrTelefono(input);
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (!user.telefono) throw new BadRequestException('El usuario no tiene un teléfono asociado');

    // Usamos SIEMPRE el teléfono guardado en DB (normalizado a 549…)
    const telefonoOK = this.normalizarTelefonoArgentina(user.telefono);

    const token = uuidv4();
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
    await this.usersService.setResetToken(user.id, token, expiry);

    // const resetUrl = `https://localhost:4200/reset-password/${token}`;
    const resetUrl = this.buildResetUrl(token);

    const mensaje = `
        Hola ${user.nombre},

        Recibí tu solicitud para cambiar la contraseña de tu cuenta en el sistema de Pilates. 

        Este es el link para restablecer tu contraseña: ${resetUrl}

        Este enlace es válido por 1 hora!.

        Gracias!
          `.trim();

    return {
      resetLink: resetUrl,
      telefono: telefonoOK,
      mensaje,
      whatsappUrl: `https://wa.me/${telefonoOK}?text=${encodeURIComponent(mensaje)}`
    };
  }

  private normalizarTelefonoArgentina(input: string): string {
    let tel = (input ?? '').replace(/[^\d]/g, '');

    if (tel.startsWith('0')) tel = tel.slice(1);        // sacar 0
    if (tel.startsWith('54') && !tel.startsWith('549')) tel = '549' + tel.slice(2);
    if (!tel.startsWith('54')) tel = '549' + tel;       // agregar prefijo si falta
    tel = tel.replace(/^549(\d{2,4})15(\d+)/, '549$1$2'); // sacar "15" viejo

    return tel;
  }

    async resetPassword(token: string, newPassword: string) {
    const user = await this.usersService.findByResetToken(token);
    if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
      throw new BadRequestException('Token inválido o expirado');
    }

    const cleanPassword = newPassword.trim();

    console.log('🛠 Contraseña original recibida:', newPassword);
    console.log('🧼 Contraseña limpia (trim):', cleanPassword);

    if (!/^(?=.*[A-Z])(?=.*\d)(?=.*[.,*!?¿¡/#$%&])[A-Za-z\d.,*!?¿¡/#$%&]{8,20}$/.test(cleanPassword)) {
      throw new BadRequestException('La contraseña no cumple los requisitos mínimos');
    }

    const hashedPassword = await bcrypt.hash(cleanPassword, 10);
    console.log('🔐 Hash generado:', hashedPassword);

    await this.usersService.update(user.id, {
      password: hashedPassword,
      resetToken: null,
      resetTokenExpiry: null,
    });

    console.log(`🔐 Contraseña actualizada correctamente para ${user.telefono}`);
    return { message: 'Contraseña restablecida exitosamente' };
  }  

  async bootstrapAdmin(dto: BootstrapAdminDto, bootstrapKey: string) {
    const expectedKey = (this.config.get<string>('BOOTSTRAP_KEY') || '').trim();
    if (!expectedKey) {
      throw new BadRequestException('BOOTSTRAP_KEY no está configurada en el servidor');
    }

    if ((bootstrapKey || '').trim() !== expectedKey) {
      throw new ForbiddenException('Bootstrap key inválida');
    }

    // ✅ Bloquear si ya existe admin o superadmin activo
    const existe = await this.usersService.existsAnyAdminLike();
    if (existe) {
      throw new ConflictException('Ya existe un admin/superadmin. Bootstrap deshabilitado.');
    }

    // ✅ Crear usuario con create() (queda "alumno" por default)
    const user = await this.usersService.create({
      dni: dto.dni,
      email: dto.email,
      nombre: dto.nombre,
      apellido: dto.apellido,
      telefono: dto.telefono,
      password: dto.password,
      nivel: 'Básico',
      planMensual: '0',
    });

    // ✅ Elevar a superadmin
    await this.usersService.update(user.id, { rol: 'superadmin', activo: true });

    // ✅ Autologin (devuelve access_token, rol, etc.)
    return this.loginFlexible(dto.email, dto.password);
  }

}
