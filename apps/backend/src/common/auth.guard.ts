import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

/** Token opcional (NIVOO_API_TOKEN). Instância única, sem multi-tenant. */
@Injectable()
export class ApiTokenGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const expected = process.env.NIVOO_API_TOKEN;
    if (!expected) return true;
    const req = ctx.switchToHttp().getRequest();
    if (req.path === '/api/health') return true;
    const header: string = req.headers['authorization'] ?? '';
    const given = header.startsWith('Bearer ') ? header.slice(7) : String(req.query?.token ?? '');
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException('Token de API inválido');
    return true;
  }
}
