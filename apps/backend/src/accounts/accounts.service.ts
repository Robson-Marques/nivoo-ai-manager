import { BadRequestException, Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import { minimalEnv, runProcess } from '../common/exec';
import { GeminiCliProvider } from '../providers/gemini-cli.provider';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { LoginSession, LoginSessionsService } from './login-sessions.service';
import { SecretKey, secretSource, setSecret } from './secrets';

/**
 * As IAs que trabalham nos projetos, cada uma de dois jeitos que podem estar conectados ao mesmo tempo:
 * pela conta (assinatura) e por chave de API (cobrança por uso). O projeto escolhe qual usa.
 */
export const ACCOUNTS = [
  { id: 'claude-code-cli', ia: 'Claude', tipo: 'conta', conta: 'conta do Claude (Pro/Max)' },
  { id: 'claude-api', ia: 'Claude', tipo: 'api', chave: 'ANTHROPIC_API_KEY' as SecretKey, ondeChave: 'console.anthropic.com' },
  { id: 'codex-cli', ia: 'ChatGPT', tipo: 'conta', conta: 'conta do ChatGPT (Plus/Pro)' },
  { id: 'codex-api', ia: 'ChatGPT', tipo: 'api', ondeChave: 'platform.openai.com' },
  { id: 'gemini-cli', ia: 'Gemini', tipo: 'conta', conta: 'conta Google (Gemini)' },
  { id: 'gemini-api', ia: 'Gemini', tipo: 'api', chave: 'GEMINI_API_KEY' as SecretKey, ondeChave: 'aistudio.google.com' },
] as const;

type Account = (typeof ACCOUNTS)[number];

@Injectable()
export class AccountsService {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly logins: LoginSessionsService,
  ) {}

  private account(id: string, tipo?: 'conta' | 'api'): Account {
    const a = ACCOUNTS.find((x) => x.id === id);
    if (!a) throw new BadRequestException('IA desconhecida');
    if (tipo && a.tipo !== tipo) throw new BadRequestException(tipo === 'api' ? 'Esta opção conecta pela conta, não por chave' : 'Esta opção conecta por chave de API');
    return a;
  }

  async list() {
    return Promise.all(
      ACCOUNTS.map(async (a) => {
        const st = await this.registry.status(a.id, 5_000);
        let login: LoginSession | null = null;
        try {
          login = this.logins.get(a.id);
        } catch {
          login = null;
        }
        return {
          id: a.id,
          ia: a.ia,
          tipo: a.tipo,
          nome: `${a.ia} (${a.tipo === 'conta' ? 'conta' : 'API'})`,
          conta: 'conta' in a ? a.conta : null,
          ondeChave: 'ondeChave' in a ? a.ondeChave : null,
          instalado: st.installed,
          conectado: st.available,
          desabilitado: st.errors.some((e) => e.includes('desabilitado')),
          configuradoPeloAdministrador: (a.id === 'claude-code-cli' && secretSource('CLAUDE_CODE_OAUTH_TOKEN') === 'ambiente') || ('chave' in a && secretSource(a.chave) === 'ambiente'),
          problema: st.available ? null : st.errors.join('; ') || null,
          login,
        };
      }),
    );
  }

  startLogin(id: string) {
    this.account(id, 'conta');
    return this.logins.start(id);
  }

  loginStatus(id: string) {
    return this.logins.get(id);
  }

  submitCode(id: string, code: unknown) {
    return this.logins.submitCode(id, code);
  }

  cancelLogin(id: string) {
    this.logins.cancel(id);
    return { ok: true };
  }

  /** Chave de API (cobrança por uso, pelo provedor). Convive com o login da conta da mesma IA. */
  async saveKey(id: string, key: unknown) {
    const a = this.account(id, 'api');
    const k = String(key ?? '').trim();
    if (k.length < 20 || k.length > 500 || /\s/.test(k)) throw new BadRequestException('Chave inválida');
    if (a.id === 'codex-api') {
      // Registrada pelo comando oficial, na pasta própria da variante API (não mexe no login da conta).
      const env = (this.registry.get('codex-api') as unknown as { env(): NodeJS.ProcessEnv }).env();
      const r = await runProcess(process.env.NIVOO_CODEX_BIN ?? 'codex', ['login', '--with-api-key'], { cwd: process.cwd(), env, input: `${k}\n`, timeoutMs: 30_000 });
      if (r.exitCode !== 0) throw new BadRequestException(`O ChatGPT recusou a chave: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
    } else if ('chave' in a) {
      setSecret(a.chave, k);
    }
    this.registry.invalidate(id);
    return this.registry.status(id, 0);
  }

  async disconnect(id: string) {
    const a = this.account(id);
    this.logins.cancel(id);
    if (a.id === 'claude-code-cli') {
      setSecret('CLAUDE_CODE_OAUTH_TOKEN', null);
      await runProcess(process.env.NIVOO_CLAUDE_BIN ?? 'claude', ['auth', 'logout'], { cwd: process.cwd(), env: minimalEnv(), timeoutMs: 30_000 });
    } else if (a.id === 'codex-cli' || a.id === 'codex-api') {
      const env = (this.registry.get(a.id) as unknown as { env(): NodeJS.ProcessEnv }).env();
      await runProcess(process.env.NIVOO_CODEX_BIN ?? 'codex', ['logout'], { cwd: process.cwd(), env, timeoutMs: 30_000 });
    } else if (a.id === 'gemini-cli') {
      fs.rmSync(GeminiCliProvider.oauthFile(), { force: true });
    } else if ('chave' in a) {
      setSecret(a.chave, null);
    }
    this.registry.invalidate(id);
    return this.registry.status(id, 0);
  }
}
