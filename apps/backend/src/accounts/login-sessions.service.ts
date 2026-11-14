import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { ChildProcess, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { minimalEnv } from '../common/exec';
import { GeminiCliProvider } from '../providers/gemini-cli.provider';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { ehAdicional, marcarFalhaLogin, tipoDe } from './connections';
import { gravarSegredoDaConexao, isolatedHome } from './secrets';

/**
 * Login pela tela, usando o fluxo OFICIAL de cada CLI (nada de cookies ou credenciais de navegador):
 *  - Claude: `claude setup-token` mostra um link; o usuário entra com a conta e cola o código na tela;
 *    o CLI devolve o token oficial, guardado como CLAUDE_CODE_OAUTH_TOKEN.
 *  - ChatGPT: `codex login --device-auth` mostra um link e um código para digitar no site da OpenAI.
 *  - Gemini: o próprio CLI mostra o link do Google; o usuário cola o código; o CLI grava a credencial.
 * Os CLIs exigem terminal: um pequeno ponte em Python abre um pseudo-terminal (pty) para eles.
 */

const PTY_BRIDGE = `
import fcntl, os, pty, select, signal, struct, sys, termios, time
pid, fd = pty.fork()
if pid == 0:
    os.execvp(sys.argv[1], sys.argv[1:])
# Terminal largo: links longos não são quebrados em várias linhas.
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 60, 1000, 0, 0))
signal.signal(signal.SIGTERM, lambda *a: (os.kill(pid, signal.SIGKILL), sys.exit(143)))
while True:
    r, _, _ = select.select([fd, sys.stdin], [], [], 0.5)
    if fd in r:
        try:
            d = os.read(fd, 4096)
        except OSError:
            break
        if not d:
            break
        sys.stdout.buffer.write(d); sys.stdout.flush()
    if sys.stdin in r:
        line = sys.stdin.readline()
        if line:
            # Texto e Enter separados: um texto longo de uma vez é tratado como "colar" e o Enter vai junto.
            os.write(fd, line.rstrip('\\n').encode())
            time.sleep(0.5)
            os.write(fd, b'\\r')
_, st = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(st))
`;

export type LoginState = 'iniciando' | 'aguardando_codigo' | 'aguardando_site' | 'conectado' | 'erro' | 'cancelado';

export interface LoginSession {
  provider: string;
  state: LoginState;
  /** Link para abrir no navegador. */
  url?: string;
  /** Código para digitar no site (ChatGPT). */
  userCode?: string;
  message: string;
  startedAt: string;
}

const TIMEOUT_MS = 15 * 60 * 1000;

function clean(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, ' ').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
}

@Injectable()
export class LoginSessionsService implements OnModuleDestroy {
  private readonly sessions = new Map<string, { info: LoginSession; child: ChildProcess; raw: string; output: string; timer: NodeJS.Timeout; marca?: number }>();

  constructor(private readonly registry: ProviderRegistry) {}

  onModuleDestroy(): void {
    for (const id of [...this.sessions.keys()]) this.cancel(id);
  }

  get(provider: string): LoginSession {
    const s = this.sessions.get(provider);
    if (!s) throw new NotFoundException('Nenhum login em andamento');
    if (s.info.state !== 'conectado' && this.connected(provider)) this.finish(provider, 'conectado', 'Conectado.');
    return s.info;
  }

  start(provider: string): LoginSession {
    const running = this.sessions.get(provider);
    if (running && ['iniciando', 'aguardando_codigo', 'aguardando_site'].includes(running.info.state)) return running.info;
    const cmd = this.command(provider);
    const child = spawn('python3', ['-c', PTY_BRIDGE, ...cmd.args], {
      cwd: cmd.cwd,
      env: minimalEnv({ TERM: 'xterm', NO_BROWSER: 'true', BROWSER: '/bin/false', COLUMNS: '400', LINES: '50', ...cmd.env }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const info: LoginSession = { provider, state: 'iniciando', message: 'Preparando o login…', startedAt: new Date().toISOString() };
    const timer = setTimeout(() => this.finish(provider, 'erro', 'O login expirou (15 minutos). Tente de novo.'), TIMEOUT_MS);
    const entry = { info, child, raw: '', output: '', timer };
    this.sessions.set(provider, entry);
    const onData = (d: Buffer) => {
      entry.raw = (entry.raw + d.toString('utf8')).slice(-100_000);
      // Links em hyperlink de terminal (OSC 8) vêm completos no parâmetro: preservados antes da limpeza.
      const links = [...entry.raw.matchAll(/\x1b\]8;[^;]*;(https:\/\/[^\x07\x1b]+)/g)].map((m) => m[1]);
      entry.output = `${[...new Set(links)].join(' ')}\n${clean(entry.raw)}`;
      this.react(provider);
    };
    child.stdout!.on('data', onData);
    child.stderr!.on('data', onData);
    child.on('exit', (code) => {
      if (!['iniciando', 'aguardando_codigo', 'aguardando_site'].includes(entry.info.state)) return;
      if (tipoDe(provider) === 'codex-cli' && code === 0) return this.finish(provider, 'conectado', 'ChatGPT conectado.');
      if (this.connected(provider)) return this.finish(provider, 'conectado', 'Conectado.');
      this.finish(provider, 'erro', `O login não foi concluído. ${entry.output.trim().split('\n').slice(-3).join(' ').slice(0, 300)}`);
    });
    return info;
  }

  /** Código colado pelo usuário (Claude e Gemini). */
  submitCode(provider: string, code: unknown): LoginSession {
    const s = this.sessions.get(provider);
    if (!s || s.info.state !== 'aguardando_codigo') throw new ConflictException('Este login não está esperando um código');
    const c = String(code ?? '').trim();
    if (!c || c.length > 2000 || /[\r\n]/.test(c)) throw new BadRequestException('Código inválido');
    s.child.stdin!.write(`${c}\n`);
    s.marca = s.raw.length;
    s.info = { ...s.info, state: 'iniciando', message: 'Conferindo o código…' };
    // Sem resposta do CLI em 90 s: não fica "conferindo" para sempre.
    setTimeout(() => {
      const atual = this.sessions.get(provider);
      if (atual === s && s.info.state === 'iniciando') {
        const ultima = clean(s.raw.slice(s.marca ?? 0)).replace(/\s+/g, ' ').trim().slice(-200);
        this.finish(provider, 'erro', `O login não respondeu ao código.${ultima ? ` Última mensagem: ${ultima}` : ''} Clique em Conectar e tente de novo.`);
      }
    }, 90_000).unref();
    return s.info;
  }

  cancel(provider: string): void {
    const s = this.sessions.get(provider);
    if (!s) return;
    if (['iniciando', 'aguardando_codigo', 'aguardando_site'].includes(s.info.state)) this.finish(provider, 'cancelado', 'Login cancelado.');
  }

  private command(provider: string): { args: string[]; cwd: string; env: Record<string, string> } {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nivoo-login-'));
    const tipo = tipoDe(provider);
    // Conexão adicional: o login fica na pasta própria dela, sem tocar nas outras contas do mesmo serviço.
    const propria = ehAdicional(provider) ? isolatedHome(provider) : null;
    if (tipo === 'claude-code-cli') return { args: [process.env.NIVOO_CLAUDE_BIN ?? 'claude', 'setup-token'], cwd: scratch, env: propria ? { CLAUDE_CONFIG_DIR: propria } : {} };
    if (tipo === 'codex-cli') return { args: [process.env.NIVOO_CODEX_BIN ?? 'codex', 'login', '--device-auth'], cwd: scratch, env: propria ? { CODEX_HOME: propria } : {} };
    if (tipo === 'gemini-cli') {
      // Login com conta Google (sem perguntar o método); o CLI grava a credencial no HOME da conexão.
      GeminiCliProvider.ensureUserSettings('oauth-personal', propria ?? undefined);
      return { args: [process.env.NIVOO_GEMINI_BIN ?? 'gemini'], cwd: scratch, env: propria ? { HOME: propria } : {} };
    }
    throw new BadRequestException('Esta IA não tem login pela tela');
  }

  private react(provider: string): void {
    const s = this.sessions.get(provider)!;
    const out = s.output;
    const tipo = tipoDe(provider);
    if (tipo === 'claude-code-cli') {
      const token = /(sk-ant-oat\d{2}-[A-Za-z0-9_-]{20,})/.exec(out.replace(/\s+/g, ''));
      if (token) {
        gravarSegredoDaConexao(ehAdicional(provider) ? provider : null, 'CLAUDE_CODE_OAUTH_TOKEN', token[1]);
        return this.finish(provider, 'conectado', 'Claude conectado.');
      }
      const url = /(https:\/\/claude\.(?:com|ai)\/[^\s'"<>\x07]*oauth\/authorize\?[^\s'"<>\x07]+)/.exec(out);
      if (url && s.info.state === 'iniciando' && !s.info.url) {
        s.info = { ...s.info, state: 'aguardando_codigo', url: url[1], message: 'Abra o link, entre com a sua conta do Claude e cole aqui o código que aparecer.' };
      }
      // Código recusado: o CLI pede para recomeçar; o link antigo não serve mais.
      if (s.marca !== undefined && /OAuth error|wasn't accepted|invalid|failed/i.test(clean(s.raw.slice(s.marca)))) {
        return this.finish(provider, 'erro', 'O código não foi aceito (pode ter expirado, vindo incompleto ou ser de outra tentativa). Clique em Conectar de novo, abra o link novo e cole o código que aparecer.');
      }
    } else if (tipo === 'codex-cli') {
      const url = /(https:\/\/auth\.openai\.com\/\S+)/.exec(out);
      const code = /\b([A-Z0-9]{4}-[A-Z0-9]{4,5})\b/.exec(out);
      if (url && code && !s.info.userCode) {
        s.info = {
          ...s.info,
          state: 'aguardando_site',
          url: url[1],
          userCode: code[1],
          message:
            'Abra o link, entre com a sua conta do ChatGPT e digite o código abaixo. Esta tela atualiza sozinha. ' +
            'Se o site disser para ativar o "login com código de dispositivo": em chatgpt.com abra Configurações → Segurança, ative essa opção e clique em Conectar de novo aqui.',
        };
      }
    } else if (tipo === 'gemini-cli') {
      if (this.connected(provider)) return this.finish(provider, 'conectado', 'Gemini conectado.');
      if (s.marca !== undefined && /invalid_grant|Failed to (?:authenticate|login)|Authentication failed/i.test(clean(s.raw.slice(s.marca)))) {
        return this.finish(provider, 'erro', 'O código não foi aceito pelo Google. Clique em Conectar de novo, abra o link novo e cole o código que aparecer.');
      }
      const url = /(https:\/\/accounts\.google\.com\/o\/oauth2\/\S+)/.exec(out);
      if (url && !s.info.url) {
        s.info = { ...s.info, state: 'aguardando_codigo', url: url[1], message: 'Abra o link, entre com a sua conta Google e cole aqui o código que aparecer.' };
      }
    }
  }

  private connected(provider: string): boolean {
    if (tipoDe(provider) !== 'gemini-cli') return false;
    return fs.existsSync(path.join(ehAdicional(provider) ? isolatedHome(provider) : (process.env.HOME ?? os.homedir()), '.gemini', 'oauth_creds.json'));
  }

  private finish(provider: string, state: LoginState, message: string): void {
    const s = this.sessions.get(provider);
    if (!s) return;
    clearTimeout(s.timer);
    s.info = { ...s.info, state, message };
    if (state === 'conectado') marcarFalhaLogin(provider, null);
    if (s.child.exitCode === null) s.child.kill('SIGTERM');
    this.registry.invalidate(provider);
  }
}
