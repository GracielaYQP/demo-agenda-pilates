import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AusenciaProfe } from './ausencia-profe.entity';
import { AusenciaProfeService } from './ausencia-profe.service';
import { AusenciaProfeController } from './ausencia-profe.controller';
import { WhatsAppModule } from 'src/whatsapp/whatsapp.module';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [TypeOrmModule.forFeature([AusenciaProfe]),
    WhatsAppModule,
    UsersModule,
  ],
  controllers: [AusenciaProfeController],
  providers: [AusenciaProfeService],
  exports: [AusenciaProfeService],
})
export class AusenciaProfeModule {}

