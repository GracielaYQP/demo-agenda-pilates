import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ValorPlan } from './valor-planes.entity';
import { ValorPlanesService } from './valor-planes.service';
import { ValorPlanesController } from './valor-planes.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ValorPlan])],
  providers: [ValorPlanesService],
  controllers: [ValorPlanesController],
  exports: [ValorPlanesService],
})
export class ValorPlanesModule {}
