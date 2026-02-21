import { Controller, Post, Param, Body, Get, UseGuards, Req, BadRequestException, Patch, Query, ParseDatePipe, ParseIntPipe } from '@nestjs/common';
import { ReservaService } from './reserva.service';
import { Request } from 'express';
import { JwtAuthGuard } from 'src/auth/jwt.guard';
import { RolesGuard } from 'src/auth/roles.guard';
import { Public } from 'src/auth/public.decorator';
import { Roles } from 'src/auth/roles.decorator';

@Controller('reservas')
export class ReservaController {
  constructor(private reservaService: ReservaService) {}

  @Public()
  @Get('rango')
  async findByRango(
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Req() req?: Request,
  ) {
  
    console.log('GET /reservas/rango', { desde, hasta, tipos: [typeof desde, typeof hasta] });
     if (req) {
      // show query string / headers para depurar
      try { console.log('req.url:', (req as any).url); } catch (e) {}
      try { console.log('req.headers sample:', ((req as any).headers || {})); } catch (e) {}
    }
    // Normalizamos y validamos formato YYYY-MM-DD
    const norm = (s?: string) => (s || '').trim().slice(0, 10);
    const ISO = /^\d{4}-\d{2}-\d{2}$/;

    const d = norm(desde);
    const h = norm(hasta);

    if (!ISO.test(d) || !ISO.test(h)) {
      console.warn('[/reservas/rango] fechas inválidas →', { d, h });
      return []; // ✅
    }

    // Si vinieron invertidas, las acomodamos
    const min = d <= h ? d : h;
    const max = d <= h ? h : d;

    return this.reservaService.findByRango(min, max);
  }

  // 👉 Obtener reservas del usuario autenticado
  @UseGuards(JwtAuthGuard)
  @Get('mis-reservas')
  getMisReservas(@Req() req: Request) {
    const idRaw = (req.user as any)?.id ?? (req.user as any)?.sub;
    if (!idRaw) throw new BadRequestException('Token inválido: no contiene ID');

    const userId = Number(idRaw);
    if (!Number.isInteger(userId)) throw new BadRequestException('El ID del usuario no es válido');

    return this.reservaService.obtenerReservasPorUsuario(userId);
  }

  // ✅ Param numérico para no capturar 'rango'
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post(':horarioId')
  reservar(
    @Param('horarioId') horarioIdParam: string,
    @Req() req: Request,
    @Body() body: { nombre: string; apellido: string; userId?: number; fechaTurno: string; automatica?: boolean; tipo?: 'automatica'|'recuperacion'|'suelta' }
  ) {
    const horarioId = Number(horarioIdParam);
    if (isNaN(horarioId)) throw new BadRequestException('ID de horario inválido');

    const user = req.user as any;
    const rol = user?.rol;
    const idFromToken = user?.id ?? user?.sub;
    const userId = body.userId ?? idFromToken;

    if (!userId || isNaN(Number(userId))) throw new BadRequestException('ID de usuario no válido');
    if (rol === 'admin' && !body.userId) throw new BadRequestException('Un administrador debe indicar el usuario para reservar');
    if (!body.fechaTurno) throw new BadRequestException('Debe indicarse la fecha del turno');

    const tipo: 'automatica'|'recuperacion'|'suelta' =
      body.tipo ?? ((String(body.automatica ?? 'true').toLowerCase() === 'true') ? 'automatica' : 'recuperacion');

    return this.reservaService.reservar(
      horarioId,
      Number(userId),
      body.nombre,
      body.apellido,
      body.fechaTurno,
      tipo,
      rol,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post('suelta/:horarioId')
  reservarSuelta(
    @Param('horarioId') horarioIdParam: string,
    @Req() req: Request,
    @Body() body: { nombre: string; apellido: string; userId?: number; fechaTurno: string }
  ) {
    (body as any).tipo = 'suelta';
    return this.reservar(horarioIdParam, req, body as any);
  }
 
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post('anular/:reservaId')
  anularReserva(@Param('reservaId') reservaId: string) {
    return this.reservaService.anularReserva(Number(reservaId));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Patch(':reservaId')
  editarReserva(
    @Param('reservaId') reservaId: string,
    @Body() body: { nombre?: string; apellido?: string; nuevoUserId?: number }
  ) {
    return this.reservaService.editarReserva(Number(reservaId), body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post('cancelar')
  cancelarPorFecha(
    @Body() body: { horarioId: number; fechaTurno: string; usuarioId: number }
  ) {
    const usuarioId = Number(body.usuarioId);
    const horarioId = Number(body.horarioId);
    const fechaTurno = String(body.fechaTurno || '').trim().slice(0, 10);

    if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
      throw new BadRequestException('usuarioId inválido');
    }
    if (!Number.isInteger(horarioId) || horarioId <= 0) {
      throw new BadRequestException('horarioId inválido');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaTurno)) {
      throw new BadRequestException('fechaTurno inválida (YYYY-MM-DD)');
    }

    // ✅ Admin: solo cancelar a futuro (hoy o más adelante)
    const hoyYMD = this.reservaService['ymdTodayAR']?.() ?? new Date().toISOString().slice(0, 10);
    if (fechaTurno < hoyYMD) throw new BadRequestException('No se puede cancelar una clase pasada.');

    return this.reservaService.cancelarPorFecha(horarioId, usuarioId, fechaTurno);
  }

  @UseGuards(JwtAuthGuard)
  @Get('recurrentes/:userId/:fecha')
  contarRecurrentes(@Param('userId') userId: number, @Param('fecha') fecha: string) {
    return this.reservaService.contarReservasAutomaticasDelMes(userId, fecha);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('asistencia-ciclos/:userId')
  getAsistenciaCiclos(@Param('userId', ParseIntPipe) userId: number) {
    return this.reservaService.getAsistenciaCiclos(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('cancelar/:id')
  async cancelarReserva(
    @Param('id') idParam: string,
    @Body('tipo') tipo: 'momentanea' | 'permanente',
    @Req() req: any
  ) {
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      throw new BadRequestException('ID de reserva inválido');
    }
    if (tipo !== 'momentanea' && tipo !== 'permanente') {
      throw new BadRequestException('Tipo de cancelación inválido');
    }

    return this.reservaService.cancelarReservaPorUsuario(id, tipo, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post('marcar-recuperadas')
  async marcarRecuperadas() {
    return this.reservaService.marcarReservasMomentaneasComoRecuperadas();
  }

  @Get(':horarioId')
  getReservas(@Param('horarioId') horarioIdParam: string) {
    const horarioId = Number(horarioIdParam);
    if (isNaN(horarioId)) throw new BadRequestException('ID de horario inválido');
    return this.reservaService.obtenerReservasPorHorario(horarioId);
  }
}


