import { Controller, Get, Post, Body, Query, Delete, Param, ParseIntPipe } from '@nestjs/common';
import { PagosService } from './pagos.service';
import { UpsertPagoDto } from './dto/upsert-pago.dto';

@Controller('pagos')
export class PagosController {
  constructor(private readonly svc: PagosService) {}

  @Get('estado')
  estado(@Query('userId') userId: number, @Query('mes') mes: number, @Query('anio') anio: number) {
    return this.svc.estado(+userId, +mes, +anio);
  }

  @Get('estado-actual')
  estadoActual(@Query('userId') userId: number) {
    return this.svc.estadoActual(+userId);
  }

  @Post('confirmar')
  confirmar(@Body() dto: UpsertPagoDto) {
    return this.svc.upsertConfirmado(dto);
  }

  @Delete()
  eliminar(@Query('userId') userId: number, @Query('mes') mes: number, @Query('anio') anio: number) {
    return this.svc.eliminar(+userId, +mes, +anio);
  }

  @Get('resumen')
  resumen(@Query('mes') mes: string, @Query('anio') anio: string) {
    const m = parseInt(mes, 10);
    const y = parseInt(anio, 10);
    return this.svc.resumenMensual(y, m);
  }

  @Get('historial/:userId')
  historial(
    @Param('userId', ParseIntPipe) userId: number,
    @Query('anio') anio?: string,
  ) {
    const y = anio ? parseInt(anio, 10) : undefined;
    return this.svc.historial(userId, y);
  }
}

