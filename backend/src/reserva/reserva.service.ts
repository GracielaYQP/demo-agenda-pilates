import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, LessThan, LessThanOrEqual, Repository } from 'typeorm';
import { Reserva, TipoReserva } from './reserva.entity';
import { Horario } from '../horarios/horarios.entity';
import { User } from '../users/user.entity';
import { addDays, format, startOfWeek } from 'date-fns';
import { es } from 'date-fns/locale';
import { Cron } from '@nestjs/schedule';
import { AusenciaProfeService } from '../feriados/ausencia-profe.service';
import { WhatsAppService } from 'src/whatsapp/whatsapp.service';
import { Pago } from 'src/pagos/pagos.entity';


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

@Injectable()
export class ReservaService {
  private static instancias = 0;

  constructor(
    @InjectRepository(Reserva)
    private reservaRepo: Repository<Reserva>,
    @InjectRepository(Horario)
    private horarioRepo: Repository<Horario>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(Pago)
    private pagosRepo: Repository<Pago>, 
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
    rol?: string ){

    const horario = await this.horarioRepo.findOne({where: { id: horarioId },});
    if (!horario) throw new Error('Horario no encontrado');

    const usuario = await this.userRepo.findOne({ where: { id: userId } });
    if (!usuario) throw new Error('Usuario no encontrado');

    // 🚦 Validar vigencia de plan (NO aplica a clases sueltas)
    let cicloPlan: { inicio: string; fin: string } | null = null;
    if (tipo !== 'suelta') {
      cicloPlan = await this.obtenerCicloPlanActivo(userId, fechaTurno);
      if (!cicloPlan) {
        throw new BadRequestException(
          'Tu plan está vencido o fuera de los 30 días desde el último pago. Regularizá el pago para seguir reservando.',
        );
      }
    }

    //  Regla de nivel:
    //    - Si quien reserva es ADMIN → puede inscribir en cualquier nivel (sin validar)
    //    - Si es ALUMNO → debe coincidir su nivel con el nivel del turno
    if ((rol ?? '').toLowerCase() !== 'admin') {
      const nivelTurno   = String((horario as any).nivel ?? '').toLowerCase().trim();
      const nivelAlumno  = String((usuario as any).nivel ?? (usuario as any).nivelAsignado ?? '').toLowerCase().trim();

      if (nivelTurno && nivelAlumno && nivelTurno !== nivelAlumno) {
        throw new BadRequestException('Este turno no corresponde a tu nivel.');
      }
    }

    //  Bloqueo por AUSENCIA de profesora (cierre)
    const cierre = await this.ausenciaProfeService.hayCierre(fechaTurno, horario.hora);
      if (cierre) {
        throw new BadRequestException('Estudio cerrado por suspensión de clases.');
      }

     // Evitá duplicados (reserva o cancelación previa para ese día)
    const existente = await this.reservaRepo.findOne({
      where: { usuario: { id: userId }, horario: { id: horarioId }, fechaTurno },
    });

    if (existente) {
      // 🔴 Ya hay una reserva activa
      if (existente.estado === 'reservado') {
        throw new BadRequestException('Ya tenés una reserva para ese día y horario.');
      }

      // 🔴 Está cancelada
      if (existente.estado === 'cancelado') {

        // 👉 Caso 1: cancelación MOMENTÁNEA → seguimos bloqueando
        if (existente.cancelacionMomentanea) {
          throw new BadRequestException(
            'Ese día ya lo cancelaste por única vez para generar recuperación. No se puede volver a reservar automáticamente.'
          );
        }

        // 👉 Caso 2: cancelación PERMANENTE → permitimos volver a tomar el turno
        // Borramos la marca anterior y después creamos la nueva reserva normalmente.
        if (existente.cancelacionPermanente) {
          await this.reservaRepo.remove(existente);
        } else {
          // Fila rara cancelada sin flags; por seguridad también la eliminamos
          await this.reservaRepo.remove(existente);
        }
      }
    }

    // Chequeo de cupo por fecha/estado (considera reformers bloqueados)
    const ocupadas = await this.reservaRepo.count({
      where: { horario: { id: horarioId }, fechaTurno, estado: 'reservado' },
    });

    const total = Number(horario.totalReformers || 0);
    const bloqueados = Math.max(0, Number((horario as any).blockedReformers || 0));

    const libresTeoricos = Math.max(0, total - ocupadas);
    const bloqueadosAplicados = Math.min(bloqueados, libresTeoricos);
    const libresEfectivos = libresTeoricos - bloqueadosAplicados;

    if (libresEfectivos <= 0) {
      throw new BadRequestException('No hay reformers disponibles');
    }


    // Validación para reservas automáticas
    if (tipo === 'automatica') {
      // 1. Validación mensual: Ahora se cuentan TODAS las clases (automáticas y de recuperación)
      const { actuales: mensuales, maximas: maxMensuales } = await this.contarTotalClasesDelMes(userId, fechaTurno);
      if (mensuales >= maxMensuales) {
        throw new BadRequestException(`⚠️ Ya alcanzaste el límite mensual de ${maxMensuales} clases (incluyendo recuperaciones).`);
      }

      // 2.Validación semanal
      const { actuales: semanales, maximas: maxSemanales } = await this.contarReservasAutomaticasDeLaSemana(userId, fechaTurno);
      if (semanales >= maxSemanales) {
        throw new BadRequestException(`⚠️Ya alcanzaste el límite semanal de ${maxSemanales} clases según tu plan.`);
      }
    }

    // Validación para reservas de recuperación
    if (tipo === 'recuperacion') {

      //  0. Seguridad: debe haber un plan activo y la recuperación debe estar dentro del ciclo
      if (!cicloPlan) {
        throw new BadRequestException('No tenés un plan activo para usar recuperaciones.');
      }

      //  1. La recuperación debe ser dentro de los 30 días del plan (ventana fechaPago → fechaPago+30)
      const ref = new Date(`${fechaTurno}T00:00:00-03:00`);
      const finPlanDate = new Date(`${cicloPlan.fin}T23:59:59-03:00`);
      if (ref > finPlanDate) {
        throw new BadRequestException(
          'Las recuperaciones deben usarse dentro de los 30 días desde el pago del plan. ' +
          'Si no se usan en ese período, se pierden.'
        );
      }

      //  2. Validación de CONTEO TOTAL dentro del ciclo (automáticas + recuperaciones)
      //    → el plan termina por cantidad de clases, no solo por fecha.
      const { actuales, maximas } = await this.contarTotalClasesDelMes(userId, fechaTurno);
      if (actuales >= maximas) {
        throw new BadRequestException(
          `⚠️ Ya alcanzaste el límite de ${maximas} clases de tu plan (incluyendo recuperaciones).`
        );
      }

      // 3. No permitir recuperar si está cerrado (igual que una ausencia)
      const cierreRecup = await this.ausenciaProfeService.hayCierre(fechaTurno, horario.hora);
      if (cierreRecup) {
        throw new BadRequestException(
          '⚠️ No podés reservar una recuperación: el estudio está cerrado en esa fecha/horario.'
        );
      }

      // 4. No permitir si falta menos de 1 hora
      const ahora = new Date();
      const fechaHoraTurno = new Date(`${fechaTurno}T${horario.hora}:00-03:00`); // ej: '08:00'
      const diferenciaMinutos = (fechaHoraTurno.getTime() - ahora.getTime()) / (1000 * 60);
      if (diferenciaMinutos < 60) {
        throw new BadRequestException(
          '⏰ Las reservas de recuperación deben hacerse al menos 1 hora antes del inicio de la clase.'
        );
      }

      // 5. Validar si tiene recuperaciones disponibles en este plan
      const recuperacionesDisponibles = await this.contarCancelacionesMomentaneasDelMes(
        userId,
        fechaTurno,
      );
      if (recuperacionesDisponibles <= 0) {
        throw new BadRequestException('No tenés recuperaciones disponibles en este plan.');
      }
    }


    if (tipo === 'suelta') {
      // Regla razonable: reservar hasta 1 hora antes (igual que recuperación)
      const ahora = new Date();
      const fechaHoraTurno = new Date(`${fechaTurno}T${horario.hora}:00-03:00`);
      const diffMin = (fechaHoraTurno.getTime() - ahora.getTime()) / (1000 * 60);
      if (diffMin < 60) {
        throw new BadRequestException('⏰ Las clases sueltas deben reservarse al menos 1 hora antes.');
      }
      // No se controla plan ni recuperaciones
    }

    // Crear la reserva
    const fechaReserva = new Date().toISOString().split('T')[0];
    const nuevaReserva = this.reservaRepo.create({
      horario,
      usuario,
      nombre,
      apellido,
      fechaReserva,
      fechaTurno,
      estado: 'reservado',
      tipo,
      automatica: (tipo === 'automatica'),
    });

    const reservaGuardada = await this.reservaRepo.save(nuevaReserva);

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
    const horario = await this.horarioRepo.findOne({ where: { id: horarioId } });
    if (!horario) throw new Error('Horario no encontrado');

    const usuario = await this.userRepo.findOne({ where: { id: userId } });
    if (!usuario) throw new Error('Usuario no encontrado');

    // 1) Busco cualquier fila existente para esa combinación (sin filtrar por estado)
    const existente = await this.reservaRepo.findOne({
      where: {
        usuario: { id: userId },
        horario: { id: horarioId },
        fechaTurno,
      },
      relations: ['horario', 'usuario'],
    });

    // 2) Si existe, ACTUALIZO a cancelado (momentánea)
    if (existente) {
      if (existente.estado === 'cancelado') {
        throw new Error('Ya se canceló ese día');
      }
      existente.estado = 'cancelado';
      existente.cancelacionMomentanea = true;
      existente.cancelacionPermanente = false;
      existente.fechaCancelacion = new Date();
      await this.reservaRepo.save(existente);
      return { mensaje: 'Reserva cancelada por esta vez.' };
    }

    // 3) Si no existía ninguna fila, creo una “marca” cancelada para esa fecha
    const fechaReserva = new Date().toISOString().split('T')[0];
    const reservaCancelada = this.reservaRepo.create({
      usuario,
      horario,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      fechaTurno,
      fechaReserva,
      estado: 'cancelado',
      automatica: true,
      cancelacionMomentanea: true,
      cancelacionPermanente: false,
      fechaCancelacion: new Date()
    });

    return this.reservaRepo.save(reservaCancelada);
  }

  async contarReservasAutomaticasDelMes(userId: number, fechaTurno: string): Promise<{ actuales: number, maximas: number }> {
    const usuario = await this.userRepo.findOne({ where: { id: userId } });
    if (!usuario) throw new Error('Usuario no encontrado');

    const clasesMaximas = parseInt(usuario.planMensual ?? '4', 10); // 👈 convierte el plan a número

    const fecha = new Date(fechaTurno);
    const inicioMes = new Date(fecha.getFullYear(), fecha.getMonth(), 1);
    const finMes = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0);

    const actuales = await this.reservaRepo.count({
      where: {
        usuario: { id: userId },
        automatica: true,
        fechaTurno: Between(
          inicioMes.toISOString().split('T')[0],
          finMes.toISOString().split('T')[0]
        ),
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

    const fecha = new Date(fechaTurno);

    const primerDiaSemana = new Date(fecha);
    primerDiaSemana.setDate(fecha.getDate() - fecha.getDay() + 1); // Lunes

    const ultimoDiaSemana = new Date(primerDiaSemana);
    ultimoDiaSemana.setDate(primerDiaSemana.getDate() + 6); // Domingo

    const actuales = await this.reservaRepo.count({
      where: {
        usuario: { id: userId },
        automatica: true,
        // 🔴 NO contar las que fueron canceladas permanentemente
        cancelacionPermanente: false,
        fechaTurno: Between(
          primerDiaSemana.toISOString().split('T')[0],
          ultimoDiaSemana.toISOString().split('T')[0],
        ),
      },
    });

    return {
      actuales,
      maximas: clasesMaximasPorSemana,
    };
  }


  async getAsistenciaMensual(userId: number) {
    const ahora = new Date();

    const usuario = await this.userRepo.findOne({ where: { id: userId } });
    if (!usuario) throw new Error('Usuario no encontrado');

    // Plan mensual como número (4/8/12). Si no hay, default 4.
    const planMensual = parseInt(usuario.planMensual ?? '4', 10);

    // Traemos todas las reservas del usuario
    const reservas = await this.reservaRepo.find({
      where: { usuario: { id: userId } },
      relations: ['horario'],
      order: { fechaTurno: 'ASC' },
    });

    type MesStats = {
      asistidas: number;          // automáticas asistidas
      recuperadas: number;        // recuperaciones
      sueltas: number;            // clases sueltas
      canceladas: number;
      asistidasAlDia: number;     // TOTAL asistidas (auto + recup + sueltas)
      fechasAsistidas: string[];
      fechasRecuperadas: string[];
      fechasSueltas: string[];
      fechasCanceladas: string[];
      planMax: number;            // tope del plan
      validoRespectoPlan: boolean;
    };

    const resultado: Record<string, MesStats> = {};

    const fmtList = (d: Date) =>
      d.toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit' });

    for (const r of reservas) {
      // Fecha/hora del turno en AR
      const fechaTurnoDate = new Date(`${r.fechaTurno}T00:00:00-03:00`);
      const horaTurno = r.horario?.hora ?? '00:00';
      const fechaHoraTurno = new Date(`${r.fechaTurno}T${horaTurno}:00-03:00`);

      // Ignorar fines de semana
      const dow = fechaTurnoDate.getDay();
      if (dow === 0 || dow === 6) continue;

      // Ignorar cierres por ausencia
      if (await this.ausenciaProfeService.hayCierre(r.fechaTurno, horaTurno)) continue;

      // Mes (ej: "noviembre de 2025")
      const mesKey = fechaTurnoDate.toLocaleString('es-AR', {
        month: 'long',
        year: 'numeric',
      });

      if (!resultado[mesKey]) {
        resultado[mesKey] = {
          asistidas: 0,
          recuperadas: 0,
          canceladas: 0,
          sueltas: 0,
          asistidasAlDia: 0,
          fechasAsistidas: [],
          fechasRecuperadas: [],
          fechasSueltas: [],
          fechasCanceladas: [],
          planMax: planMensual,
          validoRespectoPlan: true,
        };
      }

      const m = resultado[mesKey];
      const pasoFecha = fechaHoraTurno.getTime() <= ahora.getTime();
      const fechaEtiqueta = fmtList(fechaTurnoDate);

      // 1️⃣ Canceladas momentáneas
      if (r.estado === 'cancelado' && r.cancelacionMomentanea) {
        m.canceladas++;
        m.fechasCanceladas.push(fechaEtiqueta);
        continue;
      }

      // 2️⃣ Clases sueltas → NO cuentan para el plan, pero sí como asistidas si ya pasaron
      if (r.tipo === 'suelta') {
        if (r.estado === 'reservado' && pasoFecha) {
          m.sueltas = (m.sueltas ?? 0) + 1;
          (m.fechasSueltas ??= []).push(fechaEtiqueta);
        }
        // no siguen por el flujo de automáticas/recuperaciones
        continue;
      }

      // 3️⃣ Automáticas (plan)
      if (r.automatica) {
        // Asistida = automática pasada y en 'reservado'
        if (r.estado === 'reservado' && pasoFecha) {
          m.asistidas++;
          m.fechasAsistidas.push(fechaEtiqueta);
        }
      } else {
        // 4️⃣ Recuperación (tipo 'recuperacion')
        const esRecuperada =
          r.estado === 'recuperada' ||
          (r.estado === 'reservado' && pasoFecha);

        if (esRecuperada) {
          m.recuperadas++;
          m.fechasRecuperadas.push(fechaEtiqueta);
        }
      }

      // (las sueltas ya hicieron `continue`, así que acá solo llega auto/recup)
    }

    // 🔄 Recalcular totales por mes una vez que ya procesamos todas las reservas
    for (const mesKey of Object.keys(resultado)) {
      const m = resultado[mesKey];

      // ✅ Clases asistidas al día de hoy (lo que mostrás en la sublínea):
      //    automáticas + recuperadas + sueltas
      m.asistidasAlDia = m.asistidas + m.recuperadas + (m.sueltas ?? 0);

      // ✅ Validación respecto al plan mensual:
      //    SOLO cuentan las automáticas + recuperadas (NO sueltas)
      const totalMesPlan = m.asistidas + m.recuperadas;
      m.validoRespectoPlan = totalMesPlan <= m.planMax;
    }

    return resultado;
  }


  async cancelarReservaPorUsuario(id: number, tipo: 'momentanea' | 'permanente', user: any) {
    const reserva = await this.reservaRepo.findOne({
      where: { id },
      relations: ['usuario', 'horario'],
    });

    if (!reserva) throw new NotFoundException('Reserva no encontrada');

    const userId = user?.id ?? user?.sub;
    const rol = user?.rol;

    // 🔐 Permitir solo al dueño o al admin
    if (!reserva.usuario || (reserva.usuario.id !== Number(userId) && rol !== 'admin')) {
      throw new ForbiddenException('No podés cancelar esta reserva');
    }

    const ahora = new Date();
    const fechaTurnoDate = new Date(`${reserva.fechaTurno}T00:00:00-03:00`);
    const fechaHoraTurno = new Date(`${reserva.fechaTurno}T${reserva.horario.hora}:00-03:00`);
    const diferenciaHoras = (fechaHoraTurno.getTime() - ahora.getTime()) / (1000 * 60 * 60);

    // ⛔️ Si cae en cierre por ausencia, no hace falta cancelar (no cuenta)
    const cierre = await this.ausenciaProfeService.hayCierre(reserva.fechaTurno, reserva.horario.hora);
    if (cierre) {
      return { mensaje: '📌 Estudio cerrado: no necesitás cancelar. La clase no se cuenta y podés recuperarla.' };
    }

    // 2 hs regla para alumno (igual)
      const turno = new Date(`${reserva.fechaTurno}T${reserva.horario.hora}:00-03:00`);
      const diffHs = (turno.getTime() - ahora.getTime()) / (1000 * 60 * 60);
      if (rol !== 'admin' && diffHs < 2) {
        throw new BadRequestException('Solo se puede cancelar hasta 2 horas antes del turno.');
      }

    if (reserva.tipo === 'suelta' || !reserva.automatica) {
      if (reserva.horario) {
        reserva.horario.reformersReservados = Math.max(0, reserva.horario.reformersReservados - 1);
        await this.horarioRepo.save(reserva.horario);
      }
      await this.reservaRepo.remove(reserva);
      return { mensaje: '✅ Reserva eliminada.' };
    }

    // ✅ Recuperación → borrado físico
    if (!reserva.automatica) {
      if (reserva.horario) {
        reserva.horario.reformersReservados = Math.max(0, reserva.horario.reformersReservados - 1);
        await this.horarioRepo.save(reserva.horario);
      }
      await this.reservaRepo.remove(reserva);
      return { mensaje: '✅ Reserva eliminada.' };
    }

    // ✅ Recurrente → cancelación momentánea o permanente
    if (tipo === 'momentanea') {
      reserva.estado = 'cancelado';
      reserva.cancelacionMomentanea = true;
      reserva.cancelacionPermanente = false;
    } else {
      reserva.estado = 'cancelado';
      reserva.cancelacionPermanente = true;
      reserva.cancelacionMomentanea = false;
    }
  
    reserva.fechaCancelacion = new Date();

    if (reserva.horario) {
      reserva.horario.reformersReservados = Math.max(0, reserva.horario.reformersReservados - 1);
      await this.horarioRepo.save(reserva.horario);
    }

    await this.reservaRepo.save(reserva);
    return { mensaje:
      tipo === 'momentanea'
        ? '✅ Reserva cancelada por esta vez. Podrás recuperar la clase.'
        : '✅ Reserva cancelada permanentemente. Dejá ese turno y podés elegir otro.',
      };
  }

  // Se ha añadido este cron job para generar las reservas automáticas
  // Se ejecuta todos los viernes a las 21:00 hora de Argentina
  @Cron('0 21 * * 5', { timeZone: 'America/Argentina/Buenos_Aires' })
  async cronGenerarSemanaSiguiente() {
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
    // Lunes base seleccionado (semana siguiente)
    const lunes = startOfWeek(lunesBaseParaSistema, { weekStartsOn: 1 });

    for (let i = 0; i < 5; i++) {
      const fecha = addDays(lunes, i);
      const fechaTurno = format(fecha, 'yyyy-MM-dd');
      const diaNombre = format(fecha, 'EEEE', { locale: es });
      const diaCapitalizado = diaNombre.charAt(0).toUpperCase() + diaNombre.slice(1);

      const horariosDelDia = await this.horarioRepo.find({
        where: { dia: diaCapitalizado },
        relations: ['reservas', 'reservas.usuario']
      });

      for (const horario of horariosDelDia) {

        // 🔒 Estudio cerrado → no generar
        const cierre = await this.ausenciaProfeService.hayCierre(fechaTurno, horario.hora);
        if (cierre) {
          console.log(`🛑 Suspensión ${cierre} en ${fechaTurno} ${horario.hora} → no generar automáticas`);
          continue;
        }

        // 📋 Plantilla de usuarios para este horario
        const plantillas = await this.reservaRepo.createQueryBuilder('r')
          .select('r.usuarioId', 'usuarioId')
          .where('r.horarioId = :hid', { hid: horario.id })
          .andWhere('r.automatica = true')
          .andWhere('r.estado = :estado', { estado: 'reservado' })
          .groupBy('r.usuarioId') // DISTINCT
          .getRawMany<{ usuarioId: number }>();

        for (const row of plantillas) {
          const usuarioId = Number(row.usuarioId);
          if (!Number.isFinite(usuarioId)) continue;

          // ✔ 1) PLAN VIGENTE
          const cicloPlan = await this.obtenerCicloPlanActivo(usuarioId, fechaTurno);
          if (!cicloPlan) {
            console.log(`⛔ Usuario ${usuarioId} — plan vencido para ${fechaTurno}. No se genera automática.`);
            continue;
          }

          // ✔ 2) CANCELACIÓN MOMENTÁNEA
          const canceladaMomentanea = await this.reservaRepo.findOne({
            where: {
              usuario: { id: usuarioId },
              horario: { id: horario.id },
              fechaTurno,
              estado: 'cancelado',
              cancelacionMomentanea: true
            }
          });
          if (canceladaMomentanea) {
            console.log(`⏩ Cancelación momentánea existente para usuario ${usuarioId} en ${fechaTurno}. Se saltea.`);
            continue;
          }

          // ✔ 3) DUPLICADO PREVIO
          const yaExiste = await this.reservaRepo.findOne({
            where: {
              usuario: { id: usuarioId },
              horario: { id: horario.id },
              fechaTurno,
              estado: 'reservado'
            }
          });
          if (yaExiste) {
            console.log(`⚠️ Ya existe reserva para usuario ${usuarioId} - ${diaCapitalizado} ${horario.hora} (${fechaTurno})`);
            continue;
          }

          // ✔ 4) CUPO EFECTIVO (con reformers bloqueados)
          const total = Number(horario.totalReformers ?? 0);
          const bloqueados = Math.max(0, Number(horario.blockedReformers ?? 0));

          const ocupadas = await this.reservaRepo.count({
            where: {
              horario: { id: horario.id },
              fechaTurno,
              estado: 'reservado'
            }
          });

          const libresTeoricos = Math.max(0, total - ocupadas);
          const bloqueadosAplicados = Math.min(bloqueados, libresTeoricos);
          const libresEfectivos = libresTeoricos - bloqueadosAplicados;

          if (libresEfectivos <= 0) {
            console.log(`🚫 Sin reformers disponibles (${total} totales, ${ocupadas} ocupadas, ${bloqueados} bloqueados) para ${horario.dia} ${horario.hora}`);
            continue;
          }

          // ✔ 5) Cargar datos del usuario
          const u = await this.userRepo.findOne({ where: { id: usuarioId } });
          const nombre = u?.nombre ?? 'Alumno';
          const apellido = u?.apellido ?? '';

          // ✔ 6) Crear nueva reserva automática
          const nuevaReserva = this.reservaRepo.create({
            horario,
            usuario: u!,
            nombre,
            apellido,
            fechaTurno,
            fechaReserva: format(new Date(), 'yyyy-MM-dd'),
            estado: 'reservado',
            automatica: true,
            tipo: 'automatica'
          });

          await this.reservaRepo.save(nuevaReserva);

          console.log(`✅ Reserva recurrente creada: ${nombre} ${apellido} - ${diaCapitalizado} ${horario.hora} (${fechaTurno})`);
        }
      }
    }

    console.log('✅ Finalizada generación de reservas automáticas de la semana.');
  }


  async marcarReservasMomentaneasComoRecuperadas() {
    const hoy = new Date().toISOString().split('T')[0];

    const reservasRecuperadas = await this.reservaRepo.find({
      where: {
        automatica: false,
        estado: 'reservado',
        fechaTurno: LessThan(hoy),
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
    const ahora = new Date();

    // Trae recuperaciones (automatica = false) aún en "reservado"
    // cuya fecha ya sea hoy o anterior (un filtro grueso para no traer futuras)
    const yyyy = ahora.getFullYear();
    const mm = String(ahora.getMonth() + 1).padStart(2, '0');
    const dd = String(ahora.getDate()).padStart(2, '0');
    const hoyYMD = `${yyyy}-${mm}-${dd}`;

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
        r.fechaCancelacion = new Date();  // marca de cierre (opcional)
        await this.reservaRepo.save(r);
      }
    }
  }

  @Cron('0 4 * * 0', { timeZone: 'America/Argentina/Buenos_Aires' }) 
  async marcarRecuperadasCron() {
    console.log('📆 Ejecutando CRON: domingo 04:00 → marcando reservas recuperadas...');
    await this.marcarReservasMomentaneasComoRecuperadas();
  }

  /** 
 * Devuelve el ciclo de plan ACTIVO para ese usuario y fecha de turno:
 * - Busca el último pago con fechaPago <= refFecha
 * - Calcula [inicio, fin] (YYYY-MM-DD) = [fechaPago, fechaPago + 30 días]
 * - Si no hay pago o el plan ya está vencido para esa fecha, devuelve null
 */
  private async obtenerCicloPlanActivo(
    userId: number,
    refFecha: string,
  ): Promise<{ inicio: string; fin: string } | null> {
    const ref = new Date(`${refFecha}T00:00:00-03:00`);

    const ultimoPago = await this.pagosRepo
      .createQueryBuilder('p')
      .where('p.userId = :userId', { userId })
      .andWhere('p.fechaPago IS NOT NULL')
      .andWhere('p.fechaPago <= :ref', { ref })
      .orderBy('p.fechaPago', 'DESC')
      .getOne();

    if (!ultimoPago || !ultimoPago.fechaPago) {
      return null;
    }

    const inicioDate = new Date(ultimoPago.fechaPago);
    const finDate = new Date(inicioDate.getTime());
    finDate.setDate(finDate.getDate() + 30); // plan válido 30 días

    if (ref > finDate) {
      // Para esa fecha el plan ya está vencido
      return null;
    }

    const toYMD = (d: Date) => d.toISOString().split('T')[0];

    return {
      inicio: toYMD(inicioDate),
      fin: toYMD(finDate),
    };
  }

  async contarCancelacionesMomentaneasDelMes(
    userId: number,
    fechaTurno: string,
  ): Promise<number> {
    const ciclo = await this.obtenerCicloPlanActivo(userId, fechaTurno);
    if (!ciclo) {
      // Plan vencido → no hay recuperaciones disponibles
      return 0;
    }

    const [canceladas, recuperadas, autoDelCiclo] = await Promise.all([
      // Cancelaciones momentáneas dentro del ciclo
      this.reservaRepo.count({
        where: {
          usuario: { id: userId },
          automatica: true,
          cancelacionMomentanea: true,
          estado: 'cancelado',
          fechaTurno: Between(ciclo.inicio, ciclo.fin),
        },
      }),
      // Recuperaciones ya usadas dentro del ciclo
      this.reservaRepo.count({
        where: {
          usuario: { id: userId },
          automatica: false,
          tipo: 'recuperacion',
          estado: In(['reservado', 'recuperada']),
          fechaTurno: Between(ciclo.inicio, ciclo.fin),
        }as any,
      }),
      // Automáticas del ciclo para ver cuántas cayeron en cierre (no cuentan y generan derecho a recup)
      this.reservaRepo.find({
        where: {
          usuario: { id: userId },
          automatica: true,
          estado: 'reservado',
          fechaTurno: Between(ciclo.inicio, ciclo.fin),
        },
        relations: ['horario'],
      }),
    ]);

    // Contar automáticas del ciclo que cayeron en cierre (ausencia profe / feriado)
    let autoEnCierre = 0;
    for (const r of autoDelCiclo) {
      if (
        await this.ausenciaProfeService.hayCierre(
          r.fechaTurno,
          r.horario?.hora ?? '00:00',
        )
      ) {
        autoEnCierre++;
      }
    }

    // Recuperaciones disponibles = (canceladas + auto en cierre) - recuperadas
    return canceladas + autoEnCierre - recuperadas;
  }

// ✅ Total de clases (automáticas + recuperaciones) dentro del ciclo de plan (30 días)
  async contarTotalClasesDelMes(
    userId: number,
    fechaTurno: string,
  ): Promise<{ actuales: number; maximas: number }> {
    const usuario = await this.userRepo.findOne({ where: { id: userId } });
    if (!usuario) throw new Error('Usuario no encontrado');

    const clasesMaximas = parseInt(usuario.planMensual ?? '4', 10);

    // Usamos el ciclo basado en fechaPago
    const ciclo = await this.obtenerCicloPlanActivo(userId, fechaTurno);
    if (!ciclo) {
      // Si el plan está vencido para esa fecha, a nivel conteo devolvemos 0 usadas;
      // la reserva igual se bloquea antes en reservar()
      return {
        actuales: 0,
        maximas: clasesMaximas,
      };
    }

    const clasesActuales = await this.reservaRepo.count({
      where: {
        usuario: { id: userId },
        estado: 'reservado',
        fechaTurno: Between(ciclo.inicio, ciclo.fin),
        tipo: In(['automatica', 'recuperacion']),
      } as any,
    });

    return {
      actuales: clasesActuales,
      maximas: clasesMaximas,
    };
  }

  // ✅ Clases efectivamente asistidas (automáticas + recuperaciones) dentro del ciclo del plan
  private async contarClasesAsistidasEnCiclo(
    userId: number,
    refFecha: string,  // normalmente la fecha del turno (hoy)
  ): Promise<{ actuales: number; maximas: number }> {
    const usuario = await this.userRepo.findOne({ where: { id: userId } });
    if (!usuario) throw new Error('Usuario no encontrado');

    const clasesMaximas = parseInt(usuario.planMensual ?? '4', 10);

    const ciclo = await this.obtenerCicloPlanActivo(userId, refFecha);
    if (!ciclo) {
      return { actuales: 0, maximas: clasesMaximas };
    }

    // Tomamos todas las reservas del ciclo para ese usuario (auto + recup)
    const reservas = await this.reservaRepo.find({
      where: {
        usuario: { id: userId },
        fechaTurno: Between(ciclo.inicio, ciclo.fin),
        tipo: In(['automatica', 'recuperacion']),
      } as any,
      relations: ['horario'],
    });

    // Consideramos "asistida" si:
    // - recuperacion: estado = 'recuperada'
    //   o (estado='reservado' y la hora ya pasó)
    // - automática: estado != 'cancelado' y la hora ya pasó
    let usadas = 0;

    // refDate: hasta el final del día de refFecha
    const refDate = new Date(`${refFecha}T23:59:59-03:00`);

    for (const r of reservas) {
      const hora = r.horario?.hora ?? '00:00';
      const turnoDate = new Date(`${r.fechaTurno}T${hora}:00-03:00`);

      if (turnoDate.getTime() > refDate.getTime()) {
        // Turno futuro dentro del ciclo → todavía no cuenta
        continue;
      }

      if (r.tipo === 'recuperacion') {
        const esAsistida =
          r.estado === 'recuperada' ||
          (r.estado === 'reservado' && turnoDate.getTime() <= refDate.getTime());
        if (esAsistida) usadas++;
      } else {
        // automática
        if (r.estado !== 'cancelado' && turnoDate.getTime() <= refDate.getTime()) {
          usadas++;
        }
      }
    }

    return { actuales: usadas, maximas: clasesMaximas };
  }

  async findByRango(desde: string, hasta: string) {
    try {
      return await this.reservaRepo
        .createQueryBuilder('r')
        .leftJoin('r.horario', 'h')   // ← no dependemos de r.horarioId
        .select([
          'r.fechaTurno AS "fechaTurno"',
          'h.id        AS "horarioId"',
        ])
        .where('r.estado = :estado', { estado: 'reservado' })
        .andWhere('r.fechaTurno BETWEEN :desde AND :hasta', { desde, hasta })
        .groupBy('r.fechaTurno, h.id')                 // ← evita duplicados
        .getRawMany<{ fechaTurno: string; horarioId: number }>();
    } catch (e: any) {
      console.error('findByRango() falló:', e?.message || e);
      // devolvemos vacío para que el front no quede en rojo
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

    if (usuario.telefono && actuales === maximas - 1) {
      const planType = `${usuario.planMensual} clases / mes`;

      try {
        await this.whatsappService.sendTemplatePlanPorVencer(
          usuario.telefono,
          usuario.nombre,
          planType,
        );
        console.log(
          `✅ Aviso de plan por vencer enviado a ${usuario.nombre} (${usuario.telefono}) [${planType}]`,
        );
      } catch (e) {
        console.error('❌ Error al enviar aviso:', e);
      }
    }
  }

  @Cron('0 22 * * *', { timeZone: 'America/Argentina/Buenos_Aires' }) // todos los días 22:00
  async notificarPenultimaClaseDelDia() {
    const ahora = new Date();
    const hoyYMD = format(ahora, 'yyyy-MM-dd'); // usamos date-fns que ya tenés importado

    console.log(`📆 CRON notificarPenultimaClaseDelDia para ${hoyYMD}...`);

    // Buscamos todas las reservas de HOY que cuentan como clase usada:
    // - tipo 'automatica' o 'recuperacion'
    // - estado 'reservado' (no canceladas)
    const reservasDeHoy = await this.reservaRepo.find({
      where: {
        fechaTurno: hoyYMD,
        estado: 'reservado',
        tipo: In(['automatica', 'recuperacion']),
      },
      relations: ['usuario', 'horario'],
    });

    for (const r of reservasDeHoy) {
      if (!r.usuario) continue;

      // Por seguridad: si el turno todavía no pasó (ej: corrés el CRON más temprano) lo salteamos
      const horaTurno = r.horario?.hora ?? '00:00'; // ej: '18:00'
      const turnoDate = new Date(`${r.fechaTurno}T${horaTurno}:00-03:00`);

      if (turnoDate.getTime() > ahora.getTime()) {
        // Clase aún no sucedió, no la contamos
        continue;
      }

      try {
        await this.notificarLimiteDeClases(r.usuario.id, r.fechaTurno);
      } catch (e) {
        console.error(
          `❌ Error al intentar notificar límite de clases para usuario ${r.usuario.id} en ${r.fechaTurno}:`,
          e,
        );
      }
    }

    console.log('✅ CRON notificarPenultimaClaseDelDia finalizado.');
  }


}
