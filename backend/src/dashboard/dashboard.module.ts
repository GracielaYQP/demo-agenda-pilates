import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DashboardController } from './dashboard.controller';
import { Pago } from '../pagos/pagos.entity';
import { User } from '../users/user.entity';
import { ValorPlan } from '../valor-planes/valor-planes.entity';
import { Reserva } from '../reserva/reserva.entity';      
import { Horario } from '../horarios/horarios.entity';
import { DashboardService } from './dashboard.service';
import { RolesGuard } from '../auth/roles.guard';
import { WhatsAppModule } from 'src/whatsapp/whatsapp.module';
import { DashboardCron } from './dashboard.cron';

@Module({
  imports: [
    TypeOrmModule.forFeature([Pago, User, ValorPlan, Reserva, Horario]),
    WhatsAppModule,],
  controllers: [DashboardController],
  providers: [DashboardService, RolesGuard, DashboardCron],
  exports: [DashboardService],
})
export class DashboardModule {}
