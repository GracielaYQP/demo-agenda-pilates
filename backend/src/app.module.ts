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
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: 'carola20958',
      database: 'demo_agenda_pilates',
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: true,
    }),
    ConfigModule.forRoot({ 
      isGlobal: true,
      envFilePath: [
        `.env.${process.env.NODE_ENV}.local`, // ej: .env.production.local
        `.env.${process.env.NODE_ENV}`,       // ej: .env.production
        `.env.local`,                         // si querés sobreescribir
        `.env`,                               // fallback
        `.env.production`,
      ],
    }),
    // TypeOrmModule.forRoot({
    //   type: 'postgres',
    //   url: process.env.DATABASE_URL,
    //   synchronize: process.env.DB_SYNC === 'true',
    //   ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    //   autoLoadEntities: true,
     
    // }),
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






