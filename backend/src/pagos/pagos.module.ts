// src/pagos/pagos.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PagosController } from './pagos.controller';
import { PagosService } from './pagos.service';
import { Pago } from './pagos.entity'; 
import { ReservaModule } from 'src/reserva/reserva.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Pago]),
    ReservaModule, 
  ],
  controllers: [PagosController],
  providers: [PagosService],
  exports: [PagosService], 
})
export class PagosModule {}

