import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Patch, Req, UseGuards } from '@nestjs/common';
import { HorariosService } from './horarios.service';
import { Request as ExpressRequest } from 'express';
import { Public } from 'src/auth/public.decorator';
import { JwtAuthGuard } from 'src/auth/jwt.guard';
import { RolesGuard } from 'src/auth/roles.guard';
import { Roles } from 'src/auth/roles.decorator';
import { UpdateBloqueoDto } from './dto/update-bloqueo.dto';


@Controller('horarios')
export class HorariosController {
  constructor(private readonly horariosService: HorariosService) {}

  @Public()
  @Get()
  findAll() {
    return this.horariosService.findAll().then(horarios => {
      console.log('🧾 Horarios enviados al frontend:', horarios);
      return horarios;
    });
  }

  @Public()
  @Get('semana')
  async getSemana(@Req() req: ExpressRequest & { user?: any }) {
    const user = req.user;
    const userId = user?.id ?? null;

    return this.horariosService.getHorariosSemana(userId);
  }

  @Public()
  @Get(':id')
    findOne(@Param('id') id: string) {
      return this.horariosService.findOne(+id);
    }

  
  @Patch(':id/bloqueo')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  updateBloqueo(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBloqueoDto,
  ) {
    return this.horariosService.setBloqueo(id, dto.blockedReformers);
  }
}




