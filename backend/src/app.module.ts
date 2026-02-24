import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from './users/users.module';
import { InvitacionesModule } from './invitaciones/invitaciones.module';
import { HorariosModule } from './horarios/horarios.module';
import { ReservaModule } from './reserva/reserva.module';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AusenciaProfeModule } from './feriados/ausencia-profe.module';
import { ValorPlanesModule } from './valor-planes/valor-planes.module';
import { PagosModule } from './pagos/pagos.module';
import { APP_GUARD } from '@nestjs/core';
import { RolesGuard } from './auth/roles.guard';
import { JwtAuthGuard } from './auth/jwt.guard';
import { AppService } from './app.service';
import { DashboardModule } from './dashboard/dashboard.module';

@Module({
   imports: [
    ConfigModule.forRoot({ 
      isGlobal: true,
      envFilePath: [
        `.env.${process.env.NODE_ENV}.local`, 
        `.env.${process.env.NODE_ENV}`,       
        `.env`,                              
        `.env.production`,
      ],
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      synchronize: process.env.DB_SYNC === 'true',
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      ssl: false,
    }),

    
    ScheduleModule.forRoot(),
    AuthModule,
    UsersModule,
    InvitacionesModule,
    HorariosModule,
    ReservaModule,
    AusenciaProfeModule,
    ValorPlanesModule,
    PagosModule,
    DashboardModule
  ],
  controllers: [AppController],
  providers: [
     AppService, 
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },   
  ],
})
export class AppModule {}






