import { BadRequestException, Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import { minimalEnv, runProcess } from '../common/exec';
import { GeminiCliProvider } from '../providers/gemini-cli.provider';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { LoginSession, LoginSessionsService } from './login-sessions.service';
import { SecretKey, secretSource, setSecret } from './secrets';

/** As IAs que trabalham nos projetos, em linguagem simples. */
export const ACCOUNTS = [
  { id: 'claude-code-cli', nome: 'Claude', conta: 'conta do Claude (Pro/Max)', chave: 'ANTHROPIC_API_KEY' as SecretKey, ondeChave: 'console.anthropic.com' },
  { id: 'codex-cli', nome: 'ChatGPT', conta: 'conta do ChatGPT (Plus/Pro)', chave: null, ondeChave: 'platform.openai.com' },
  { id: 'gemini-cli', nome: 'Gemini', conta: 'conta Google (Gemini)', chave: 'GEMINI_API_KEY' as SecretKey, ondeChave: 'aistudio.google.com' },
] as const;

@Injectable()
export class AccountsService {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly logins: LoginSessionsService,
  ) {}

  private account(id: string) {
    const a = ACCOUNTS.find((x) => x.id === id);
    if (!a) throw new BadRequestException('IA desconhecida');
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
          nome: a.nome,
          conta: a.conta,
          ondeChave: a.ondeChave,
          instalado: st.installed,
          conectado: st.available,
          desabilitado: st.errors.some((e) => e.includes('desabilitado')),
          configuradoPeloAdministrador: (a.id === 'claude-code-cli' && secretSource('CLAUDE_CODE_OAUTH_TOKEN') === 'ambiente') || (!!a.chave && secretSource(a.chave) === 'ambiente'),
          problema: st.available ? null : st.errors.join('; ') || null,
          login,
        };
      }),
    );
  }

  startLogin(id: string) {
    this.account(id);
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

  /** Alternativa ao login com a conta: chave de API (cobrança à parte, pelo provedor). */
  async saveKey(id: string, key: unknown) {
    const a = this.account(id);
    const k = String(key ?? '').trim();
    if (k.length < 20 || k.length > 500 || /\s/.test(k)) throw new BadRequestException('Chave inválida');
    if (a.id === 'codex-cli') {
      const r = await runProcess(process.env.NIVOO_CODEX_BIN ?? 'codex', ['login', '--with-api-key'], { cwd: process.cwd(), env: minimalEnv(), input: `${k}\n`, timeoutMs: 30_000 });
      if (r.exitCode !== 0) throw new BadRequestException(`O ChatGPT recusou a chave: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
    } else {
      setSecret(a.chave!, k);
    }
    this.registry.invalidate(id);
    return this.registry.status(id, 0);
  }

  async disconnect(id: string) {
    const a = this.account(id);
    this.logins.cancel(id);
    if (a.id === 'claude-code-cli') {
      setSecret('CLAUDE_CODE_OAUTH_TOKEN', null);
      setSecret('ANTHROPIC_API_KEY', null);
      await runProcess(process.env.NIVOO_CLAUDE_BIN ?? 'claude', ['auth', 'logout'], { cwd: process.cwd(), env: minimalEnv(), timeoutMs: 30_000 });
    } else if (a.id === 'codex-cli') {
      await runProcess(process.env.NIVOO_CODEX_BIN ?? 'codex', ['logout'], { cwd: process.cwd(), env: minimalEnv(), timeoutMs: 30_000 });
    } else {
      setSecret('GEMINI_API_KEY', null);
      fs.rmSync(GeminiCliProvider.oauthFile(), { force: true });
    }
    this.registry.invalidate(id);
    return this.registry.status(id, 0);
  }
}
