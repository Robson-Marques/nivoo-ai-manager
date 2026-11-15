import { spawn } from 'node:child_process';

export interface RunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  onSpawn?: (pid: number) => void;
  maxBuffer?: number;
}

export interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  spawnError?: string;
  durationMs: number;
}

const PASS_THROUGH = [
  'PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'TERM', 'USER', 'SHELL', 'TMPDIR',
  'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE',
];

/**
 * Ambiente mínimo para processos filhos: segredos do backend (DATABASE_URL,
 * chaves de API) nunca são repassados, exceto os explicitamente listados.
 */
export function minimalEnv(extra: Record<string, string | undefined> = {}, passKeys: string[] = []): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of [...PASS_THROUGH, ...passKeys]) {
    if (process.env[k] !== undefined) env[k] = process.env[k];
  }
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) env[k] = v;
  return env;
}

/** Executa um processo sem shell implícito; mata o grupo inteiro em timeout/abort. */
export function runProcess(cmd: string, args: string[], opts: RunOptions): Promise<RunResult> {
  const started = Date.now();
  const maxBuffer = opts.maxBuffer ?? 20 * 1024 * 1024;
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    let settled = false;
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    if (child.pid) opts.onSpawn?.(child.pid);

    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* já terminou */
      }
      setTimeout(() => {
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* já terminou */
        }
      }, 3000).unref();
    };

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          kill();
        }, opts.timeoutMs)
      : null;
    const onAbort = () => {
      aborted = true;
      kill();
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    // Passou do limite: guarda o FIM (é lá que ficam o resultado final da IA, o custo e o erro do teste).
    child.stdout.on('data', (c: string) => {
      stdout += c;
      if (stdout.length > maxBuffer * 1.25) stdout = stdout.slice(-maxBuffer);
      opts.onStdout?.(c);
    });
    child.stderr.on('data', (c: string) => {
      stderr += c;
      if (stderr.length > maxBuffer * 1.25) stderr = stderr.slice(-maxBuffer);
      opts.onStderr?.(c);
    });
    const finish = (exitCode: number | null, spawnError?: string) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({ exitCode, stdout, stderr, timedOut, aborted, spawnError, durationMs: Date.now() - started });
    };
    child.on('error', (err) => finish(null, err.message));
    child.on('close', (code) => finish(code));
    child.stdin.on('error', () => undefined);
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

/** Encerra um grupo de processos órfão (tentativa de um worker que caiu neste mesmo host). */
export function killProcessGroup(pid: number): boolean {
  try {
    process.kill(-pid, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

/**
 * Ambiente das conferências (testes, build, instalação de dependências dos projetos): sem perguntas interativas,
 * sem modo "watch" e sem trocar de gerenciador de pacotes no meio (pnpm 10 tenta baixar a versão do packageManager).
 */
export function ambienteDaConferencia(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return minimalEnv({
    CI: 'true',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    COREPACK_ENABLE_STRICT: '0',
    npm_config_manage_package_manager_versions: 'false',
    npm_config_yes: 'true',
    ...extra,
  });
}

/**
 * Falha da conferência que é do SERVIDOR do Nivoo, não do projeto: nenhuma sessão de IA resolve. Devolve a linha que
 * mostra o problema, ou null.
 */
export function problemaDoAmbiente(saida: string): string | null {
  const padroes = [
    /Cannot find module '[^']*corepack[^']*'[^\n]*/i,
    /corepack[^\n]*(ENOENT|EACCES|EPERM|Error when performing the request)/i,
    /\bENOSPC\b[^\n]*/,
    /(EAI_AGAIN|ENOTFOUND|ECONNREFUSED|ETIMEDOUT)[^\n]*(registry|npmjs|yarnpkg|pypi)[^\n]*/i,
    /ERR_PNPM_META_FETCH_FAIL[^\n]*/,
    /npm (ERR!|error) (network|code E(AI_AGAIN|NOTFOUND|CONNRESET))[^\n]*/i,
  ];
  for (const p of padroes) {
    const m = p.exec(saida);
    if (m) return m[0].slice(0, 300);
  }
  return null;
}
