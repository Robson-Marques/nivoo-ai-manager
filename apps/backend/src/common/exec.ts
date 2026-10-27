import { spawn } from 'node:child_process';

export interface RunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
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
  const maxBuffer = opts.maxBuffer ?? 5 * 1024 * 1024;
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    let settled = false;
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });

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
    child.stdout.on('data', (c: string) => {
      if (stdout.length < maxBuffer) stdout += c;
      opts.onStdout?.(c);
    });
    child.stderr.on('data', (c: string) => {
      if (stderr.length < maxBuffer) stderr += c;
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
