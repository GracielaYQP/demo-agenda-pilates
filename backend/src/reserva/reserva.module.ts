import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Reserva } from './reserva.entity';
import { ReservaController } from './reserva.controller';
import { ReservaService } from './reserva.service';
import { Horario } from '../horarios/horarios.entity';
import { User } from '../users/user.entity';
import { AusenciaProfeModule } from '../feriados/ausencia-profe.module';
import { Pago } from 'src/pagos/pagos.entity';
import { WhatsAppModule } from 'src/whatsapp/whatsapp.module';
import { Notificacion } from 'src/notificaciones/notificacion.entity';
import { TurnoFijo } from 'src/turnos-fijos/turnos-fijos.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Reserva, Horario, User, Pago, Notificacion, TurnoFijo]),
           AusenciaProfeModule,
            WhatsAppModule,],
  controllers: [ReservaController],
  providers: [ReservaService],
  exports: [TypeOrmModule, ReservaService]
})
export class ReservaModule {}

