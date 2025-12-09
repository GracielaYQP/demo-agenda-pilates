import { Module } from '@nestjs/common';
import { HorariosController } from './horarios.controller';
import { HorariosService } from './horarios.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Horario } from './horarios.entity';
import { Reserva } from '../reserva/reserva.entity';
import { ReservaModule } from '../reserva/reserva.module';

@Module({
  controllers: [HorariosController],
  providers: [HorariosService],
  imports: [TypeOrmModule.forFeature([Horario, Reserva]), 
            ReservaModule],
  exports: [HorariosService],
})
export class HorariosModule {}
