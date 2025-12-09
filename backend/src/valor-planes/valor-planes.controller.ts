import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ValorPlanesService } from './valor-planes.service';
import { UpsertValorPlanDto } from './dto/upsert-valor-plan.dto';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { Public } from 'src/auth/public.decorator';

@Controller('valor-planes')
export class ValorPlanesController {
  constructor(private readonly service: ValorPlanesService) {}

  // Público
  @Public()
  @Get()
  getPublic() {
    return this.service.getPublic();
  }

  // Admin: lista completa
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('admin')
  getAll() {
    return this.service.getAll();
  }

  // Admin: crear/actualizar
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post('upsert')
  upsert(@Body() dto: UpsertValorPlanDto) {
    return this.service.upsert(dto);
  }

  // Obtener uno por tipo
  @Get(':tipo')
  getByTipo(@Param('tipo') tipo: 'suelta'|'4'|'8'|'12') {
    return this.service.getByTipo(tipo);
  }
}

