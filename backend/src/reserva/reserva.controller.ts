import { Controller, Post, Param, Body, Get, UseGuards, Req, BadRequestException, Patch, Query, ParseDatePipe } from '@nestjs/common';
import { ReservaService } from './reserva.service';
import { Request } from 'express';
import { JwtAuthGuard } from 'src/auth/jwt.guard';
import { RolesGuard } from 'src/auth/roles.guard';
import { Public } from 'src/auth/public.decorator';

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
      // En lugar de tirar 400, devolvemos [] y logeamos
      console.warn('[/reservas/rango] fechas inválidas →', { d, h });
      
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

  // (si querés, este GET puede ser público)
  @Get(':horarioId')
  getReservas(@Param('horarioId') horarioIdParam: string) {
    const horarioId = Number(horarioIdParam);
    if (isNaN(horarioId)) throw new BadRequestException('ID de horario inválido');
    return this.reservaService.obtenerReservasPorHorario(horarioId);
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

  @UseGuards(JwtAuthGuard)
  @Post('cancelar')
  cancelarPorFecha(
    @Req() req: Request,
    @Body() body: { horarioId: number; fechaTurno: string }
  ) {
    const user = req.user as any;
    const userId = user?.id;
    if (!userId || isNaN(Number(userId))) throw new BadRequestException('ID de usuario no válido');
    if (!body.horarioId || !body.fechaTurno) throw new BadRequestException('Faltan datos: horarioId o fecha');
    return this.reservaService.cancelarPorFecha(body.horarioId, userId, body.fechaTurno);
  }

  @UseGuards(JwtAuthGuard)
  @Get('recurrentes/:userId/:fecha')
  contarRecurrentes(@Param('userId') userId: number, @Param('fecha') fecha: string) {
    return this.reservaService.contarReservasAutomaticasDelMes(userId, fecha);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('asistencia-mensual/:userId')
  getAsistenciaMensual(@Param('userId') userId: number) {
    return this.reservaService.getAsistenciaMensual(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('cancelar/:id')
  async cancelarReserva(
    @Param('id') idParam: string,
    @Body('tipo') tipo: 'momentanea' | 'permanente',
    @Req() req: Request
  ) {
    const id = Number(idParam);
    if (!id || Number.isNaN(id)) throw new BadRequestException('ID de reserva inválido');
    if (!tipo || (tipo !== 'momentanea' && tipo !== 'permanente')) {
      throw new BadRequestException('Tipo de cancelación inválido');
    }
    return this.reservaService.cancelarReservaPorUsuario(id, tipo, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post('marcar-recuperadas')
  async marcarRecuperadas() {
    return this.reservaService.marcarReservasMomentaneasComoRecuperadas();
  }
}


