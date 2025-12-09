// src/auth/jwt.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly cfg: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: cfg.get<string>('JWT_SECRET', 'secretKey'),
      issuer: cfg.get<string>('JWT_ISSUER', 'lucia-pilates'),
      audience: cfg.get<string>('JWT_AUDIENCE', 'lucia-pilates-web'),
      // clockTolerance: 5, // opcional, segundos de tolerancia de reloj
    });
  }

  async validate(payload: any) {
    return {
      id: payload.sub,
      email: payload.email,
      rol: payload.rol,
    };
  }
}
