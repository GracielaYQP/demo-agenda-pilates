import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from './user.entity';
import { Reserva } from '../reserva/reserva.entity';
import { Horario } from '../horarios/horarios.entity';


@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Reserva)
    private reservaRepo: Repository<Reserva>,
    @InjectRepository(Horario)
    private horarioRepo: Repository<Horario>
    ) {}

  async create(userData: {
    email: string;
    nombre: string;
    apellido: string;
    dni: string;
    telefono: string; 
    password: string;
    nivel: string;
    planMensual: '0' |'4' | '8' | '12';
  }): Promise<User> {
    // Validar email único
    const existingEmail = await this.userRepository.findOne({
      where: { email: userData.email },
    });
    if (existingEmail) {
      throw new BadRequestException('El email ya está registrado');
    }

    // Validar DNI único
    const existingDNI = await this.userRepository.findOne({
      where: { dni: userData.dni },
    });
    if (existingDNI) {
      throw new BadRequestException('El DNI ya está registrado');
    }

    // 🚨 Validar que la contraseña no esté repetida
    const existingUsers = await this.userRepository.find();
    for (const existing of existingUsers) {
      const isSame = await bcrypt.compare(userData.password, existing.password);
      if (isSame) {
        throw new BadRequestException('La contraseña ya está en uso. Elegí una diferente.');
      }
    }

    const hashedPassword = await bcrypt.hash(userData.password, 10);
    const planStr = String(userData.planMensual) as '0' | '4' | '8' | '12';
    const user = this.userRepository.create({
      email: userData.email,
      nombre: userData.nombre,
      apellido: userData.apellido,
      dni: userData.dni,
      telefono: userData.telefono,
      password: hashedPassword,
      nivel: userData.nivel,
      planMensual: planStr,
    });

    return await this.userRepository.save(user);
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const user = await this.userRepository.findOne({ where: { email } });
    return user === null ? undefined : user;
  }

  async findById(id: number): Promise<User | undefined> {
    const user = await this.userRepository.findOne({ where: { id } });
    return user === null ? undefined : user;
  }

  async findByTelefono(telefono: string): Promise<User | undefined> {
    const user = await this.userRepository.findOne({ where: { telefono } });
    return user ?? undefined;  
  }

  async update(id: number, updateData: Partial<User>): Promise<User> {
    
    if ((updateData as any).planMensual !== undefined) {
        (updateData as any).planMensual = String((updateData as any).planMensual) as any;
      }

    await this.userRepository.update(id, updateData);
    const updatedUser = await this.findById(id);
    if (!updatedUser) {
      throw new BadRequestException('Usuario no encontrado');
    }
    return updatedUser;
  }

  async obtenerListadoUsuarios() {
    return await this.userRepository
      .createQueryBuilder('user')
      .where('LOWER(user.rol) != :rol', { rol: 'admin' }) // ⛔ Excluye admins
      .orderBy('user.apellido', 'ASC')
      .addOrderBy('user.nombre', 'ASC')
      .getMany(); // ✅ Incluye activos e inactivos
  }

  async inactivarUsuario(id: number): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: ['reservas', 'reservas.horario'],
    });
 
    if (!user) {
      throw new BadRequestException('Usuario no encontrado');
    }

    console.log('🔍 Usuario encontrado:', user);
    console.log('📋 Reservas del usuario:', user.reservas);

    // Marcar al usuario como inactivo
    user.activo = false;
    await this.userRepository.save(user);

    // Eliminar sus reservas
    if (user.reservas && user.reservas.length > 0) {
      for (const reserva of user.reservas) {

        console.log(`⛔ Eliminando reserva ID: ${reserva.id} de horario ID: ${reserva.horario.id}`);

        const horario = await this.horarioRepo.findOne({
          where: { id: reserva.horario.id },
          relations: ['reservas'],
        });

        if (horario) {
          horario.reformersReservados = Math.max(horario.reformersReservados - 1, 0);
          await this.horarioRepo.save(horario);
          console.log(`🛏️ Reformers disponibles actualizados en horario ${horario.id}`);
        }

        await this.reservaRepo.delete(reserva.id);
        console.log(`Reserva eliminada correctamente`);
        console.log(`🗑️ Reserva ${reserva.id} eliminada`);
      }
    } else {
    console.log('📭 El usuario no tiene reservas activas o no fueron cargadas.');
    }
    console.log(`Usuario ${user.nombre} tiene ${user.reservas.length} reservas`);
    for (const reserva of user.reservas) {
      console.log(`Eliminando reserva con ID: ${reserva.id} del horario ${reserva.horario.id}`);
    }

  }

  async findByEmailOrTelefono(usuario: string): Promise<User | undefined> {
    const input = (usuario ?? '').trim();

    // Si parece email, resolvemos directo por email
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)) {
      const byEmail = await this.userRepository.findOne({ where: { email: input } });
      return byEmail ?? undefined;
    }

    // Si no es email, asumimos teléfono en algún formato
    const digitsOnly = input.replace(/[^\d]/g, '');

    // Normalización mínima a formato WhatsApp AR: 549 + (sin 0 ni 15)
    const normalized = (() => {
      let tel = digitsOnly;
      if (tel.startsWith('00')) tel = tel.slice(2);
      if (tel.startsWith('0')) tel = tel.slice(1);
      if (tel.startsWith('54') && !tel.startsWith('549')) tel = '549' + tel.slice(2);
      if (!tel.startsWith('54')) tel = '549' + tel;
      tel = tel.replace(/^549(\d{2,4})15(\d+)/, '549$1$2');
      return tel;
    })();

    // Probar: exacto, solo dígitos, y normalizado
    const byTelExact   = await this.userRepository.findOne({ where: { telefono: input } });
    if (byTelExact) return byTelExact;

    const byTelDigits  = await this.userRepository.findOne({ where: { telefono: digitsOnly } });
    if (byTelDigits) return byTelDigits;

    const byTelNorm    = await this.userRepository.findOne({ where: { telefono: normalized } });
    return byTelNorm ?? undefined;
  }

  async findByEmailOrTelefonoAndPassword(usuario: string, password: string): Promise<User | undefined> {
    const user = await this.findByEmailOrTelefono(usuario);
    if (user && await bcrypt.compare(password, user.password)) {
      return user;
    }
    return undefined;
  }

  async setResetToken(id: number, token: string, expiry: Date) {
    await this.userRepository.update(id, {
      resetToken: token,
      resetTokenExpiry: expiry,
    });
  }

  async findByResetToken(token: string) {
    return this.userRepository.findOne({ where: { resetToken: token } });
  }

  async actualizarEstado(id: number, activo: boolean) {
    const user = await this.userRepository.findOneBy({ id });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    user.activo = activo;
    return this.userRepository.save(user);
  }

  //  Devuelve todos los alumnos ACTIVOS que tienen teléfono cargado.
  //  Excluye admins y usuarios sin teléfono. 
  async findActivosConTelefono(): Promise<User[]> {
    return this.userRepository
      .createQueryBuilder('user')
      .where('user.activo = :activo', { activo: true })
      .andWhere('LOWER(user.rol) = :rol', { rol: 'alumno' }) 
      .andWhere('user.telefono IS NOT NULL')
      .andWhere("TRIM(user.telefono) <> ''")
      .orderBy('user.apellido', 'ASC')
      .addOrderBy('user.nombre', 'ASC')
      .getMany();
  }
}