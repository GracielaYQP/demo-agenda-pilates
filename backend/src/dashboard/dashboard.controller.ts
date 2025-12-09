import { Controller, Get, Query, ParseIntPipe, UseGuards, Post } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { Roles } from '../auth/roles.decorator';
import { JwtAuthGuard } from 'src/auth/jwt.guard';
import { RolesGuard } from 'src/auth/roles.guard';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}

  @Get('resumen-mensual')
  resumenMensual(
    @Query('anio', ParseIntPipe) anio: number,
    @Query('mes', ParseIntPipe) mes: number, // 1..12
  ) {
    return this.svc.getResumenMensual(anio, mes);
  }

  @Get('deudores')
  deudoresEntre1y10(
    @Query('anio', ParseIntPipe) anio: number,
    @Query('mes', ParseIntPipe) mes: number, // 1..12
  ) {
    return this.svc.getDeudoresEntre1y10(anio, mes);
  }

  @Post('notificar-deudores')
  async notificarDeudores(
    @Query('anio', ParseIntPipe) anio: number,
    @Query('mes', ParseIntPipe) mes: number,
  ) {
    return this.svc.notificarDeudoresWhatsApp(anio, mes);
  }


  @Get('alumnos-asistencia')
  alumnosAsistencia(
    @Query('anio', ParseIntPipe) anio: number,
    @Query('mes', ParseIntPipe) mes: number,
  ) {
    return this.svc.getAlumnosAsistencia(anio, mes);
  }

  @Get('clases-operacion')
  clasesOperacion(
    @Query('anio', ParseIntPipe) anio: number,
    @Query('mes', ParseIntPipe) mes: number,
  ) {
    return this.svc.getClasesOperacion(anio, mes);
  }

}
