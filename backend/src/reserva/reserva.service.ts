import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, LessThan, LessThanOrEqual, Repository, MoreThan, MoreThanOrEqual } from 'typeorm';
import { Reserva, TipoReserva } from './reserva.entity';
import { Horario } from '../horarios/horarios.entity';
import { User } from '../users/user.entity';
import { addDays, format, startOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';
import { Cron } from '@nestjs/schedule';
import { AusenciaProfeService } from '../feriados/ausencia-profe.service';
import { WhatsAppService } from 'src/whatsapp/whatsapp.service';
import { Pago } from 'src/pagos/pagos.entity';
import { Notificacion } from 'src/notificaciones/notificacion.entity';
import { CierreTipo } from 'src/feriados/ausencia-profe.types';
import { TurnoFijo } from 'src/turnos-fijos/turnos-fijos.entity';

// Interfaz para la respuesta exitosa de la API de WhatsApp Cloud
interface WhatsAppMessageResponse {
  messaging_product: string;
  contacts?: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

// Interfaz para la respuesta de error de la API de WhatsApp Cloud
interface WhatsAppErrorResponse {
  error: {
    message: string;
    type: string;
    code: number;
    fbtrace_id: string;
  };
}

type BackfillResult =
| { ok: true; userId: number; cicloInicio: string; cicloFin: string}
| { ok: false; userId: number; reason: string };

@Injectable()
export class ReservaService {
  private static instancias = 0;

  constructor(
    @InjectRepository(Notificacion)
    private readonly notifRepo: Repository<Notificacion>,
    @InjectRepository(Reserva)
    private reservaRepo: Repository<Reserva>,
    @InjectRepository(Horario)
    private horarioRepo: Repository<Horario>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(Pago)
    private pagosRepo: Repository<Pago>,
    @InjectRepository(TurnoFijo)
    private turnoFijoRepo: Repository<TurnoFijo>, 
    private readonly ausenciaProfeService: AusenciaProfeService,
    private readonly whatsappService: WhatsAppService,
  ) { ReservaService.instancias++;
      console.log('🧩 ReservaService instanciado #', ReservaService.instancias);}

  async reservar(
    horarioId: number,
    userId: number,
    nombre: string,
    apellido: string,
    fechaTurno: string,
    tipo: TipoReserva = 'automatica',
    rol?: string,
  ) {
    const horario = await this.horarioRepo.findOne({ where: { id: horarioId } });
    if (!horario) throw new Error('Horario no encontrado');

    const usuario = await this.userRepo.findOne({ where: { id: userId } });
    if (!usuario) throw new Error('Usuario no encontrado');

    const esAdmin = (rol ?? '').toLowerCase() === 'admin';
    const ft = String(fechaTurno || '').slice(0, 10);

    // 🚦 Validar vigencia de plan (NO aplica a clases sueltas)
    let cicloPlan: {
      inicio: string;
      finVentana: string;
      finReal: string;
      maximas: number;
      usadas: number;
      completo: boolean;
    } | null = null;

    // 🚦 Validación de ciclo SOLO para alumnos (no admin)
    if (tipo !== 'suelta' && !esAdmin) {
      cicloPlan = await this.obtenerCicloPlanActualPorCantidad(userId, ft);
      if (!cicloPlan) {
        throw new BadRequestException('No tenés un ciclo de clases activo para esta fecha.');
      }
    }

    // ✅ Regla de nivel (solo alumno)
    if (!esAdmin) {
      const nivelTurno = String((horario as any).nivel ?? '').toLowerCase().trim();
      const nivelAlumno = String((usuario as any).nivel ?? (usuario as any).nivelAsignado ?? '')
        .toLowerCase()
        .trim();

      if (nivelTurno && nivelAlumno && nivelTurno !== nivelAlumno) {
        throw new BadRequestException('Este turno no corresponde a tu nivel.');
      }
    }

    // ✅ Bloqueo por AUSENCIA de profesora (cierre)
    const cierre = await this.ausenciaProfeService.hayCierre(ft, String(horario.hora).slice(0, 5));
    if (cierre) {
      throw new BadRequestException('Estudio cerrado por suspensión de clases.');
    }

    // ✅ Buscar existente (misma alumna + mismo horario + misma fecha)
    const existente = await this.reservaRepo.findOne({
      where: { usuario: { id: userId }, horario: { id: horarioId }, fechaTurno: ft },
    });

    // =========================================================
    // 1) MANEJO DE EXISTENTE (acá resolvemos tu caso)
    // =========================================================
    if (existente) {
      // 🔴 Ya hay una reserva activa
      if (existente.estado === 'reservado') {
        throw new BadRequestException('Ya tenés una reserva para ese día y horario.');
      }

      // 🔴 Está cancelada
      if (existente.estado === 'cancelado') {
        // ✅ Caso: canceló momentáneamente ESTE MISMO TURNO
        // y ahora quiere volver (elige RECUPERACIÓN)
        if (existente.cancelacionMomentanea && tipo === 'recuperacion') {
          // 1) validar cupo (por si alguien ocupó su lugar)
          const ocupadas = await this.reservaRepo.count({
            where: { horario: { id: horarioId }, fechaTurno: ft, estado: 'reservado' },
          });

          const total = Number(horario.totalReformers || 0);
          const bloqueados = Math.max(0, Number((horario as any).blockedReformers || 0));

          const libresTeoricos = Math.max(0, total - ocupadas);
          const bloqueadosAplicados = Math.min(bloqueados, libresTeoricos);
          const libresEfectivos = libresTeoricos - bloqueadosAplicados;

          if (libresEfectivos <= 0) {
            throw new BadRequestException('No hay reformers disponibles para volver a tomar tu lugar.');
          }

          // 2) Regla 1 hora (solo alumno)
          if (!esAdmin) {
            const ahora = new Date(
              new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }),
            );
            const hora = String(horario.hora || '00:00').slice(0, 5);
            const fechaHoraTurno = new Date(`${ft}T${hora}:00-03:00`);
            const diffMin = (fechaHoraTurno.getTime() - ahora.getTime()) / (1000 * 60);

            if (diffMin < 60) {
              throw new BadRequestException(
                'Para volver a tomar tu lugar, debe ser al menos 1 hora antes del inicio de la clase.',
              );
            }
          }

          // ✅ Reactivar la MISMA fila (no crear otra, no borrar)
          existente.estado = 'reservado';

          // 🔥 Recomendación: vuelve a ser "automática", porque volvió a su lugar habitual.
          // (así no “consume” recuperaciones ni genera confusión)
          existente.tipo = 'automatica';
          existente.automatica = true;

          existente.cancelacionMomentanea = false;
          existente.cancelacionPermanente = false;
          (existente as any).fechaCancelacion = null;

          // opcional: guardar auditoría de "reactivación"
          // existente.fechaReserva = this.ymdTodayAR();

          const guardada = await this.reservaRepo.save(existente);

          return {
            ...guardada,
            aviso: 'Vemos que cancelaste este mismo turno hoy. Si confirmás como Recuperación, volverás a tomar tu lugar.',
            reversionCancelacion: true,
          } as any;
        }

        // ❌ Si está cancelada momentáneamente y NO es recuperación, bloqueamos automática
        if (existente.cancelacionMomentanea && tipo === 'automatica') {
          throw new BadRequestException(
            'Ese día ya lo cancelaste por única vez para generar recuperación. No se puede volver a reservar automáticamente.',
          );
        }

        // ✅ Si fue cancelación permanente (o “rara”), borramos para permitir crear una nueva
        // (acá sí tiene sentido el remove)
        await this.reservaRepo.remove(existente);
      }
    }

    // =========================================================
    // 2) Chequeo de cupo (para reservas nuevas)
    // =========================================================
    const ocupadas = await this.reservaRepo.count({
      where: { horario: { id: horarioId }, fechaTurno: ft, estado: 'reservado' },
    });

    const total = Number(horario.totalReformers || 0);
    const bloqueados = Math.max(0, Number((horario as any).blockedReformers || 0));

    const libresTeoricos = Math.max(0, total - ocupadas);
    const bloqueadosAplicados = Math.min(bloqueados, libresTeoricos);
    const libresEfectivos = libresTeoricos - bloqueadosAplicados;

    if (libresEfectivos <= 0) {
      throw new BadRequestException('No hay reformers disponibles');
    }

    // =========================================================
    // 3) Validaciones por tipo
    // =========================================================

    // ✅ AUTOMÁTICA (solo alumno)
    if (tipo === 'automatica' && !esAdmin) {
      const { actuales, maximas } = await this.contarTotalClasesDelCiclo(userId, ft);
      if (actuales >= maximas) {
        throw new BadRequestException(
          `⚠️ Ya alcanzaste el límite de ${maximas} clases del ciclo (incluyendo recuperaciones).`,
        );
      }

      const { actuales: semanales, maximas: maxSemanales } =
        await this.contarReservasAutomaticasDeLaSemana(userId, ft);

      if (semanales >= maxSemanales) {
        throw new BadRequestException(
          `⚠️Ya alcanzaste el límite semanal de ${maxSemanales} clases según tu plan.`,
        );
      }
    }

    // ✅ RECUPERACIÓN
    if (tipo === 'recuperacion') {
      if (!cicloPlan) cicloPlan = await this.obtenerCicloPlanActualPorCantidad(userId, ft);
      if (!cicloPlan) throw new BadRequestException('No tenés un ciclo activo para usar recuperaciones.');

      if (cicloPlan.completo) {
        throw new BadRequestException('El plan ya fue completado por cantidad. No hay recuperaciones en este ciclo.');
      }

      if (ft < cicloPlan.inicio || ft > cicloPlan.finVentana) {
        throw new BadRequestException('La ventana de 30 días ya venció. No se pueden hacer recuperaciones.');
      }

      const cierreRecup = await this.ausenciaProfeService.hayCierre(ft, String(horario.hora).slice(0, 5));
      if (cierreRecup) {
        throw new BadRequestException('No podés reservar una recuperación: el estudio está cerrado en esa fecha/horario.');
      }

      if (this.turnoYaPaso(ft, String(horario.hora || '00:00').slice(0, 5))) {
        throw new BadRequestException('No podés reservar una recuperación para un turno pasado.');
      }

      if (!esAdmin) {
        const ahora = new Date(
          new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }),
        );
        const fechaHoraTurno = new Date(`${ft}T${String(horario.hora).slice(0, 5)}:00-03:00`);
        const diffMin = (fechaHoraTurno.getTime() - ahora.getTime()) / (1000 * 60);

        if (diffMin < 60) {
          throw new BadRequestException(
            'Las reservas de recuperación deben hacerse al menos 1 hora antes del inicio de la clase.',
          );
        }
      }

      const recuperacionesDisponibles = await this.contarCancelacionesMomentaneasDelMes(userId, ft);
      if (recuperacionesDisponibles <= 0) {
        throw new BadRequestException(
          'No tenés recuperaciones disponibles: primero debe existir una cancelación momentánea o un cierre del estudio.',
        );
      }
    }

    // ✅ SUELTA
    if (tipo === 'suelta') {
      const ahora = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }),
      );
      const fechaHoraTurno = new Date(`${ft}T${String(horario.hora).slice(0, 5)}:00-03:00`);
      const diffMin = (fechaHoraTurno.getTime() - ahora.getTime()) / (1000 * 60);

      if (diffMin < 60) {
        throw new BadRequestException('⏰ Las clases sueltas deben reservarse al menos 1 hora antes.');
      }
    }

    // =========================================================
    // 4) Crear reserva nueva
    // =========================================================
    const fechaReserva = this.ymdTodayAR();

    const nuevaReserva = this.reservaRepo.create({
      horario,
      usuario,
      nombre,
      apellido,
      fechaReserva,
      fechaTurno: ft,
      estado: 'reservado',
      tipo,
      automatica: tipo === 'automatica',
    });

    const reservaGuardada = await this.reservaRepo.save(nuevaReserva);

    // ✅ Si es turno habitual (automática), guardamos turno fijo
    if (tipo === 'automatica') {
      await this.activarTurnoFijo(userId, horarioId);
    }

    return reservaGuardada;
  }

  async obtenerReservasPorHorario(horarioId: number) {
    return this.reservaRepo.find({
      where: { horario: { id: horarioId } },
      relations: ['usuario'],
    });
  }

  async obtenerReservasPorUsuario(userId: number) {
    try {
      const reservas = await this.reservaRepo
        .createQueryBuilder('reserva')
        .leftJoinAndSelect('reserva.horario', 'horario')
        .leftJoinAndSelect('reserva.usuario', 'usuario')
        .where('reserva.usuarioId = :userId', { userId })
        .orderBy('horario.dia', 'ASC')
        .addOrderBy('horario.hora', 'ASC')
        .getMany();

      console.log('🎯 Reservas encontradas:', reservas);
      return reservas;
    } catch (error) {
      console.error('❌ Error al obtener reservas por usuario:', error);
      throw new HttpException(
        'No se pudieron obtener las reservas del usuario',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async anularReserva(reservaId: number) {
    const reserva = await this.reservaRepo.findOne({
      where: { id: reservaId },
      relations: ['horario'],
    });

    if (!reserva) throw new Error('Reserva no encontrada');

    const horario = reserva.horario;

    await this.reservaRepo.remove(reserva);

    return { mensaje: 'Reserva anulada correctamente' };
  }

  async editarReserva(reservaId: number, datos: { nombre?: string; apellido?: string; nuevoUserId?: number }) {
    const reserva = await this.reservaRepo.findOne({
      where: { id: reservaId },
      relations: ['usuario'],
    });

    if (!reserva) throw new Error('Reserva no encontrada');

    if (datos.nombre) reserva.nombre = datos.nombre;
    if (datos.apellido) reserva.apellido = datos.apellido;

    if (datos.nuevoUserId) {
      const nuevoUsuario = await this.userRepo.findOneBy({ id: datos.nuevoUserId });
      if (!nuevoUsuario) throw new Error('Nuevo usuario no encontrado');
      reserva.usuario = nuevoUsuario;
    }

    return this.reservaRepo.save(reserva);
  }

  async cancelarPorFecha(horarioId: number, userId: number, fechaTurno: string) {
    // ✅ 0) Validación: solo futuro (hoy o más adelante) en horario AR
    const hoyYMD = this.ymdTodayAR();
    const ft = String(fechaTurno || '').trim().slice(0, 10);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(ft)) {
      throw new BadRequestException('fechaTurno inválida (YYYY-MM-DD)');
    }

    if (ft < hoyYMD) {
      throw new BadRequestException('No se puede cancelar una clase pasada.');
    }

    fechaTurno = ft;

    const horario = await this.horarioRepo.findOne({ where: { id: horarioId } });
    if (!horario) throw new Error('Horario no encontrado');

    const usuario = await this.userRepo.findOne({ where: { id: userId } });
    if (!usuario) throw new Error('Usuario no encontrado');

    // ✅ Si el estudio está cerrado, NO es cancelación del alumno
    const cierre = await this.ausenciaProfeService.hayCierre(fechaTurno, horario.hora);
    if (cierre) {
      throw new BadRequestException('Ese día/horario el estudio está cerrado. No se cancela: queda como CERRADO.');
    }

    // 1) Busco cualquier fila existente para esa combinación
    const existente = await this.reservaRepo.findOne({
      where: {
        usuario: { id: userId },
        horario: { id: horarioId },
        fechaTurno,
      },
      relations: ['horario', 'usuario'],
    });
    
    // 2) Si existe → actualizar (pero sin pisar cierres)
    if (existente) {
      // 🔒 Si ya está cerrado por sistema, no lo conviertas en cancelado
      if (existente.estado === 'cerrado' || (existente as any).cierreEstudio === true) {
        throw new BadRequestException('Ese día ya está marcado como CERRADO por el estudio. No corresponde cancelación.');
      }

      if (existente.estado === 'cancelado') {
        throw new BadRequestException('Ya se canceló ese día.');
      }

      // ✅ Cancelación del alumno (momentánea)
      existente.estado = 'cancelado';
      existente.cancelacionMomentanea = true;
      existente.cancelacionPermanente = false;
      existente.fechaCancelacion = new Date();

      // ✅ CLAVE: esto evita el “mezclado”
      (existente as any).cierreEstudio = false;

      // (opcional pero recomendable: asegurar tipo coherente)
      (existente as any).tipo = 'automatica';
      existente.automatica = true;

      await this.reservaRepo.save(existente);
      return { mensaje: '✅ Reserva cancelada por esta vez.' };
    }

    // 3) Si no existía → crear “marca” cancelada del alumno
    const fechaReserva = this.ymdTodayAR();

    const reservaCancelada = this.reservaRepo.create({
      usuario,
      horario,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      fechaTurno,
      fechaReserva,

      estado: 'cancelado',
      automatica: true,

      // ✅ cancelación del alumno
      cancelacionMomentanea: true,
      cancelacionPermanente: false,
      fechaCancelacion: new Date(),

      // ✅ CLAVE: explícito para no confundir con cierre
      cierreEstudio: false,

      // (si tu entity tiene tipo)
      tipo: 'automatica',
    } as any);

    await this.reservaRepo.save(reservaCancelada);
    return { mensaje: '✅ Reserva cancelada por esta vez.' };
  }

  private ymdFromDateAR(d: Date) {
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d);

    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  private ymdStartOfMonthAR(refYMD: string) {
    const d = new Date(`${refYMD}T00:00:00-03:00`);
    d.setDate(1);
    return this.ymdFromDateAR(d);
  }

  private ymdEndOfMonthAR(refYMD: string) {
    const d = new Date(`${refYMD}T00:00:00-03:00`);
    d.setMonth(d.getMonth() + 1, 0); // último día del mes
    return this.ymdFromDateAR(d);
  }

  async contarReservasAutomaticasDelMes(userId: number, fechaTurno: string): Promise<{ actuales: number, maximas: number }> {
    const usuario = await this.userRepo.findOne({ where: { id: userId } });
    if (!usuario) throw new Error('Usuario no encontrado');

    const clasesMaximas = parseInt(usuario.planMensual ?? '4', 10); // 👈 convierte el plan a número

    const fecha = new Date(fechaTurno);
    const inicioMes = this.ymdStartOfMonthAR(fechaTurno);
    const finMes    = this.ymdEndOfMonthAR(fechaTurno);


    const actuales = await this.reservaRepo.count({
      where: {
        usuario: { id: userId },
        automatica: true,
        fechaTurno: Between(inicioMes, finMes),
      },
    });

    return {
      actuales,
      maximas: clasesMaximas,
    };
  }

  async contarReservasAutomaticasDeLaSemana(
    userId: number,
    fechaTurno: string,
  ): Promise<{ actuales: number; maximas: number }> {
    const usuario = await this.userRepo.findOne({ where: { id: userId } });
    if (!usuario) throw new Error('Usuario no encontrado');

    const planMensual = parseInt(usuario.planMensual ?? '4', 10);
    const clasesMaximasPorSemana = Math.floor(planMensual / 4);

    const fecha = new Date(`${fechaTurno}T12:00:00-03:00`);

    const primerDiaSemana = new Date(fecha);
    primerDiaSemana.setDate(fecha.getDate() - fecha.getDay() + 1); // Lunes

    const ultimoDiaSemana = new Date(primerDiaSemana);
    ultimoDiaSemana.setDate(primerDiaSemana.getDate() + 6); // Domingo

    const desde = this.ymdFromDateAR(primerDiaSemana);
    const hasta = this.ymdFromDateAR(ultimoDiaSemana);

    const actuales = await this.reservaRepo.count({
      where: {
        usuario: { id: userId },
        automatica: true,
        cancelacionPermanente: false,
        estado: 'reservado',
        fechaTurno: Between(desde, hasta),
      },
    });


    return {
      actuales,
      maximas: clasesMaximasPorSemana,
    };
  }

  async cancelarReservaPorUsuario(
    id: number,
    tipo: 'momentanea' | 'permanente',
    user: any,
  ) {
    const reserva = await this.reservaRepo.findOne({
      where: { id },
      relations: ['usuario', 'horario'],
    });

    if (!reserva) throw new NotFoundException('Reserva no encontrada');

    const userId = user?.id ?? user?.sub;
    const rol = (user?.rol ?? '').toLowerCase();

    // 🔐 Solo dueño o admin
    if (!reserva.usuario || (reserva.usuario.id !== Number(userId) && rol !== 'admin')) {
      throw new ForbiddenException('No podés cancelar esta reserva');
    }

    // ✅ Determinar tipo real (más confiable que automatica sola)
    const tipoReserva = String((reserva as any).tipo ?? '').toLowerCase();

    // ⏱ Regla 2 horas (solo alumno)
    const ahora = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }),
    );
    const turno = new Date(`${reserva.fechaTurno}T${reserva.horario.hora}:00-03:00`);
    const diffHs = (turno.getTime() - ahora.getTime()) / (1000 * 60 * 60);
    if (rol !== 'admin' && diffHs < 2) {
      throw new BadRequestException('Solo se puede cancelar hasta 2 horas antes del turno.');
    }

    // ✅ 1) SUELTA → borrado físico
    if (tipoReserva === 'suelta') {
      if (reserva.horario) {
        reserva.horario.reformersReservados = Math.max(0, reserva.horario.reformersReservados - 1);
        await this.horarioRepo.save(reserva.horario);
      }
      await this.reservaRepo.remove(reserva);
      return { mensaje: '✅ Reserva eliminada.' };
    }

    // ✅ 2) RECUPERACIÓN → borrado físico
    if (tipoReserva === 'recuperacion') {
      if (reserva.horario) {
        reserva.horario.reformersReservados = Math.max(0, reserva.horario.reformersReservados - 1);
        await this.horarioRepo.save(reserva.horario);
      }
      await this.reservaRepo.remove(reserva);
      return { mensaje: '✅ Recuperación eliminada.' };
    }

    // ✅ 3) AUTOMÁTICA → se marca (no se borra)

    // ✅ Reset SIEMPRE flags (evita que queden “pegados”)
    reserva.cancelacionMomentanea = false;
    reserva.cancelacionPermanente = false;

    // ⛔️ Si cae en cierre → marcar como CERRADO (NO "cancelado")
    const cierre = await this.ausenciaProfeService.hayCierre(
      reserva.fechaTurno,
      reserva.horario.hora,
    );

    if (cierre) {
      // ✅ cierre = crédito de recuperación
      reserva.estado = 'cerrado';
      reserva.cancelacionMomentanea = true; // cuenta como “ganada”
      reserva.cancelacionPermanente = false;
      reserva.fechaCancelacion = new Date();

      // libera cama si estaba contada
      if (reserva.horario) {
        reserva.horario.reformersReservados = Math.max(0, reserva.horario.reformersReservados - 1);
        await this.horarioRepo.save(reserva.horario);
      }

      await this.reservaRepo.save(reserva);

      return {
        mensaje: '📌 Estudio cerrado: la reserva quedó marcada como CERRADA y se acredita recuperación.',
      };
    }

    // ✅ Caso normal: cancelación del alumno
    reserva.estado = 'cancelado';
    reserva.fechaCancelacion = new Date();

    if (tipo === 'momentanea') {
      reserva.cancelacionMomentanea = true;
    } else {
      reserva.cancelacionPermanente = true;
      // ✅ Baja del turno fijo SOLO si es automática habitual
      // (no aplica a recuperaciones ni sueltas, que ya se borran físicamente arriba)
      if (tipoReserva === 'automatica' || reserva.automatica === true) {
        await this.desactivarTurnoFijo(reserva.usuario.id, reserva.horario.id, 'cancelacion_permanente');
      }

    }

    if (reserva.horario) {
      reserva.horario.reformersReservados = Math.max(0, reserva.horario.reformersReservados - 1);
      await this.horarioRepo.save(reserva.horario);
    }

    await this.reservaRepo.save(reserva);

    return {
      mensaje:
        tipo === 'momentanea'
          ? '✅ Reserva cancelada por esta vez. Podrás recuperar la clase.'
          : '✅ Reserva cancelada permanentemente. Dejá ese turno y podés elegir otro.',
    };
  }

  // Se ha añadido este cron job para generar las reservas automáticas
  // Se ejecuta todos los viernes a las 21:00 hora de Argentina
  @Cron('0 21 * * 5', { timeZone: 'America/Argentina/Buenos_Aires' })
  async cronGenerarSemanaSiguiente() {
    console.log('🕘 [CRON] Disparó cronGenerarSemanaSiguiente', new Date().toISOString());
    // Fecha/hora actual en zona horaria de Argentina
    const ahoraAR = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }),
    );
    // Lunes de la semana siguiente (base para generar reservas)
    const lunesSiguiente = startOfWeek(addDays(ahoraAR, 7), { weekStartsOn: 1 });
    // Genera reservas automáticas para la semana que arranca ese lunes
    await this.generarReservasRecurrentesSemanaActual(lunesSiguiente);
  }

  async generarReservasRecurrentesSemanaActual(lunesBaseParaSistema: Date) {
    const lunes = startOfWeek(lunesBaseParaSistema, { weekStartsOn: 1 });

    for (let i = 0; i < 5; i++) {
      const fecha = addDays(lunes, i);
      const fechaTurno = format(fecha, 'yyyy-MM-dd');

      const diaNombre = format(fecha, 'EEEE', { locale: es });
      const diaCapitalizado = diaNombre.charAt(0).toUpperCase() + diaNombre.slice(1);

      const horariosDelDia = await this.horarioRepo.find({
        where: { dia: diaCapitalizado },
        // relations: ['reservas', 'reservas.usuario'],
      });

      for (const horario of horariosDelDia) {
        const usuarioIdsFijos = await this.obtenerUsuariosFijosPorHorario(horario.id);

        const cierre = await this.ausenciaProfeService.hayCierre(fechaTurno, (horario as any).hora);

        // ✅ 1) SI HAY CIERRE → marcas cierreEstudio para cada involucrado
        if (cierre) {
          console.log(`🛑 Cierre ${cierre} en ${fechaTurno} ${(horario as any).hora} → marcas cierreEstudio`);

          for (const usuarioId of usuarioIdsFijos) {
  
            const existente = await this.reservaRepo.findOne({
              where: {
                usuario: { id: usuarioId },
                horario: { id: horario.id },
                fechaTurno,
              } as any,
            });

            if (existente) {
              // Si el alumno ya canceló por su cuenta (momentánea) no dupliques crédito
              const est = String(existente.estado || '').toLowerCase();
              const esCancelAlumno =
                (est === 'cancelado' || est === 'cancelada') &&
                existente.cancelacionMomentanea === true &&
                (existente as any).cierreEstudio === false;

              if (esCancelAlumno) {
                // ✅ misma fila: pasa a representar cierre del estudio (sin duplicar créditos)
                existente.estado = 'cerrado';
                existente.automatica = true;
                existente.tipo = 'automatica';
                existente.cierreEstudio = true;

                // sigue siendo “crédito”, pero UNO SOLO
                existente.cancelacionMomentanea = true;
                existente.cancelacionPermanente = false;

                existente.fechaCancelacion = existente.fechaCancelacion ?? new Date();
                await this.reservaRepo.save(existente);
                continue;
              }

              // ✅ pisa a “cerrado” por cierre del estudio
              existente.estado = 'cerrado';
              existente.automatica = true;
              existente.tipo = 'automatica';
              existente.cierreEstudio = true;

              // ✅ crédito de recuperación por cierre
              existente.cancelacionMomentanea = true;
              existente.cancelacionPermanente = false;

              existente.fechaCancelacion = new Date();
              await this.reservaRepo.save(existente);
              continue;
            }

            const u = await this.userRepo.findOne({ where: { id: usuarioId } });
            if (!u) continue;

            const nuevaCierre = this.reservaRepo.create({
              horario,
              usuario: u,
              nombre: u.nombre ?? 'Alumno',
              apellido: u.apellido ?? '',
              fechaTurno,
              fechaReserva: format(new Date(), 'yyyy-MM-dd'),

              estado: 'cerrado',
              automatica: true,
              tipo: 'automatica',

              cierreEstudio: true,
              cancelacionMomentanea: true,
              cancelacionPermanente: false,
              fechaCancelacion: new Date(),
            } as any);

            await this.reservaRepo.save(nuevaCierre);
          }

          continue; // ✅ cerrado → NO reservas normales
        }

        // ✅ 2) SI NO HAY CIERRE → generar reservas automáticas normales
        for (const usuarioId of usuarioIdsFijos) {

          // Si el alumno canceló por su cuenta ese día (momentánea), NO generes “reservado”
          const canceladaPorAlumno = await this.reservaRepo
            .createQueryBuilder('r')
            .where('r."usuarioId" = :uid', { uid: usuarioId })
            .andWhere('r."horarioId" = :hid', { hid: horario.id })
            .andWhere('r."fechaTurno" = :ft', { ft: fechaTurno })
            .andWhere(`LOWER(r.estado) IN ('cancelado','cancelada')`)
            .andWhere('r."cancelacionMomentanea" = true')
            .andWhere('COALESCE(r."cierreEstudio", false) = false')
            .getOne();

          if (canceladaPorAlumno) continue;


          // ✅ Antiduplicado definitivo: si ya existe CUALQUIER fila, no crees otra
          const existente = await this.reservaRepo.findOne({
            where: {
              usuario: { id: usuarioId },
              horario: { id: horario.id },
              fechaTurno,
            } as any,
          });
          if (existente) continue;

          // ✅ Cupo efectivo (respeta bloqueados)
          const total = Number((horario as any).totalReformers ?? 0);
          const bloqueados = Math.max(0, Number((horario as any).blockedReformers ?? 0));

          const ocupadas = await this.reservaRepo.count({
            where: { horario: { id: horario.id }, fechaTurno, estado: 'reservado' } as any,
          });

          const libresTeoricos = Math.max(0, total - ocupadas);
          const bloqueadosAplicados = Math.min(bloqueados, libresTeoricos);
          const libresEfectivos = libresTeoricos - bloqueadosAplicados;

          if (libresEfectivos <= 0) continue;

          const u = await this.userRepo.findOne({ where: { id: usuarioId } });
          if (!u) continue;

          const nuevaReserva = this.reservaRepo.create({
            horario,
            usuario: u,
            nombre: u.nombre ?? 'Alumno',
            apellido: u.apellido ?? '',
            fechaTurno,
            fechaReserva: format(new Date(), 'yyyy-MM-dd'),
            estado: 'reservado',
            automatica: true,
            tipo: 'automatica',
            cierreEstudio: false,
            cancelacionMomentanea: false,
            cancelacionPermanente: false,
          } as any);

          await this.reservaRepo.save(nuevaReserva);
        }
      }
    }

    console.log('✅ Finalizada generación de reservas automáticas de la semana.');
  }

  async marcarReservasMomentaneasComoRecuperadas() {
    const hoyYMD = this.ymdTodayAR();

    const reservasRecuperadas = await this.reservaRepo.find({
      where: {
        automatica: false,
        tipo: 'recuperacion',
        estado: 'reservado',
        fechaTurno: LessThanOrEqual(hoyYMD),
      },
      relations: ['horario'],
    });

    for (const reserva of reservasRecuperadas) {
      // Liberar la cama
      if (reserva.horario) {
        reserva.horario.reformersReservados = Math.max(0, reserva.horario.reformersReservados - 1);
        await this.horarioRepo.save(reserva.horario);
      }

      // Marcar como "recuperada"
      reserva.estado = 'recuperada';
      reserva.fechaCancelacion = new Date(); // opcional, puede llamarse fechaRegistroFinal si querés

      await this.reservaRepo.save(reserva);
      console.log(`✅ Reserva marcada como recuperada: ${reserva.nombre} ${reserva.apellido} (${reserva.fechaTurno})`);
    }
  }

    // ✅ Corre cada 30 minutos y cierra recuperaciones vencidas “en tiempo real”
  @Cron('*/30 * * * *', { timeZone: 'America/Argentina/Buenos_Aires' })
  async cerrarRecuperacionesVencidas() {
    const ahora= new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }),
    );
    const hoyYMD = this.ymdTodayAR();

    const recs = await this.reservaRepo.find({
      where: {
        automatica: false,
        tipo: 'recuperacion',
        estado: 'reservado',
        fechaTurno: LessThanOrEqual(hoyYMD),
      },
      relations: ['horario'],
    });

    for (const r of recs) {
      // Arma la fecha-hora local del turno (BA -03:00)
      const turnoDate = new Date(`${r.fechaTurno}T${r.horario.hora}:00-03:00`);
      if (turnoDate.getTime() <= ahora.getTime()) {
        r.estado = 'recuperada';          // one-shot ✅
        r.fechaCancelacion = ahora;  // marca de cierre (opcional)
        await this.reservaRepo.save(r);
      }
    }
  }

  async contarCancelacionesMomentaneasDelMes(
    userId: number,
    fechaTurno: string,
  ): Promise<number> {
    const ciclo = await this.obtenerCicloPlanActualPorCantidad(userId, fechaTurno);
    if (!ciclo) return 0;

    // ✅ Regla: si el ciclo completó por cantidad, NO hay recuperaciones
    if (ciclo.completo) return 0;

    const inicio = ciclo.inicio;
    const finVentana = ciclo.finVentana;

    // 1) Traemos TODOS los "créditos posibles" del ciclo (sin contar todavía)
    //    - cancelado momentáneo del alumno (automática)
    //    - cerrado por estudio (cierreEstudio=true)
    const creditos = await this.reservaRepo.find({
      where: [
        {
          usuario: { id: userId },
          tipo: 'automatica',
          estado: 'cancelado',
          cancelacionMomentanea: true,
          // importante: solo cancelación del alumno (no cierre)
          cierreEstudio: false as any,
          fechaTurno: Between(inicio, finVentana),
        } as any,
        {
          usuario: { id: userId },
          estado: 'cerrado',
          cierreEstudio: true,
          fechaTurno: Between(inicio, finVentana),
        } as any,
      ],
      relations: ['horario'],
      select: [
        'id',
        'estado',
        'fechaTurno',
        'cancelacionMomentanea',
        'cancelacionPermanente',
        'cierreEstudio',
      ] as any,
    });

    // 2) Dedupe por celda (fechaTurno + horarioId) con prioridad:
    //    cerrado (cierreEstudio=true) > cancelado momentáneo alumno
    const keyOf = (r: any) => `${String(r?.fechaTurno ?? '').slice(0, 10)}|${Number(r?.horario?.id ?? 0)}`;
    const creditosPorCelda = new Map<string, 'cerrado' | 'cancelado'>();

    for (const r of creditos) {
      const key = keyOf(r);
      const cierre = (r as any).cierreEstudio === true;

      if (r.estado === 'cerrado' && cierre) {
        // prioridad máxima
        creditosPorCelda.set(key, 'cerrado');
        continue;
      }

      // cancelado momentáneo alumno (solo si no hay cierre ya)
      const esCancelAlumno =
        r.estado === 'cancelado' &&
        (r as any).cancelacionMomentanea === true &&
        cierre === false &&
        !((r as any).cancelacionPermanente === true);

      if (esCancelAlumno && !creditosPorCelda.has(key)) {
        creditosPorCelda.set(key, 'cancelado');
      }
    }

    const creditosUnicos = creditosPorCelda.size;

    // 3) Recuperaciones usadas dentro de la ventana (igual que antes)
    const usadasRecup = await this.reservaRepo.count({
      where: {
        usuario: { id: userId },
        tipo: 'recuperacion',
        estado: In(['reservado', 'recuperada']),
        fechaTurno: Between(inicio, finVentana),
      } as any,
    });

    return Math.max(0, creditosUnicos - usadasRecup);
  }

  // ✅ Clases efectivamente asistidas (automáticas + recuperaciones) dentro del ciclo del plan
  private async contarClasesAsistidasEnCiclo(
    userId: number,
    refFecha: string,
  ): Promise<{ actuales: number; maximas: number }> {
    const usuario = await this.userRepo.findOne({ where: { id: userId } });
    if (!usuario) throw new Error('Usuario no encontrado');

    const maximas = parseInt(usuario.planMensual ?? '4', 10);

    const ciclo = await this.obtenerCicloPlanActualPorCantidad(userId, refFecha);
    if (!ciclo) return { actuales: 0, maximas };

    const finEfectivo = ciclo.completo ? ciclo.finReal : ciclo.finVentana;

    // ✅ a la fecha
    const ref = String(refFecha || '').trim().slice(0, 10);
    let finCapado = finEfectivo;
    if (ref && ref < finCapado) finCapado = ref;

    const reservas = await this.reservaRepo.find({
      where: {
        usuario: { id: userId },
        fechaTurno: Between(ciclo.inicio, finCapado),
        tipo: In(['automatica', 'recuperacion']),
      } as any,
      relations: ['horario'],
    });

    let usadas = 0;

    for (const r of reservas) {
      const fecha = String(r.fechaTurno || '').slice(0, 10);
      const hora = (r.horario?.hora ?? '00:00').slice(0, 5);

      // ✅ a la fecha: tiene que haber pasado
      if (!this.turnoYaPaso(fecha, hora)) continue;

      // ✅ nunca cuentan canceladas
      if (r.estado === 'cancelado') continue;

      // ✅ cierres NO cuentan como asistidas (eso se muestra en otra columna del modal)
      const cierreEstudio = (r as any).cierreEstudio === true;
      if (r.estado === 'cerrado' && cierreEstudio) continue;

      const tipo = String((r as any).tipo ?? '').toLowerCase();

      if (tipo === 'recuperacion') {
        if (r.estado === 'reservado' || r.estado === 'recuperada') usadas++;
        continue;
      }

      // automática
      if (r.estado === 'reservado') usadas++;
    }

    return { actuales: usadas, maximas };
  }

  async findByRango(desde: string, hasta: string) {
    try {
      return await this.reservaRepo
        .createQueryBuilder('r')
        .leftJoin('r.horario', 'h')
        .select([
          'r.fechaTurno AS "fechaTurno"',
          'h.id        AS "horarioId"',
        ])
        .where('r.estado = :estado', { estado: 'reservado' })
        .andWhere('r.fechaTurno BETWEEN :desde AND :hasta', { desde, hasta })
        .groupBy('r.fechaTurno, h.id')
        .getRawMany<{ fechaTurno: string; horarioId: number }>();
    } catch (e: any) {
      console.error('findByRango() falló:', e?.message || e);
      return [];
    }
  }

  async notificarLimiteDeClases(userId: number, fechaTurno: string) {
    // 🔁 ahora contamos CLASES ASISTIDAS, no reservas totales
    const { actuales, maximas } = await this.contarClasesAsistidasEnCiclo(userId, fechaTurno);
    const usuario = await this.userRepo.findOne({ where: { id: userId } });

    if (!usuario) {
      console.error('No se encontró al usuario para la notificación');
      return;
    }

    // 🧾 tipo de plan para el mensaje
    const planType = `${usuario.planMensual} clases / mes`;
    console.log(
      `📊 notifLimite userId=${userId} fechaTurno=${fechaTurno} actuales=${actuales} maximas=${maximas} plan=${usuario.planMensual}`,
    );

    // ✅ ciclo actual (lo usamos para dedupe de ambos avisos)
    const ciclo = await this.obtenerCicloPlanActualPorCantidad(userId, fechaTurno);
    console.log(
      `📦 cicloActual inicio=${ciclo?.inicio} finVentana=${ciclo?.finVentana} completo=${ciclo?.completo}`,
    );
    if (!ciclo) return;

    // =========================================================
    // ✅ 1) AVISO: PLAN POR VENCER (TU CÓDIGO, SIN CAMBIOS)
    // =========================================================
    if (usuario.telefono && actuales === maximas - 1) {
      // ✅ DEDUPE REAL: si ya avisamos en el ciclo de plan, no volvemos a enviar
      const yaAvisado = await this.notifRepo.findOne({
        where: {
          usuarioId: userId,
          tipo: 'plan_por_vencer',
          cicloInicio: ciclo.inicio,
          cicloFin: ciclo.finVentana,
        },
      });

      if (yaAvisado) return;

      try {
        await this.whatsappService.sendTemplatePlanPorVencer(
          usuario.telefono,
          usuario.nombre,
          planType,
        );

        // ✅ Guardamos marca para no reenviar en este ciclo
        try {
          await this.notifRepo.insert({
            usuarioId: userId,
            tipo: 'plan_por_vencer',
            cicloInicio: ciclo.inicio,
            cicloFin: ciclo.finVentana,
          });
        } catch {
          // si ya existía por condición de carrera, no hacemos nada
        }

        console.log(
          `✅ Aviso de plan por vencer enviado a ${usuario.nombre} (${usuario.telefono}) [${planType}]`,
        );
      } catch (e) {
        console.error('❌ Error al enviar aviso:', e);
      }
    }

    // =========================================================
    // ✅ 2) AVISO: PLAN VENCIDO (con chequeo de pago del ciclo nuevo)
    // Regla: se manda cuando el alumno toma la PRIMERA clase del ciclo nuevo
    // (cronológicamente, es la clase "planMax + 1")
    // =========================================================
    try {
      if (usuario.telefono && actuales >=1) {
        // ciclo anterior = el ciclo que estaba vigente el día anterior al inicio del ciclo actual
        const refPrev = this.ymdAddDays(ciclo.inicio, -1);
        const cicloAnterior = await this.obtenerCicloPlanActualPorCantidad(userId, refPrev);

        // Solo si el ciclo anterior existía y se COMPLETÓ por cantidad
        if (cicloAnterior?.completo) {
          // ✅ Si ya existe pago del ciclo NUEVO, NO mandar plan vencido
          const pagoCicloNuevo = await this.pagosRepo.findOne({
            where: {
              userId: userId,
              cicloInicio: ciclo.inicio,
              cicloFin: ciclo.finVentana,
            },
            select: ['id', 'fechaPago'],
          });

          // ✅ Si NO pagó el ciclo nuevo, recién ahí evaluamos dedupe + envío
          if (!pagoCicloNuevo?.fechaPago) {
            const yaAvisadoVencido = await this.notifRepo.findOne({
              where: {
                usuarioId: userId,
                tipo: 'plan_vencido',
                // dedupe por el ciclo NUEVO (porque es cuando se "debe")
                cicloInicio: ciclo.inicio,
                cicloFin: ciclo.finVentana,
              },
            });

            if (!yaAvisadoVencido) {
              await this.whatsappService.sendTemplatePlanVencido(
                usuario.telefono,
                usuario.nombre,
                planType,
              );

              try {
                await this.notifRepo.insert({
                  usuarioId: userId,
                  tipo: 'plan_vencido',
                  cicloInicio: ciclo.inicio,
                  cicloFin: ciclo.finVentana,
                });
              } catch {
                // condición de carrera: ya insertado
              }

              console.log(
                `⚠️ Aviso de PLAN VENCIDO enviado a ${usuario.nombre} (${usuario.telefono}) [${planType}]`,
              );
            }
          }
        }
      }
    } catch (e) {
      console.error('❌ Error al enviar aviso de plan vencido:', e);
    }
  }

  @Cron('*/30 * * * *', { timeZone: 'America/Argentina/Buenos_Aires' }) // notifica revisando cada 30 minutos
  async notificarPenultimaClaseDelDia() {
    // Fecha/hora “Argentina”
    const ahoraAR = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }),
    );

    const hoyYMD = format(ahoraAR, 'yyyy-MM-dd');
    console.log(`📆 CRON notificarPenultimaClaseDelDia para ${hoyYMD}...`);

    const reservasDeHoy = await this.reservaRepo.find({
      where: {
        fechaTurno: hoyYMD,
        estado: 'reservado',
        tipo: In(['automatica', 'recuperacion']),
      },
      relations: ['usuario', 'horario'],
    });

    // ✅ Evitar repetir dentro de la misma corrida:
    const usuariosProcesados = new Set<number>();

    for (const r of reservasDeHoy) {
      if (!r.usuario) continue;
      if (usuariosProcesados.has(r.usuario.id)) continue;

      const horaTurno = r.horario?.hora ?? '00:00';
      const turnoDate = new Date(`${r.fechaTurno}T${horaTurno}:00-03:00`);

      // Si el turno todavía no pasó, no avisamos aún
      if (turnoDate.getTime() > ahoraAR.getTime()) continue;

      try {
        console.log(
          `🔔 CRON: voy a evaluar userId=${r.usuario.id} fecha=${r.fechaTurno} hora=${horaTurno} turnoDate=${turnoDate.toISOString()} ahoraAR=${ahoraAR.toISOString()}`
        );

        await this.notificarLimiteDeClases(r.usuario.id, r.fechaTurno);
        usuariosProcesados.add(r.usuario.id);
      } catch (e) {
        console.error(
          `❌ Error al intentar notificar límite de clases para usuario ${r.usuario.id} en ${r.fechaTurno}:`,
          e,
        );
      }
    }

    console.log('✅ CRON notificarPenultimaClaseDelDia finalizado.');
  }

  private turnoYaPaso(fechaTurno: string, horaHHmm: string): boolean {
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date());

    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00';

    const ahoraAR = new Date(
      `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}-03:00`
    );

    const f = String(fechaTurno || '').slice(0, 10);
    const h = String(horaHHmm || '00:00').slice(0, 5);

    const turnoAR = new Date(`${f}T${h}:00-03:00`);
    if (Number.isNaN(turnoAR.getTime())) return false;
    if (Number.isNaN(ahoraAR.getTime())) return false;
    return turnoAR.getTime() <= ahoraAR.getTime() + 60_000;

    // ⏱️ margen de 60 segundos
    return turnoAR.getTime() <= ahoraAR.getTime() + 60_000;
  }

  private ymdAddDays(ymd: string, days: number) {
    const d = new Date(`${ymd}T00:00:00-03:00`);
    d.setDate(d.getDate() + days);
    return this.ymdFromDateAR(d);
  }

  private ymdTodayAR() {
    const ahoraAR = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }),
    );
    const y = ahoraAR.getFullYear();
    const m = String(ahoraAR.getMonth() + 1).padStart(2, '0');
    const d = String(ahoraAR.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  public async getCicloPlanActual(userId: number, refYMD: string) {
    return this.obtenerCicloPlanActualPorCantidad(userId, refYMD);
  }
  
  public calcularFinVentanaDesdeInicio(inicioYMD: string): string {
    // Ventana de 30 días (como tu ejemplo 2026-01-05 -> 2026-02-04)
    return this.addDaysYMD(inicioYMD, 29);
  }

  private addDaysYMD(ymd: string, days: number) {
    const d = new Date(`${ymd}T00:00:00-03:00`);
    d.setDate(d.getDate() + days);
    return this.ymdFromDateAR(d);
  }

  private async obtenerCicloPlanActualPorCantidad(
    userId: number,
    refYMD: string,
  ): Promise<{
    inicio: string;
    finVentana: string;
    finReal: string;
    usadas: number;
    maximas: number;
    completo: boolean;
  } | null> {
    const usuario = await this.userRepo.findOne({ where: { id: userId } });
    if (!usuario) return null;

    const maximas = parseInt(usuario.planMensual ?? '4', 10);
    if (!Number.isFinite(maximas) || maximas <= 0) return null;

    const ref = String(refYMD || '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ref)) return null;

    const ymd = (d: any) => String(d ?? '').slice(0, 10);

    // 1) Traer automáticas NO permanentes en un rango amplio alrededor de ref (para no “perder” el inicio real)
    const desde = this.ymdAddDays(ref, -240);
    const hasta = this.ymdAddDays(ref, +120);

    const autos = await this.reservaRepo.find({
      where: {
        usuario: { id: userId },
        tipo: 'automatica',
        cancelacionPermanente: false,
        fechaTurno: Between(desde, hasta),
      } as any,
      order: { fechaTurno: 'ASC', id: 'ASC' } as any,
    });

    // Fallback total: buscar la primera automática >= ref
    // if (!autos.length) {
    //   const next = await this.reservaRepo.findOne({
    //     where: {
    //       usuario: { id: userId },
    //       tipo: 'automatica',
    //       cancelacionPermanente: false,
    //       fechaTurno: MoreThanOrEqual(ref),
    //     } as any,
    //     order: { fechaTurno: 'ASC', id: 'ASC' } as any,
    //   });
    //   if (!next?.fechaTurno) return null;

    //   const inicio = ymd(next.fechaTurno);
    //   return this.construirCicloDesdeInicio(userId, inicio, maximas);
    // }
      
    // Fallback: si no hay automáticas, no hay ciclo
    if (!autos.length) return null;

     // 2) anchor cercano a ref
    const anchor = autos.filter(a => ymd(a.fechaTurno) <= ref).at(-1) ?? autos[0];
    let start = ymd(anchor.fechaTurno);

    // 3) retroceder para encontrar el inicio real (hasta 30 días hacia atrás, repetido)
    for (let guard = 0; guard < 60; guard++) {
      const lower = this.ymdAddDays(start, -29);

      const prev =
        [...autos].reverse().find(a => {
          const d = ymd(a.fechaTurno);
          return d < start && d >= lower;
        }) ??
        (await this.reservaRepo.findOne({
          where: {
            usuario: { id: userId },
            tipo: 'automatica',
            cancelacionPermanente: false,
            fechaTurno: Between(lower, this.ymdAddDays(start, -1)),
          } as any,
          order: { fechaTurno: 'DESC', id: 'DESC' } as any,
        }));

      if (!prev?.fechaTurno) break;
      start = ymd(prev.fechaTurno);
    }


     // 4) avanzar ciclos hasta encerrar ref
    for (let guard = 0; guard < 60; guard++) {
      const ciclo = await this.construirCicloDesdeInicio(userId, start, maximas);
      const finEfectivo = ciclo.completo ? ciclo.finReal : ciclo.finVentana;
      // ✅ ref dentro de este ciclo
      if (ref >= ciclo.inicio && ref <= finEfectivo) return ciclo;
      // ✅ ref posterior: buscar próximo inicio por TURNO FIJO (la regla real)
      if (ref > finEfectivo) {
        const nextStart = await this.proximaFechaTurnoFijoDespuesDe(userId, finEfectivo);
        if (!nextStart) return null;
        start = nextStart;
        continue;
      }

      // ref < inicio (raro): retroceder una automática y volver a intentar
      const prevAny =
        [...autos].reverse().find(a => ymd(a.fechaTurno) < start) ??
        (await this.reservaRepo.findOne({
          where: {
            usuario: { id: userId },
            tipo: 'automatica',
            cancelacionPermanente: false,
            fechaTurno: LessThan(start),
          } as any,
          order: { fechaTurno: 'DESC', id: 'DESC' } as any,
        }));

      if (!prevAny?.fechaTurno) return null;
      start = ymd(prevAny.fechaTurno);
    }

    return null;
  }

/*
 * ✅ Construye un ciclo usando:
 * - inicio = automática ancla (aunque esté cancelada o cerrado)
 * - finVentana = inicio + 30
 * - completo si dentro de [inicio, finVentana] hay >= planMax "usadas" (consumidas)
 * - finReal = fecha de la N-ésima usada (planMax) si completo
 */
  private async construirCicloDesdeInicio(
    userId: number,
    inicioYMD: string,
    planMax: number,
  ): Promise<{
    inicio: string;
    finVentana: string;
    finReal: string;
    usadas: number;
    maximas: number;
    completo: boolean;
  }> {
    const inicio = String(inicioYMD).slice(0, 10);
    const finVentana = this.ymdAddDays(inicio, 29);

    // Traer reservas en ventana (incluye cancel/cerrado para que NO consuman)
    const reservas = await this.reservaRepo.find({
      where: {
        usuario: { id: userId },
        fechaTurno: Between(inicio, finVentana),
        tipo: In(['automatica', 'recuperacion', 'suelta']),
      } as any,
      relations: ['horario'],
      order: { fechaTurno: 'ASC', id: 'ASC' } as any,
    });

    // Consumidas = las que cuentan como "usada" de plan (tu regla oficial)
    const consumidas: Reserva[] = [];
    for (const r of reservas) {
      if (!this.esConsumidaParaCiclo(r)) continue;
      consumidas.push(r);
    }

    const completo = consumidas.length >= planMax;
    const usadas = Math.min(consumidas.length, planMax);

    const finReal = completo
      ? String(consumidas[planMax - 1].fechaTurno).slice(0, 10)
      : finVentana;

    return {
      inicio,
      finVentana,
      finReal,
      usadas,
      maximas: planMax,
      completo,
    };
  }

  public async getUltimoCicloPorCantidad(userId: number, refYMD: string) {
    return this.obtenerUltimoCicloPorCantidad(userId, refYMD);
  }

  private async buscarInicioCicloPorAutomatica(
    userId: number,
    lowerBoundYMD: string,
    finVentanaYMD: string,
  ): Promise<string> {
    const r = await this.reservaRepo.findOne({
      where: {
        usuario: { id: userId },
        tipo: 'automatica',
        cancelacionPermanente: false, // ✅ lo único que NO puede iniciar ciclo
        fechaTurno: Between(lowerBoundYMD, finVentanaYMD),
      } as any,
      order: { fechaTurno: 'ASC', id: 'ASC' } as any,
    });

    // ✅ si no hay automática en ese rango, devolvemos lowerBound (fallback)
    // (en la práctica casi siempre habrá, porque el cron genera automáticas)
    return r?.fechaTurno ? String(r.fechaTurno).slice(0, 10) : lowerBoundYMD;
  }

  private esConsumidaParaCiclo(r: Reserva): boolean {
    const tipo = String((r as any).tipo ?? '').toLowerCase();

    // 1) sueltas nunca consumen
    if (tipo === 'suelta') return false;

    // 2) canceladas nunca consumen
    if (r.estado === 'cancelado') return false;

    // 3) cierres nunca consumen
    const cierreFlag = (r as any).cierreEstudio === true;
    if (r.estado === 'cerrado' || cierreFlag) return false;

    const fecha = String(r.fechaTurno || '').slice(0, 10);
    const hora = String(r.horario?.hora ?? '00:00').slice(0, 5);

    // 4) RECUPERACIÓN:
    // - recuperada siempre consume (ya pasó)
    // - reservado consume SOLO si ya pasó
    if (tipo === 'recuperacion' && r.automatica === false) {
      if (r.estado === 'recuperada') return true;
      if (r.estado === 'reservado') return this.turnoYaPaso(fecha, hora);
      return false;
    }

    // 5) AUTOMÁTICA:
    // consume SOLO si está reservada y ya pasó el turno
    const esAuto = r.automatica === true || tipo === 'automatica';
    if (esAuto && r.estado === 'reservado') {
      return this.turnoYaPaso(fecha, hora);
    }

    return false;
  }

  private async obtenerUltimoCicloPorCantidad(
    userId: number,
    refYMD: string,
  ): Promise<{
    inicio: string;
    finVentana: string;
    finReal: string;
    usadas: number;
    maximas: number;
    completo: boolean;
  } | null> {
    const usuario = await this.userRepo.findOne({ where: { id: userId } });
    if (!usuario) return null;

    const maximas = parseInt(usuario.planMensual ?? '4', 10);
    if (!Number.isFinite(maximas) || maximas <= 0) return null;

    const ref = String(refYMD || '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ref)) return null;

    // 1) Traer reservas hasta ref
    const reservasHastaRef = await this.reservaRepo.find({
      where: {
        usuario: { id: userId },
        fechaTurno: LessThanOrEqual(ref),
        tipo: In(['automatica', 'recuperacion', 'suelta']),
      } as any,
      relations: ['horario'],
      order: { fechaTurno: 'ASC', id: 'ASC' } as any,
    });
    // solo pafra control...se puede borrar...
    console.log('reservasHastaRef', reservasHastaRef.length);
    let c1=0, c2=0, c3=0;
    for (const r of reservasHastaRef) {
      if (this.esConsumidaParaCiclo(r)) c1++;
      const fecha = String(r.fechaTurno||'').slice(0,10);
      const hora  = (r.horario?.hora ?? '00:00').slice(0,5);
      if (this.turnoYaPaso(fecha,hora)) c2++;
      if (this.esConsumidaParaCiclo(r) && this.turnoYaPaso(fecha,hora)) c3++;
    }
    console.log({c1, c2, c3});
    // hasta aca sse puede borrar

    // 2) usadas = consumidas + YA PASÓ (tu política)
    const usadas: Reserva[] = [];
    for (const r of reservasHastaRef) {
      if (!this.esConsumidaParaCiclo(r)) continue;

      const fecha = String(r.fechaTurno || '').slice(0, 10);
      const hora  = (r.horario?.hora ?? '00:00').slice(0, 5);

      // ✅ consume SOLO cuando ya pasó
      if (!this.turnoYaPaso(fecha, hora)) continue;

      usadas.push(r);
    }

    // 3) Si no hay usadas, igual podés devolver el ciclo vigente por ventana
    //    (inicio = primera automática <= ref, aunque esté cancelada/cerrada)
    if (usadas.length === 0) {
      const firstAuto = await this.reservaRepo.findOne({
        where: {
          usuario: { id: userId },
          tipo: 'automatica',
          fechaTurno: LessThanOrEqual(ref),
          cancelacionPermanente: false,
        } as any,
        order: { fechaTurno: 'ASC', id: 'ASC' } as any,
      });

      if (!firstAuto?.fechaTurno) return null;

      const inicio = String(firstAuto.fechaTurno).slice(0, 10);
      const finVentana = this.ymdAddDays(inicio, 29);

      if (ref < inicio || ref > finVentana) return null;

      return {
        inicio,
        finVentana,
        finReal: finVentana,
        usadas: 0,
        maximas,
        completo: false,
      };
    }

    // 4) Construir ciclos desde usadas (ordenadas)
    let i = 0;
    let last: {
      inicio: string;
      finVentana: string;
      finReal: string;
      usadas: number;
      maximas: number;
      completo: boolean;
    } | null = null;

    let prevFinEfectivo: string | null = null;

    while (i < usadas.length) {
      const inicioBase = String(usadas[i].fechaTurno).slice(0, 10);
      const finVentana = this.ymdAddDays(inicioBase, 29);

      const dentro: Reserva[] = [];
      let j = i;

      while (j < usadas.length) {
        const f = String(usadas[j].fechaTurno).slice(0, 10);
        if (f > finVentana) break;
        dentro.push(usadas[j]);
        j++;
      }

      const completo = dentro.length >= maximas;
      const usadasCiclo = Math.min(dentro.length, maximas);

      const finReal = completo
        ? String(dentro[maximas - 1].fechaTurno).slice(0, 10)
        : finVentana;

      const finEfectivo = completo ? finReal : finVentana;

      // lowerBound = día siguiente al fin del ciclo anterior (si existe)
      const lowerBound = prevFinEfectivo
        ? this.ymdAddDays(prevFinEfectivo, 1)
        : inicioBase;

      // ✅ inicio real por AUTOMÁTICA (no permanente) dentro del rango
      const inicioReal = await this.buscarInicioCicloPorAutomatica(userId, lowerBound, finVentana);

      last = {
        inicio: inicioReal,
        finVentana,
        finReal,
        usadas: usadasCiclo,
        maximas,
        completo,
      };

      // si ref cae dentro, devolvemos este ciclo
      if (ref >= lowerBound && ref <= finEfectivo) {
        return last;
      }

      prevFinEfectivo = finEfectivo;

      // avanzar
      if (completo) i = i + maximas;
      else i = j;
    }

    if (last) {
      const finEfLast = last.completo ? last.finReal : last.finVentana;
      if (ref >= last.inicio && ref <= finEfLast) return last;
    }

    return null;
  }

  async getAsistenciaCiclos(userId: number) {
    const usuario = await this.userRepo.findOne({ where: { id: userId } });
    if (!usuario) throw new Error('Usuario no encontrado');

    const minYmd = (a: string, b: string) => (a <= b ? a : b);

    // 1) Ciclos hacia atrás
    const ciclos: Array<{
      inicio: string;
      finVentana: string;
      finReal: string;
      usadas: number;
      maximas: number;
      completo: boolean;
    }> = [];

    // ✅ guard por ventana efectiva (evita repetir el mismo ciclo)
    const guard = new Set<string>();

    let ref = this.ymdTodayAR();

    // ✅ Si hoy no cae en ningún ciclo, arrancamos desde la última automática existente
    const lastAuto = await this.reservaRepo.findOne({
      where: {
        usuario: { id: userId },
        tipo: 'automatica',
        cancelacionPermanente: false,
      } as any,
      order: { fechaTurno: 'DESC', id: 'DESC' } as any,
    });

    if (lastAuto?.fechaTurno) {
      const lastAutoYMD = String(lastAuto.fechaTurno).slice(0, 10);

      // si hoy es posterior a la última automática, ref = última automática
      if (ref > lastAutoYMD) {
        ref = lastAutoYMD;
      }
    }

    while (true) {
    const c = await this.obtenerCicloPlanActualPorCantidad(userId, ref);
    if (!c) break;

    const finEfectivo = c.completo ? c.finReal : c.finVentana;

    // ✅ ANTI-SOLAPE: si este ciclo se pisa con el más nuevo ya agregado, lo saltamos
    if (ciclos.length > 0) {
      const inicioMasNuevo = ciclos[ciclos.length - 1].inicio; // el último agregado (más nuevo)
      if (finEfectivo >= inicioMasNuevo) {
        // retrocedemos más para evitar quedarnos pegados
        ref = this.ymdAddDays(c.inicio, -1);
        continue;
      }
    }

    const key = `${c.inicio}|${c.finVentana}|${finEfectivo}|${c.maximas}`;
    if (guard.has(key)) break;
    guard.add(key);

    ciclos.push(c);

    // ✅ BACKTRACK: día anterior al inicio real del ciclo
    ref = this.ymdAddDays(c.inicio, -1);

    if (ciclos.length >= 36) break;
  }


    const out: any[] = [];

    // 2) Detalle por ciclo SIN solape
    for (let idx = 0; idx < ciclos.length; idx++) {
      const c = ciclos[idx];

      const finBase = c.completo ? c.finReal : c.finVentana;

      let finCapado = finBase;
      // ✅ capar para que este ciclo no pise el inicio del ciclo más nuevo ya calculado
      if (idx > 0) {
        const inicioMasNuevo = ciclos[idx - 1].inicio;
        const limite = this.ymdAddDays(inicioMasNuevo, -1);
        finCapado = minYmd(finCapado, limite);
      }
     // 🔒 si el capado queda antes del inicio, este ciclo no aporta nada
      if (finCapado < c.inicio) {
        continue;
      }

      const reservas = await this.reservaRepo
        .createQueryBuilder('r')
        .leftJoinAndSelect('r.horario', 'h')
        .where('r."usuarioId" = :uid', { uid: userId })
        .andWhere('r."fechaTurno" BETWEEN :desde AND :hasta', { desde: c.inicio, hasta: finCapado })
        .andWhere(`
          (
            (LOWER(COALESCE(r.tipo,'')) = 'recuperacion')
            OR
            (r.automatica = true OR LOWER(COALESCE(r.tipo,'')) = 'automatica')
          )
        `)
        .orderBy('r."fechaTurno"', 'ASC')
        .addOrderBy('r.id', 'ASC')
        .getMany();


      let asistidas = 0;
      let recuperadas = 0;
      let recuperacionesReservadas = 0;
      let canceladasAlumno = 0;
      let cerrado = 0;
      let sueltas = 0;

      // ✅ SALDO (NO depende de yaPaso)
      let ganadasCancelMom = 0;
      let ganadasCierre = 0;
      let usadasRecup = 0;
      // ✅ anti-doble-crédito por celda (fecha+horario)
      const creditKey = (r: any) => `${String(r?.fechaTurno ?? '').slice(0, 10)}|${Number(r?.horario?.id ?? 0)}`;

      // Guardamos "mejor crédito" por celda: 'cerrado' gana a 'cancelado'
      const creditosPorCelda = new Map<string, 'cerrado' | 'cancelado'>();

      const fechasAsistidas: string[] = [];
      const fechasRecuperadas: string[] = [];
      const fechasRecupReservadas: string[] = [];
      const fechasCanceladasAlumno: string[] = [];
      const fechasSueltas: string[] = [];
      const fechasCerrado: string[] = [];

      for (const r of reservas) {
        const fecha = String(r.fechaTurno || '').slice(0, 10);
        const hora = (r.horario?.hora ?? '00:00').slice(0, 5);

        if (fecha < c.inicio || fecha > finCapado) continue;

        const yaPaso = this.turnoYaPaso(fecha, hora);

        const tipo = String((r as any).tipo ?? '').toLowerCase();
        const esSuelta = tipo === 'suelta';
        const esRecup = tipo === 'recuperacion';
        const esAuto = r.automatica === true || tipo === 'automatica';

        const cierreEstudio = (r as any).cierreEstudio === true;

        // =========================
        // ✅ 1) SALDO (NO a-la-fecha) — anti doble crédito
        // =========================

        // 1) Acumular créditos por celda (fecha+horario) sin duplicar:
        //    - Si hay CIERRE, ese crédito manda (aunque también exista cancelado).
        //    - Si no hay cierre, puede contar cancelación momentánea del alumno.
        {
          const key = creditKey(r);

          const esCreditoCierre =
            (r.estado === 'cerrado' && cierreEstudio === true);

          const esCreditoCancelAlumno =
            (r.estado === 'cancelado' &&
              esAuto &&
              r.cancelacionMomentanea === true &&
              cierreEstudio === false);

          if (esCreditoCierre) {
            // prioridad cierre
            creditosPorCelda.set(key, 'cerrado');
          } else if (esCreditoCancelAlumno) {
            // solo si no hubo cierre para esa celda
            if (!creditosPorCelda.has(key)) {
              creditosPorCelda.set(key, 'cancelado');
            }
          }
        }

        // 2) UsadasRecup: esto no cambia (se cuentan las recuperaciones consumidas)
        if (
          esRecup &&
          r.automatica === false &&
          (r.estado === 'reservado' || r.estado === 'recuperada')
        ) {
          usadasRecup++;
        }

        // ==================================
        // ✅ 2) HISTORIAL VISUAL (sin yaPaso)
        // ==================================
        if (
          r.estado === 'cancelado' &&
          esAuto &&
          r.cancelacionMomentanea === true &&
          cierreEstudio === false
        ) {
          canceladasAlumno++;
          fechasCanceladasAlumno.push(fecha);
          continue;
        }

        if (r.estado === 'cerrado' && cierreEstudio) {
          cerrado++;
          fechasCerrado.push(fecha);
          continue;
        }

        // ==================================
        // ✅ 3) ASISTENCIA "A LA FECHA"
        // ==================================
        if (esSuelta) {
          if (yaPaso) {
            sueltas++;
            fechasSueltas.push(fecha);
          }
          continue;
        }

        if (esRecup) {
          if (yaPaso && (r.estado === 'recuperada' || r.estado === 'reservado')) {
            recuperadas++;
            fechasRecuperadas.push(fecha);
          } else if (!yaPaso && r.estado === 'reservado') {
            recuperacionesReservadas++;
            fechasRecupReservadas.push(fecha);
          }
          continue;
        }

        if (esAuto && r.estado === 'reservado' && yaPaso) {
          asistidas++;
          fechasAsistidas.push(fecha);
        }

      }

      // ✅ materializar créditos únicos (1 por celda)
      ganadasCierre = 0;
      ganadasCancelMom = 0;

      for (const v of creditosPorCelda.values()) {
        if (v === 'cerrado') ganadasCierre++;
        else ganadasCancelMom++;
      }

      const usadasALaFecha = asistidas + recuperadas;

      const derechoRecuperacion = ganadasCancelMom + ganadasCierre;
      const saldoRecuperacion = Math.max(0, derechoRecuperacion - usadasRecup);

      const excedePlan = usadasALaFecha > c.maximas;

      const asc = (arr: string[]) => arr.sort((a, b) => a.localeCompare(b));
      asc(fechasAsistidas);
      asc(fechasRecuperadas);
      asc(fechasRecupReservadas);
      asc(fechasCanceladasAlumno);
      asc(fechasSueltas);
      asc(fechasCerrado);

      out.push({
        cicloInicio: c.inicio,
        cicloFin: finCapado,
        finVentana: c.finVentana,
        planMax: c.maximas,

        asistidas,
        recuperadas,
        usadasALaFecha,

        canceladas: canceladasAlumno,
        canceladasAlumno,

        cerrado,

        derechoRecuperacion,
        saldoRecuperacion,

        recuperacionesReservadas,

        fechasAsistidas,
        fechasRecuperadas,
        fechasRecupReservadas,
        fechasCanceladas: fechasCanceladasAlumno,
        fechasSueltas,
        fechasCerrado,

        excedePlan,

        finReal: c.finReal,
        completo: c.completo,
      });
    }

    out.sort((a, b) => (b.cicloInicio > a.cicloInicio ? 1 : -1));
    return out;
  }

  //  Total de clases (automáticas + recuperaciones) dentro del ciclo de plan (30 días)
  // Total de clases USADAS dentro del ciclo por cantidad (4/8/12)
  // - NO cuenta sueltas
  // - NO cuenta canceladas
  // - Recuperación cuenta si estado reservado o recuperada
  // - Automática cuenta si estado reservado
  // - NO cuenta cierres (hayCierre)
  // - Se cuenta dentro de [ciclo.inicio, ciclo.finVentana]
  async contarTotalClasesDelCiclo(
    userId: number,
    refYMD: string, // normalmente fechaTurno
  ): Promise<{
    actuales: number;
    maximas: number;
    ciclo: { inicio: string; finVentana: string; finReal: string; completo: boolean };
  }> {
    const usuario = await this.userRepo.findOne({ where: { id: userId } });
    if (!usuario) throw new Error('Usuario no encontrado');

    const maximas = parseInt(usuario.planMensual ?? '4', 10);
    if (!Number.isFinite(maximas) || maximas <= 0) {
      return {
        actuales: 0,
        maximas: 0,
        ciclo: { inicio: refYMD, finVentana: refYMD, finReal: refYMD, completo: false },
      };
    }

    // ✅ ciclo por cantidad (tu lógica oficial)
    const c = await this.obtenerCicloPlanActualPorCantidad(userId, refYMD);
    if (!c) {
      throw new BadRequestException('No se pudo calcular el ciclo actual para validar el límite.');
    }

    const finEfectivo = c.completo ? c.finReal : c.finVentana;

    const reservas = await this.reservaRepo.find({
      where: {
        usuario: { id: userId },
        fechaTurno: Between(c.inicio, finEfectivo),
        tipo: In(['automatica', 'recuperacion', 'suelta']),
      } as any,
      relations: ['horario'],
      order: { fechaTurno: 'ASC', id: 'ASC' } as any, // ✅ opcional (recomendado)
    });

    let actuales = 0;

    const cacheCierre = new Map<string, CierreTipo>();

    for (const r of reservas) {
      // ✅ filtra por tipo/estado (sin tiempo)
      if (!this.claseCuentaComoUsada(r)) continue;

      const fecha = String(r.fechaTurno || '').slice(0, 10);
      const hora = (r.horario?.hora ?? '00:00').slice(0, 5);

      // ✅ CLAVE: solo cuenta si el turno YA PASÓ
      if (!this.turnoYaPaso(fecha, hora)) continue;

      const key = `${fecha}|${hora}`;

      let cierreTipo = cacheCierre.get(key);
      if (cierreTipo === undefined) {
        // hayCierre devuelve tipo o null
        cierreTipo = await this.ausenciaProfeService.hayCierre(fecha, hora);
        cacheCierre.set(key, cierreTipo);
      }

      const cerrado = cierreTipo != null;
      if (cerrado) continue;

      actuales++;
    }

    return {
      actuales,
      maximas: c.maximas,
      ciclo: {
        inicio: c.inicio,
        finVentana: c.finVentana,
        finReal: c.finReal,
        completo: c.completo,
      },
    };
  }

  private claseCuentaComoUsada(r: Reserva): boolean {
    const tipo = String((r as any).tipo ?? '').toLowerCase();

    if (tipo === 'suelta') return false;
    if (r.estado === 'cancelado') return false;

    if (tipo === 'recuperacion') {
      return r.estado === 'reservado' || r.estado === 'recuperada';
    }

    if (tipo === 'automatica' || r.automatica === true) {
      return r.estado === 'reservado';
    }

    return r.estado === 'reservado';
  }

  public async getCicloPagoActual(
    userId: number,
    refYMD: string,
  ): Promise<{ inicio: string; finVentana: string } | null> {

    const ref = String(refYMD || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ref)) return null;

    // 1) ancla: última automática hasta hoy
    const anchor = await this.reservaRepo.findOne({
      where: {
        usuario: { id: userId },
        tipo: 'automatica',
        fechaTurno: LessThanOrEqual(ref),
      } as any,
      order: { fechaTurno: 'DESC' } as any,
    });

    if (anchor?.fechaTurno) {
      const anchorYMD = String(anchor.fechaTurno).slice(0, 10);
      const desde = this.ymdAddDays(anchorYMD, -29);

      // ✅ inicio real = primera automática dentro de los 30 días previos al ancla
      const firstInWindow = await this.reservaRepo.findOne({
        where: {
          usuario: { id: userId },
          tipo: 'automatica',
          fechaTurno: Between(desde, anchorYMD),
        } as any,
        order: { fechaTurno: 'ASC' } as any,
      });

      if (firstInWindow?.fechaTurno) {
        const inicio = String(firstInWindow.fechaTurno).slice(0, 10);
        const finVentana = this.ymdAddDays(inicio, 29);

        // si hoy cae dentro, este es el ciclo a pagar
        if (ref >= inicio && ref <= finVentana) return { inicio, finVentana };
      }
    }

    // 2) si no hay pasado válido, usamos la próxima automática (pago anticipado)
    const nextAuto = await this.reservaRepo.findOne({
      where: {
        usuario: { id: userId },
        tipo: 'automatica',
        fechaTurno: MoreThanOrEqual(ref),
      } as any,
      order: { fechaTurno: 'ASC' } as any,
    });

    if (!nextAuto?.fechaTurno) return null;

    const inicio = String(nextAuto.fechaTurno).slice(0, 10);
    const finVentana = this.ymdAddDays(inicio, 29);
    return { inicio, finVentana };
  }

  private async inicioDeCicloYaPasoQB(
    userId: number,
    cicloInicioYMD: string,
  ): Promise<{ ok: boolean; fechaTurno?: string; hora?: string; reservaId?: number; reason?: string }> {

    const r = await this.reservaRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.horario', 'h')
      .where('r.usuarioId = :uid', { uid: userId })
      .andWhere("LOWER(r.tipo) = 'automatica'")
      .andWhere('r."fechaTurno" = :ft', { ft: cicloInicioYMD })
      .orderBy('h.hora', 'ASC')
      .addOrderBy('r.id', 'ASC')
      .getOne();

    if (!r) return { ok: false, reason: 'sin_reserva_inicio_ciclo' };

    const fecha = String(r.fechaTurno || '').slice(0, 10);
    const hora = String(r.horario?.hora ?? '00:00').slice(0, 5);

    if (!this.turnoYaPaso(fecha, hora)) {
      return { ok: false, reason: 'aun_no_paso_el_horario', fechaTurno: fecha, hora, reservaId: r.id };
    }

    return { ok: true, fechaTurno: fecha, hora, reservaId: r.id };
  }

  private lunesSemanaAR(ymd: string): string {
    const d = new Date(`${ymd}T00:00:00-03:00`);
    const day = d.getDay(); // 0 dom .. 6 sab
    const diffToMonday = (day + 6) % 7;
    d.setDate(d.getDate() - diffToMonday);
    return this.ymdFromDateAR(d); // ✅ AR, no UTC
  }

  async reenviarPlanVencidoSemanalSiCorresponde(userId: number, refFecha: string): Promise<BackfillResult> {
    const usuario = await this.userRepo.findOne({ where: { id: userId } });
    if (!usuario) return { ok: false, userId, reason: 'usuario_no_encontrado' };
    if (!usuario.telefono) return { ok: false, userId, reason: 'sin_telefono' };

    const rol = String(usuario.rol ?? '').toLowerCase();
    if (rol !== 'alumno/a' && rol !== 'alumno') return { ok: false, userId, reason: 'no_es_alumno' };
    if (usuario.activo === false) return { ok: false, userId, reason: 'inactivo' };

    const ciclo = await this.obtenerCicloPlanActualPorCantidad(userId, refFecha);
    if (!ciclo) return { ok: false, userId, reason: 'sin_ciclo' };

    const inicioPaso = await this.inicioDeCicloYaPasoQB(userId, ciclo.inicio);
    if (!inicioPaso.ok) return { ok: false, userId, reason: `ciclo_no_iniciado_${inicioPaso.reason}` };

    const refPrev = this.ymdAddDays(ciclo.inicio, -1);
    const cicloAnterior = await this.obtenerCicloPlanActualPorCantidad(userId, refPrev);
    if (!cicloAnterior?.completo) return { ok: false, userId, reason: 'ciclo_anterior_no_completo' };

    const pagoCicloNuevo = await this.pagosRepo.findOne({
      where: { userId, cicloInicio: ciclo.inicio, cicloFin: ciclo.finVentana },
      select: ['id', 'fechaPago'],
    });
    if (pagoCicloNuevo?.fechaPago) return { ok: false, userId, reason: 'ya_pago_ciclo' };

    // ✅ dedupe semanal
    const semanaInicio = this.lunesSemanaAR(refFecha);

    const yaAvisadoSemana = await this.notifRepo.findOne({
      where: {
        usuarioId: userId,
        tipo: 'plan_vencido',
        cicloInicio: ciclo.inicio,
        cicloFin: ciclo.finVentana,
        semanaInicio: semanaInicio,
      } as any,
      select: ['id'],
    });
    if (yaAvisadoSemana) return { ok: false, userId, reason: 'ya_avisado_semana' };

    const planType = `${usuario.planMensual} clases / mes`;
    await this.whatsappService.sendTemplatePlanVencido(usuario.telefono, usuario.nombre, planType);

    try {
      await this.notifRepo.insert({
        usuarioId: userId,
        tipo: 'plan_vencido',
        cicloInicio: ciclo.inicio,
        cicloFin: ciclo.finVentana,
        semanaInicio: semanaInicio,
      } as any);
    } catch {}

    return { ok: true, userId, cicloInicio: ciclo.inicio, cicloFin: ciclo.finVentana };
  }

  @Cron('0 10 * * 1', { timeZone: 'America/Argentina/Buenos_Aires' })
  async cronAvisoPlanVencidoSemanal() {
    const hoy = this.ymdTodayAR();

    const alumnos = await this.userRepo
      .createQueryBuilder('user')
      .where('user.activo = true')
      .andWhere("LOWER(user.rol) IN ('alumno', 'alumno/a')")
      .andWhere('user.telefono IS NOT NULL')
      .getMany();

    for (const u of alumnos) {
      try {
        await this.reenviarPlanVencidoSemanalSiCorresponde(u.id, hoy);
        await this.sleep(800); // rate limit WhatsApp
      } catch (e) {
        console.error('Error aviso semanal', u.id, e);
      }
    }
  }

  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private hoyISO_AR(): string {
    return this.ymdTodayAR(); // ya lo tenés armado AR
  }

  private async activarTurnoFijo(usuarioId: number, horarioId: number) {
    // ✅ si ya existe activo, no hacer nada
    const yaActivo = await this.turnoFijoRepo.findOne({
      where: { usuarioId, horarioId, activo: true } as any,
      select: ['id'] as any,
    });
    if (yaActivo) return;

    const hoy = this.hoyISO_AR();

    // ✅ si existe inactivo, reactivar (mantiene trazabilidad)
    const inactivo = await this.turnoFijoRepo.findOne({
      where: { usuarioId, horarioId, activo: false } as any,
    });

    if (inactivo) {
      (inactivo as any).activo = true;

      // ✅ registrar alta / reactivación
      (inactivo as any).fechaAlta = hoy;
      (inactivo as any).motivoAlta = 'reactivacion';
      (inactivo as any).reactivadoCount = Number((inactivo as any).reactivadoCount ?? 0) + 1;

      await this.turnoFijoRepo.save(inactivo as any);
      return;
    }

    // ✅ sino, crear
    await this.turnoFijoRepo.save({
      usuarioId,
      horarioId,
      activo: true,
      fechaAlta: hoy,
      motivoAlta: 'alta',
      reactivadoCount: 0,
    } as any);
  }

  private async desactivarTurnoFijo(usuarioId: number, horarioId: number, motivo: string) {
    // desactiva SOLO el activo
    await this.turnoFijoRepo.update(
      { usuarioId, horarioId, activo: true } as any,
      {
        activo: false,
        fechaBaja: this.hoyISO_AR(),
        motivoBaja: motivo,
      } as any,
    );
  }

  private async obtenerUsuariosFijosPorHorario(horarioId: number): Promise<number[]> {
    const rows = await this.turnoFijoRepo
      .createQueryBuilder('tf')
      .select('tf.usuarioId', 'usuarioId')
      .innerJoin('user', 'u', 'u.id = tf.usuarioId')
      .where('tf.horarioId = :hid', { hid: horarioId })
      .andWhere('tf.activo = true')
      .andWhere('u.activo = true') // ✅ no generar para inactivos
      .getRawMany<{ usuarioId: number }>();

    return rows
      .map(r => Number(r.usuarioId))
      .filter(n => Number.isFinite(n));
  }

  private diaToDow(dia: string): number {
    const d = String(dia || '').toLowerCase().trim();
    if (d.startsWith('lun')) return 1;
    if (d.startsWith('mar')) return 2;
    if (d.startsWith('mié') || d.startsWith('mie')) return 3;
    if (d.startsWith('jue')) return 4;
    if (d.startsWith('vie')) return 5;
    if (d.startsWith('sáb') || d.startsWith('sab')) return 6;
    if (d.startsWith('dom')) return 0;
    return -1;
  }

  private dowAR(ymd: string): number {
    const d = new Date(`${ymd}T00:00:00-03:00`);
    return d.getDay(); // 0 dom .. 6 sab
  }

  private async proximaFechaTurnoFijoDespuesDe(userId: number, ymdFin: string): Promise<string | null> {
    // 1) turnos fijos activos del usuario
    const tfs = await this.turnoFijoRepo.find({
      where: { usuarioId: userId, activo: true } as any,
      select: ['horarioId'] as any,
    });

    const horarioIds = [...new Set(tfs.map((x: any) => Number(x.horarioId)).filter(n => Number.isFinite(n)))];
    if (!horarioIds.length) return null;

    // 2) horarios para obtener el "dia"
    const horarios = await this.horarioRepo.find({
      where: { id: In(horarioIds) } as any,
      select: ['id', 'dia'] as any,
    });

    const dows = [...new Set(
      horarios
        .map(h => this.diaToDow((h as any).dia))
        .filter(n => n >= 0)
    )];

    if (!dows.length) return null;

    // 3) buscar la próxima fecha > ymdFin que caiga en esos días
    // con 21 días sobra (3 semanas)
    for (let i = 1; i <= 21; i++) {
      const cand = this.ymdAddDays(ymdFin, i);
      if (dows.includes(this.dowAR(cand))) return cand;
    }

    return null;
  }

}
