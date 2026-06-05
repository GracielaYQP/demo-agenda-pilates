import { BadRequestException, Controller, Post, Param, Get, ParseIntPipe } from '@nestjs/common';
import { CiclosAsistenciaService } from './ciclos-asistencia.service';
import { Public } from '../auth/public.decorator';

@Controller('ciclos-asistencia')
export class CiclosAsistenciaController {
  constructor(private readonly service: CiclosAsistenciaService) {}

  @Public()
  @Post('sync-open/:userId')
  syncOpen(@Param('userId', ParseIntPipe) userId: number) {
    return this.service.syncCicloAbierto(userId);
  }

  @Public()
  @Post('rebuild/:userId')
  rebuild(@Param('userId', ParseIntPipe) userId: number) {
    throw new BadRequestException(
      'Rebuild histórico deshabilitado. Usar POST /ciclos-asistencia/sync-open/:userId',
    );
  }

  @Public()
  @Get('historial/:userId')
  historial(@Param('userId', ParseIntPipe) userId: number) {
    return this.service.getHistorial(userId);
  }

  @Public()
  @Post('rebuild-all')
  rebuildAll() {
    throw new BadRequestException(
      'rebuild-all deshabilitado para no pisar ciclos históricos cerrados.',
    );
  }
}