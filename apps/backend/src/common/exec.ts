import * as net from 'node:net';
import * as path from 'node:path';
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
  /**
   * Quando o comando principal termina, encerra tudo o que ele deixou rodando (ex.: um servidor ligado em segundo
   * plano para conferir) e não espera esses processos soltarem a saída — senão a conferência ficava parada até o tempo
   * esgotar.
   */
  encerrarGrupoAoSair?: boolean;
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
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE', 'PLAYWRIGHT_BROWSERS_PATH',
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
  if(opts.signal?.aborted)return Promise.resolve({exitCode:null,stdout:'',stderr:'',timedOut:false,aborted:true,durationMs:0});
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
    if (opts.encerrarGrupoAoSair) {
      child.on('exit', (code) => {
        // Pequena folga para a saída que ainda está a caminho; depois desliga o que sobrou e termina.
        setTimeout(() => {
          try {
            if (child.pid) process.kill(-child.pid, 'SIGTERM');
          } catch {
            /* nada sobrou */
          }
          setTimeout(() => {
            try {
              if (child.pid) process.kill(-child.pid, 'SIGKILL');
            } catch {
              /* já terminou */
            }
            finish(code);
          }, 1500).unref();
        }, 300).unref();
      });
    }
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
/** Uma porta TCP livre agora, para a conferência ligar o sistema do projeto e conferir com curl. */
export function portaLivre(): Promise<number> {
  return new Promise((ok, falha) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', falha);
    srv.listen(0, '127.0.0.1', () => {
      const porta = (srv.address() as net.AddressInfo).port;
      srv.close(() => ok(porta));
    });
  });
}

export const TEXTO_SISTEMA_RODANDO = [
  '- VER O SISTEMA RODANDO (sem navegador): a conferência pode ligar o sistema numa porta livre, $NIVOO_PORTA_TESTE, esperar',
  '  responder e conferir com curl (página, API, /health). Ex.: PORT=$NIVOO_PORTA_TESTE npm start > out/servidor.log 2>&1 &',
  '  for i in $(seq 1 60); do curl -fsS http://127.0.0.1:$NIVOO_PORTA_TESTE/health >/dev/null && break; sleep 1; done;',
  '  curl -fsS http://127.0.0.1:$NIVOO_PORTA_TESTE/api/... | grep -q "esperado". O sistema desliga tudo que a conferência ligou.',
];

/** Ferramentas do Nivoo para as conferências (ex.: nivoo-fotos), postas no PATH delas. */
export const PASTA_FERRAMENTAS = path.resolve(__dirname, '..', '..', 'bin');

export const TEXTO_FOTOS = [
  '- FOTOS DAS TELAS (sem a IA navegar): com o sistema ligado, a conferência pode rodar',
  '  nivoo-fotos http://127.0.0.1:$NIVOO_PORTA_TESTE / /outra-tela --exigir-sem-erros',
  '  que tira foto de cada tela no computador e no celular (out/telas/*.png + relatorio.md) e FALHA se houver erro de script ou',
  '  no console, arquivo que não carrega, tela em branco ou página mais larga que o celular. Em site/sistema com tela, use nas',
  '  etapas que mexem no visual. Na sessão seguinte, a IA ABRE as fotos e corrige o que estiver feio, cortado ou desalinhado,',
  '  seguindo as regras de interface do modelo do projeto (contexto/base/; no Studio Workflow, a disciplina de interface).',
  '  --sem-emoji-em-controles também falha com emoji usado como botão/ícone (regra do Studio Workflow: emoji não é ícone de UI).',
];

/**
 * Padrão das telas (lente de interface do Studio Workflow: "não inventar um layout novo", seguir o componente/padrão
 * local; card solto ou vazio sem função; contexto já escolhido não se pede de novo). Vale para o plano e para a IA.
 */
export const TEXTO_PADRAO_DAS_TELAS = [
  '- TELAS NO PADRÃO DO SISTEMA: antes de criar ou mudar tela, aba, cartão, formulário ou menu, ACHE no projeto a tela',
  '  existente mais parecida (a irmã: mesma área, mesmas abas) e siga o MESMO padrão — mesmo componente de abas/cartões,',
  '  mesmas larguras, mesmo alinhamento, botão de ação no mesmo lugar, configuração onde as configurações equivalentes ficam',
  '  (uma aba de configuração, não um bloco solto em outra tela). Diga no plano qual tela existente é a referência. Não peça',
  '  de novo o que a navegação já escolheu (ex.: seletor de cliente dentro da tela do cliente) e mantenha título e caminho no',
  '  contexto. Cartão largo com conteúdo estreito, vazio sem função e botão solto no meio são defeitos.',
  '- Toda tela que o trabalho mudar precisa de FOTO na conferência, no computador e no celular: roteiro em nivoo-roteiros/',
  '  que entra (usuário de teste no banco de teste), navega até a tela e tira {"foto": "..."} com "tamanho": "ambos" — e',
  '  fotografa também a tela irmã de referência. Tela só depois do login não aparece em nivoo-previa.json "telas": use o roteiro.',
];

export const TEXTO_ROTEIRO = [
  '- INTERAÇÃO DAS TELAS (foco, digitação, Enter, carregando, erro recuperável, troca de sessão): escreva roteiros em',
  '  nivoo-roteiros/*.json ({"nome","tamanho":"computador|celular|ambos","passos":[{"ir":"/login"},{"digitar":"#email","valor":"a@b"},',
  '  {"tecla":"Enter"},{"esperarTexto":"Carregando"},{"esperarTexto":"Bem-vindo"},{"foto":"depois"}]}; também clicar, preencher,',
  '  esperar, sumir, semTexto, focoEm, valorDe/igual, recarregar, aguardar) e confira com o sistema ligado:',
  '  nivoo-roteiro http://127.0.0.1:$NIVOO_PORTA_TESTE nivoo-roteiros/*.json   — o sistema executa num navegador sem tela',
  '  ("digitar" confere que o campo não perde o foco nem o valor a cada letra), tira fotos (out/telas-interativas/) e FALHA',
  '  no passo que não acontecer. É a evidência de interação que a revisão e as regras de interface pedem.',
  '  Rede lenta ou com erro (resposta que chega DEPOIS da troca de sessão, envio que falha): {"atrasar":"/api/mensagens","ms":4000},',
  '  {"falharRede":"/api/anexos"} e {"liberarRede":true} (valem para os endereços que contêm o texto).',
  '- O que um roteiro .json não expressa (duas abas, mensagens chegando, troca de sessão no meio de um envio, fila de saída):',
  '  script em nivoo-roteiros/<nome>.cjs (ou .mjs) com o navegador sem tela — const { chromium } = require(process.env.NIVOO_PLAYWRIGHT)',
  '  (no .mjs: const { chromium } = await import(process.env.NIVOO_PLAYWRIGHT_MJS)), endereço em process.env.NIVOO_BASE_URL,',
  '  chromium.launch({ args: ["--no-sandbox"] }),',
  '  fotos em out/telas-interativas/; termina com código diferente de 0 se algo não acontecer. Script em OUTRA pasta não roda na',
  '  conferência e não vale como evidência.',
  '- MAIS SIMPLES: com nivoo-previa.json na raiz (e "telas": ["/", "/pedidos"] nele), uma linha na conferência faz tudo —',
  '  nivoo-conferir-telas  — liga o sistema como a prévia, tira as fotos (--exigir-sem-erros), roda nivoo-roteiros/*.json e os',
  '  scripts nivoo-roteiros/*.cjs|*.mjs, e desliga.',
  '  Ex.: "npm install && npm test && npm run build && nivoo-conferir-telas". Correções e respostas do usuário rodam isso sozinhas.',
];

export function ambienteDaConferencia(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const base = minimalEnv();
  return minimalEnv({
    PATH: `${PASTA_FERRAMENTAS}:${base.PATH ?? '/usr/local/bin:/usr/bin:/bin'}`,
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
/**
 * Instalação que falha por falta de CREDENCIAL num registro de pacotes privado (npm/yarn/pnpm 401/403, pip 401/403):
 * nenhuma sessão de IA resolve (o token é um segredo). Devolve o endereço/pacote, ou null.
 */
export function faltaCredencial(saida: string): string | null {
  const padroes = [
    /npm (?:error|ERR!) code E40[13][\s\S]*?(?:40[13][^\n]*)/i,
    /\b40[13]\b[^\n]*\b(?:Unauthorized|Forbidden)\b[^\n]*/i,
    /(?:Unauthorized|Forbidden|authentication|unauthenticated|403 Forbidden|401 Unauthorized)[^\n]*(?:registry|packages?\/npm|\.pkg\.|artifactory|nexus|gitlab|github\.com\/[^\n]*packages)[^\n]*/i,
    /ERR_PNPM_FETCH_40[13][^\n]*/i,
    /pip[^\n]*40[13][^\n]*(?:Unauthorized|Forbidden)/i,
  ];
  for (const p of padroes) {
    const m = p.exec(saida);
    if (m) return m[0].replace(/\s+/g, ' ').slice(0, 300);
  }
  return null;
}

/** Erro típico do `npm ci` quando o projeto não commitou o package-lock.json (ou pnpm/yarn em modo travado). */
export function semLockfile(saida: string): boolean {
  return /can only install with an existing package-lock\.json|npm-shrinkwrap\.json with lockfileVersion|No lockfile found|lockfile.*not found|frozen-lockfile|EUSAGE[\s\S]*npm ci/i.test(saida);
}

export function problemaDoAmbiente(saida: string): string | null {
  const padroes = [
    /Cannot find module '[^']*corepack[^']*'[^\n]*/i,
    /corepack[^\n]*(ENOENT|EACCES|EPERM|Error when performing the request)/i,
    /\bENOSPC\b[^\n]*/,
    /(EAI_AGAIN|ENOTFOUND|ECONNREFUSED|ETIMEDOUT)[^\n]*(registry|npmjs|yarnpkg|pypi)[^\n]*/i,
    /ERR_PNPM_META_FETCH_FAIL[^\n]*/,
    /nivoo-(fotos|roteiro): navegador sem tela[^\n]*/,
    /npm (ERR!|error) (network|code E(AI_AGAIN|NOTFOUND|CONNRESET))[^\n]*/i,
  ];
  for (const p of padroes) {
    const m = p.exec(saida);
    if (m) return m[0].slice(0, 300);
  }
  return null;
}
