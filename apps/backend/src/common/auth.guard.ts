import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { acessoCloudflareValido } from './cf-access';

/**
 * Entrada protegida (instância única, sem multi-tenant). Sem NIVOO_API_TOKEN, aberto (só local). Com ele,
 * entra quem mandar o token OU quem já passou pelo login da Cloudflare (Access) configurado no servidor.
 */
@Injectable()
export class ApiTokenGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const expected = process.env.NIVOO_API_TOKEN;
    if (!expected) return true;
    const req = ctx.switchToHttp().getRequest();
    if (req.path === '/api/health') return true;
    const header: string = req.headers['authorization'] ?? '';
    const given = header.startsWith('Bearer ') ? header.slice(7) : String(req.query?.token ?? '');
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
    if (await acessoCloudflareValido(req.headers['cf-access-jwt-assertion'])) return true;
    throw new UnauthorizedException('Token de API inválido');
  }
}
