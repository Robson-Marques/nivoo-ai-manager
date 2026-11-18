import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { acessoCloudflareConfigurado, acessoCloudflareValido } from './cf-access';
import { loginConfigurado, sessaoValida } from './login';

/**
 * Entrada protegida (instância única, sem multi-tenant). Formas de entrar, qualquer uma basta:
 *  - token de API fixo (NIVOO_API_TOKEN) — para scripts;
 *  - login por usuário e senha (NIVOO_LOGIN_USUARIO/SENHA) — a tela troca por um crachá de sessão assinado;
 *  - login da Cloudflare (Cloudflare Access).
 * Se NADA disso estiver configurado, fica aberto (só faz sentido em acesso local). As rotas de login e de saúde
 * são sempre públicas (senão não dava para logar nem checar o servidor).
 */
@Injectable()
export class ApiTokenGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    if (req.path === '/api/health' || req.path === '/api/login' || req.path === '/api/login/status') return true;
    const token = process.env.NIVOO_API_TOKEN;
    const temLogin = loginConfigurado();
    const temCf = acessoCloudflareConfigurado();
    if (!token && !temLogin && !temCf) return true; // sem nenhuma proteção: acesso local
    const header: string = req.headers['authorization'] ?? '';
    const given = header.startsWith('Bearer ') ? header.slice(7) : String(req.query?.token ?? '');
    if (token && igual(given, token)) return true;
    if (temLogin && sessaoValida(given)) return true;
    if (temCf && (await acessoCloudflareValido(req.headers['cf-access-jwt-assertion']))) return true;
    throw new UnauthorizedException('Entrada não autorizada');
  }
}

function igual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
