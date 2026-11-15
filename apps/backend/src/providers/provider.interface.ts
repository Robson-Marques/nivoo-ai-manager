export type ProviderKind = 'cli' | 'api' | 'executor' | 'test';

export interface ProviderStatus {
  id: string;
  label: string;
  kind: ProviderKind;
  /** Pode executar tarefas agora neste host. */
  available: boolean;
  installed: boolean;
  /** true/false quando verificável; 'desconhecido' quando o CLI não expõe status. */
  authenticated: boolean | 'desconhecido';
  version?: string;
  /** Limites conhecidos (documentados ou configurados); nunca contornados. */
  limits: Record<string, string | number>;
  capabilities: string[];
  errors: string[];
  checkedAt: string;
  isAi: boolean;
}

export interface ExecutionRequest {
  jobId: string;
  stepId: string;
  attemptId: string;
  /** Prompt (IA) ou comando (local-shell). */
  instructions: string;
  /** Contexto reconstruído do banco (objetivo, critérios, checkpoint, decisões). */
  context: string;
  cwd: string;
  outputDir: string;
  /**
   * Perfil do projeto (regras da base + regras do projeto + conhecimento). Vai como instrução de sistema
   * quando o executor permite (Claude) e, em todo caso, no topo do prompt.
   */
  systemPrompt?: string;
  timeoutMs: number;
  signal: AbortSignal;
  onLog: (line: string, level?: 'INFO' | 'WARN' | 'ERROR') => void;
  /** Informado quando o processo do agente inicia (pid do grupo). */
  onSpawn?: (pid: number) => void;
  /** Opções por etapa (não secretas): modelo e limite de turnos da sessão. */
  /** images: arquivos de imagem anexados (para IAs que recebem imagem pela linha de comando). */
  /** Etapa de vídeo: arquivo, duracaoSeg, proporcao, resolucao, negativo, imagem, conexao. */
  options?: { model?: string; maxTurns?: number; images?: string[]; [k: string]: unknown };
}

export interface ExecutionResult {
  /** 0 = sucesso operacional da tentativa (não significa job concluído). */
  exitCode: number;
  output: string;
  error?: string;
  /** Recurso indisponível (limite de uso, autenticação ausente, rede): reagendar. */
  resourceUnavailable?: boolean;
  interrupted?: boolean;
  costUsd?: number;
  /** true quando o provedor não informou o custo (timeout/interrupção) e ele foi estimado pelos tokens. */
  costEstimated?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  /**
   * A sessão do agente terminou por limite da própria sessão (ex.: turnos), sem erro.
   * Não é falha nem conclusão: o trabalho continua em uma nova sessão.
   */
  sessionEnded?: boolean;
  sessionId?: string;
  stopReason?: string;
  numTurns?: number;
}

export interface AiProvider {
  readonly id: string;
  readonly label: string;
  readonly kind: ProviderKind;
  checkAvailability(): Promise<ProviderStatus>;
  execute(req: ExecutionRequest): Promise<ExecutionResult>;
}

export function buildPrompt(req: Pick<ExecutionRequest, 'context' | 'instructions'>): string {
  return `${req.context}\n\n## Tarefa desta etapa\n${req.instructions}\n`;
}

const RESOURCE_PATTERNS = /(usage limit|limit reached|rate.?limit|quota|\b429\b|overloaded|\b529\b|insufficient_quota|credit balance|not logged in|please run .*login|authentication_error|invalid api key|api key not valid|api_key_invalid|resource_exhausted|unauthorized|\b401\b|\bENOTFOUND\b|\bECONNREFUSED\b|\bETIMEDOUT\b|\bECONNRESET\b)/i;

export function looksLikeResourceProblem(text: string): boolean {
  return RESOURCE_PATTERNS.test(text);
}
