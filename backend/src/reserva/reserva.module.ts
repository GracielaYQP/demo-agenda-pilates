import { Module, forwardRef  } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Reserva } from './reserva.entity';
import { ReservaController } from './reserva.controller';
import { ReservaService } from './reserva.service';
import { Horario } from '../horarios/horarios.entity';
import { User } from '../users/user.entity';
import { AusenciaProfeModule } from '../feriados/ausencia-profe.module';
import { Pago } from '../pagos/pagos.entity';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { Notificacion } from '../notificaciones/notificacion.entity';
import { TurnoFijo } from '../turnos-fijos/turnos-fijos.entity';
import { CiclosAsistenciaModule } from '../ciclos-asistencia/ciclos-asistencia.module';

@Module({
  imports: [TypeOrmModule.forFeature([Reserva, Horario, User, Pago, Notificacion, TurnoFijo]),
            forwardRef(() => CiclosAsistenciaModule),
            AusenciaProfeModule,
            WhatsAppModule,],
  controllers: [ReservaController],
  providers: [ReservaService],
  exports: [TypeOrmModule, ReservaService]
})
export class ReservaModule {}

