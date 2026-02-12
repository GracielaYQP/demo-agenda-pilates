import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, Role } from './roles.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

 canActivate(context: ExecutionContext): boolean {
    // 1) Si la ruta es pública, no exigimos roles
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // 2) Leemos los roles requeridos (si no hay, dejamos pasar)
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    // 3) Validamos el usuario inyectado por JwtStrategy
    const { user } = context.switchToHttp().getRequest();
    const rol: Role | undefined = user?.rol;

    // (opcional) Permití que 'admin' pase cualquier endpoint con roles
    const hasAccess = !!rol && (rol === 'superadmin' || requiredRoles.includes(rol));

    if (!hasAccess) {
      throw new ForbiddenException('Acceso restringido: no tenés permisos para esta operación');
    }
    return true;
  }
}
