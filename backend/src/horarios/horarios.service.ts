import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Horario } from './horarios.entity';
import { Reserva } from '../reserva/reserva.entity';
import { User } from '../users/user.entity';
import { addDays, startOfWeek, format } from 'date-fns';
import { es } from 'date-fns/locale';
import { toZonedTime } from 'date-fns-tz';
import { ReservaService } from '../reserva/reserva.service';



@Injectable()
export class HorariosService {
  constructor(
    @InjectRepository(Horario)
    private horariosRepository: Repository<Horario>,
    @InjectRepository(Reserva)
    private reservasRepository: Repository<Reserva>,
    @InjectRepository(User) 
    private userRepository: Repository<User>,
    private readonly reservaService: ReservaService,
  ) {}

  // Obtener todos los horarios con reservas
  findAll(): Promise<Horario[]> {
    return this.horariosRepository.find({ relations: ['reservas', 'reservas.usuario'] });
  }

  // Obtener uno por ID
  findOne(id: number): Promise<Horario | null> {
    return this.horariosRepository.findOne({
      where: { id },
      relations: ['reservas', 'reservas.usuario'],
    });
  }

  // Reservar una cama
  async reservar(id: number, nombre: string, apellido: string, userId?: number): Promise<Horario> {
    if (!userId) throw new Error('ID de usuario no proporcionado');

    const horario = await this.horariosRepository.findOne({ where: { id } });
    if (!horario) throw new Error('Horario no encontrado');

    const diasSemana = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
    const diaIndex = diasSemana.indexOf(horario.dia);
    if (diaIndex === -1) throw new Error(`Día inválido: ${horario.dia}`);
    const lunes = this.lunesBaseParaSistema(new Date());
    // const lunes = startOfWeek(hoy, { weekStartsOn: 1 });
    const fechaTurno = addDays(lunes, diaIndex);
    const fechaTurnoStr = format(fechaTurno, 'yyyy-MM-dd');

    // Valida según plan y guarda la reserva
    await this.reservaService.reservar(id, userId, nombre, apellido, fechaTurnoStr, 'automatica');

    // Recuperar turno actualizado
    const turnoActualizado = await this.horariosRepository.findOne({
      where: { id },
      relations: ['reservas', 'reservas.usuario'],
    });

    if (!turnoActualizado) {
      throw new Error('No se pudo obtener el turno actualizado');
    }

    return turnoActualizado;
  }

  async getHorariosSemana(userId?: number) {
    // Genera reservas recurrentes al iniciar la semana (dejamos igual)
    const lunes = this.lunesBaseParaSistema(new Date());

    // Lunes a viernes de la misma semana
    const semana: Date[] = [];
    for (let i = 0; i < 5; i++) semana.push(addDays(lunes, i));

    // Cargamos horarios con sus reservas/usuarios
    const todosHorarios = await this.horariosRepository.find({
      relations: ['reservas', 'reservas.usuario'],
    });

    type Item = {
      idHorario: number;
      dia: string;
      fecha: string;
      hora: string;
      nivel: string;

      totalReformers: number;
      reformersReservados: number;
      reformersDisponibles: number;

      // ✅ NUEVOS (para “turno fijo”)
      reformersFijosReservados: number;
      reformersFijosDisponibles: number;

      reservadoPorUsuario: boolean;
      canceladoPorUsuario: boolean;
      reservas: any[];

      blockedReformers: number; // valor global guardado en la entidad (clamp visual del día)
    };

    const resultado: Item[] = [];

    for (const fecha of semana) {
      const diaNombre = format(fecha, 'EEEE', { locale: es });
      const diaCapitalizado = diaNombre.charAt(0).toUpperCase() + diaNombre.slice(1);
      const fechaISO = format(fecha, 'yyyy-MM-dd');

      const horariosDelDia = todosHorarios.filter(h => h.dia === diaCapitalizado);

      for (const horario of horariosDelDia) {
        // Filtrar reservas de ese día evitando desfase por TZ: compara YYYY-MM-DD "en crudo"
        const reservasDeEseDia = (horario.reservas ?? []).filter(r => {
          if (!r?.fechaTurno) return false;
          const turnoISO = String(r.fechaTurno).slice(0, 10);
          return turnoISO === fechaISO;
        });

        // Helper local para decidir si una reserva ocupa reformer (TU lógica actual)
        const cuentaComoReservado = (r: any): boolean => {
          const estado = String(r?.estado || '').toLowerCase(); // reservado | cancelado | cerrado | ...
          const cierreEstudio = (r as any)?.cierreEstudio === true;

          if (cierreEstudio) return false;        // cierres no ocupan reformer
          return estado === 'reservado';          // “libres hoy” = ocupación real del día
        };

        const cuentaComoFijo = (r: any): boolean => {
          const tipo = String(r?.tipo || '').toLowerCase();
          const esAuto = r?.automatica === true || tipo === 'automatica';
          if (!esAuto) return false;

          const cierreEstudio = (r as any)?.cierreEstudio === true;
          if (cierreEstudio) return false;               // cierre no es “fijo”

          if (r?.cancelacionPermanente === true) return false; // libera cupo fijo

          // reservado o cancelación momentánea => sigue siendo fijo
          return true;
        };


        const cantidadReservados = reservasDeEseDia.filter(cuentaComoReservado).length;

        const estaReservadoPorUsuario = !!(userId &&
          reservasDeEseDia.some(r => r.usuario?.id === userId && cuentaComoReservado(r)));

        const estaCanceladoPorUsuario = !!(userId &&
          reservasDeEseDia.some(r => r.usuario?.id === userId && (r?.estado || '').toLowerCase() === 'cancelado'));

        const reservasParaUI = (reservasDeEseDia ?? []).filter(r => {
        const estado = String(r?.estado || '').toLowerCase();
        const cierreEstudio = (r as any)?.cierreEstudio === true;

        //  mostrar reservadas
        if (estado === 'reservado') return true;

        // mostrar cancelación MOMENTÁNEA del alumno (NO cierre)
        if (
          estado === 'cancelado' &&
          r?.cancelacionMomentanea === true &&
          cierreEstudio === false
        ) return true;

        return false;
      });
      // Orden visual de reservas dentro de la celda
      reservasParaUI.sort((a: any, b: any) => {
        const prio = (r: any) => {
          const e = String(r?.estado || '').toLowerCase();
          const t = String(r?.tipo || '').toLowerCase();

          // cancelaciones al final
          if (e === 'cancelado') return 90;

          // normales (automáticas)
          if (t === 'automatica' && e === 'reservado') return 10;

          // recuperaciones
          if (t === 'recuperacion') return 20;

          // sueltas
          if (t === 'suelta') return 30;

          return 50;
        };

        const pA = prio(a);
        const pB = prio(b);
        if (pA !== pB) return pA - pB;

        // desempate: apellido, nombre
        const apA = String(a?.apellido || '').toLowerCase().trim();
        const apB = String(b?.apellido || '').toLowerCase().trim();
        if (apA !== apB) return apA.localeCompare(apB);

        const nomA = String(a?.nombre || '').toLowerCase().trim();
        const nomB = String(b?.nombre || '').toLowerCase().trim();
        return nomA.localeCompare(nomB);
      });



        // --- Cálculo de camas (TU lógica actual) ---
        const total = Number(horario.totalReformers ?? 5);
        const reservados = Number(cantidadReservados ?? 0);
        const libresTeoricos = Math.max(0, total - reservados);

        // bloqueados globales del horario (forzamos a number)
        const bloqueadosDB = Number(horario.blockedReformers ?? 0);
        // clamp para no superar los libres del día
        const bloqueados = Math.min(Math.max(0, bloqueadosDB), libresTeoricos);

        // libres efectivos = total - reservados - bloqueados
        const reformersDisponibles = Math.max(0, libresTeoricos - bloqueados);

        // NUEVO: cálculo de “turno fijo”
        const fijosReservados = reservasDeEseDia.filter(cuentaComoFijo).length;
        const reformersFijosDisponibles = Math.max(0, total - fijosReservados - bloqueados);

        console.log(
          `${diaCapitalizado} ${horario.hora} → tot:${total} res:${reservados} blk:${bloqueados} ⇒ libre:${reformersDisponibles} | fijos:${fijosReservados} ⇒ fijoLibre:${reformersFijosDisponibles}`
        );

        resultado.push({
          idHorario: horario.id,
          dia: diaCapitalizado,
          fecha: fechaISO,
          hora: horario.hora,
          nivel: horario.nivel,

          totalReformers: total,
          reformersReservados: reservados,
          reformersDisponibles,

          reformersFijosReservados: fijosReservados,
          reformersFijosDisponibles,

          reservadoPorUsuario: estaReservadoPorUsuario,
          canceladoPorUsuario: estaCanceladoPorUsuario,
          reservas: reservasParaUI,
          blockedReformers: bloqueados,
        });
      }
    }

    return resultado.map(h => ({ ...h, reservas: h.reservas ?? [] }));
  }


  private lunesBaseParaSistema(now = new Date()): Date {
    const timeZone = 'America/Argentina/Buenos_Aires';
    const hoyBA = toZonedTime(now, timeZone);

    const dow = hoyBA.getDay();      // 0=Dom, 5=Vie
    const hour = hoyBA.getHours();   // hora local BA

    // Desde viernes 20:00 o durante sáb/dom → usar semana siguiente
    const saltar = (dow === 5 && hour >= 20) || dow === 6 || dow === 0;

    const base = saltar ? addDays(hoyBA, 7) : hoyBA;
    return startOfWeek(base, { weekStartsOn: 1 });
  }

  async setBloqueo(horarioId: number, blockedReformers: number) {
    const h = await this.horariosRepository.findOne({ where: { id: horarioId } });
    if (!h) throw new NotFoundException('Horario no encontrado');

    // normalizar a entero y clamplear contra el total (no contra reservados, porque no es por fecha)
    const pedido = Math.max(0, Math.trunc(Number(blockedReformers) || 0));
    const nuevo = Math.min(pedido, Math.max(0, Number(h.totalReformers || 0)));

    h.blockedReformers = nuevo;
    await this.horariosRepository.save(h);

    return { ok: true, blockedReformers: nuevo };
  }

}