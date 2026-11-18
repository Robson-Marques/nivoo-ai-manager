import { Body, Controller, Get, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { acessoCloudflareConfigurado } from '../common/cf-access';
import { conferirCredenciais, emitirSessao, loginConfigurado } from '../common/login';

/** Tentativas de login erradas por IP, para travar força bruta (memória; some ao reiniciar). */
const tentativas = new Map<string, { n: number; ate: number }>();

@Controller('login')
export class AuthController {
  /** A tela pergunta o que o servidor oferece de entrada (público; não exige estar logado). */
  @Get('status')
  status() {
    return { loginDisponivel: loginConfigurado(), cloudflare: acessoCloudflareConfigurado() };
  }

  /** Entra com usuário e senha; devolve o crachá de sessão que a tela guarda. */
  @Post()
  entrar(@Body() body: { usuario?: string; senha?: string }, @Req() req: Request) {
    if (!loginConfigurado()) throw new UnauthorizedException('Login por senha não está ligado neste servidor.');
    const ip = (req.headers['x-forwarded-for']?.toString().split(',')[0] || req.ip || 'desconhecido').trim();
    const t = tentativas.get(ip);
    if (t && t.n >= 8 && Date.now() < t.ate) throw new UnauthorizedException('Muitas tentativas. Espere um minuto e tente de novo.');
    if (!conferirCredenciais(body?.usuario, body?.senha)) {
      const atual = t && Date.now() < t.ate ? t.n + 1 : 1;
      tentativas.set(ip, { n: atual, ate: Date.now() + 60_000 });
      throw new UnauthorizedException('Usuário ou senha incorretos.');
    }
    tentativas.delete(ip);
    return { token: emitirSessao() };
  }
}
