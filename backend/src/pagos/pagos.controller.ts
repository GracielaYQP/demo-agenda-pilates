// pagos.controller.ts
import { Controller, Get, Post, Body, Query, Delete, Param, ParseIntPipe } from '@nestjs/common';
import { PagosService } from './pagos.service';
import { UpsertPagoCicloDto } from './dto/upsert-pago-ciclo.dto';

@Controller('pagos')
export class PagosController {
  constructor(private readonly svc: PagosService) {}
  
  @Get('estado-ciclo-actual')
  estadoCicloActual(@Query('userId') userId: number) {
    return this.svc.estadoCicloActual(+userId);
  }

  @Post('confirmar-ciclo')
  confirmarPagoCiclo(@Body() dto: UpsertPagoCicloDto) {
    return this.svc.upsertConfirmadoCiclo(dto);
  }

  @Delete(':id')
  eliminar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.eliminar(id);
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

