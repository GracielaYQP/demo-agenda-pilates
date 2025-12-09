import { Controller, Get, Post, Delete, Body, Param, Query, BadRequestException } from '@nestjs/common';
import { AusenciaProfeService } from './ausencia-profe.service';
import { CreateAusenciaDto } from './ausencia-profe.dto';
import { ListResponse } from './ausencia-profe.types';
import { AusenciaProfe } from './ausencia-profe.entity';
import { Public } from 'src/auth/public.decorator';
import { Roles } from 'src/auth/roles.decorator';

@Controller('feriados/ausencias-profe')
export class AusenciaProfeController {
  constructor(private service: AusenciaProfeService) {}

  @Public()
  @Get()
  async listar(
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string
  ): Promise<ListResponse<AusenciaProfe>> {
    if (!desde || !hasta) throw new BadRequestException('desde/hasta requeridos (YYYY-MM-DD)');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
      throw new BadRequestException('Formato inválido: use YYYY-MM-DD');
    }
    if (desde > hasta) [desde, hasta] = [hasta, desde];

    try {
      const result = await this.service.listar(desde!, hasta!);
      return result;
    } catch (e) {
      return { count: 0, list: [] };
    }
  }

  @Roles('admin')
  @Post()
  async crear(@Body() dto: CreateAusenciaDto) {
    return this.service.crear(dto);
  }

  @Roles('admin')
  @Delete(':id')
  eliminar(@Param('id') id: string) {
    return this.service.eliminar(+id);
  }
}