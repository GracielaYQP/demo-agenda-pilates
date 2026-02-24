// src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { JwtStrategy } from './jwt.strategy';
import { InvitacionesModule } from '../invitaciones/invitaciones.module';
import { MailerService } from './mailer/mailer.service';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    UsersModule,
    InvitacionesModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),

    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService): JwtModuleOptions => ({
        secret: cfg.get<string>('JWT_SECRET')!,
        signOptions: {
          // ✅ Cast porque en .env viene string
          expiresIn: cfg.get<string>('JWT_EXPIRES_IN') as any,
          issuer: cfg.get<string>('JWT_ISSUER'),
          audience: cfg.get<string>('JWT_AUDIENCE'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, MailerService],
  exports: [JwtModule, PassportModule, AuthService],
})
export class AuthModule {}
