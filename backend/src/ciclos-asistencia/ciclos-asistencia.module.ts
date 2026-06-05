import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CiclosAsistencia } from './ciclos-asistencia.entity';
import { CiclosAsistenciaService } from './ciclos-asistencia.service';
import { CiclosAsistenciaController } from './ciclos-asistencia.controller';
import { ReservaModule } from '../reserva/reserva.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CiclosAsistencia]),
    forwardRef(() => ReservaModule),
  ],
  providers: [CiclosAsistenciaService],
  controllers: [CiclosAsistenciaController],
  exports: [CiclosAsistenciaService],
})
export class CiclosAsistenciaModule {}