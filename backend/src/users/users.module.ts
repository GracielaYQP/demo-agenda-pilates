// src/users/users.module.ts
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { Reserva } from '../reserva/reserva.entity';
import { Horario } from '../horarios/horarios.entity';


@Module({
  imports: [TypeOrmModule.forFeature([User, Reserva, Horario])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}

