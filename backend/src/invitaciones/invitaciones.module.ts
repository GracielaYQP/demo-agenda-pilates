import { Module } from '@nestjs/common';
import { InvitacionesService } from './invitaciones.service';
import { InvitacionesController } from './invitaciones.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invitacion } from './invitaciones.entity';
import { User } from '../users/user.entity';


@Module({
  imports: [TypeOrmModule.forFeature([Invitacion, User])],
  controllers: [InvitacionesController],
  providers: [InvitacionesService],
  exports: [InvitacionesService] // 👈 Si lo usas en AuthModule
})
export class InvitacionesModule {}

