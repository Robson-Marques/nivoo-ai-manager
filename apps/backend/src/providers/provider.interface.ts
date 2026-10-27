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
  dataDir: string;
  timeoutMs: number;
  signal: AbortSignal;
  onLog: (line: string, level?: 'INFO' | 'WARN' | 'ERROR') => void;
  /** Informado quando o processo do agente inicia (pid do grupo). */
  onSpawn?: (pid: number) => void;
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
  inputTokens?: number;
  outputTokens?: number;
}

export interface AiProvider {
  readonly id: string;
  readonly label: string;
  readonly kind: ProviderKind;
  checkAvailability(): Promise<ProviderStatus>;
  execute(req: ExecutionRequest): Promise<ExecutionResult>;
}

export function buildPrompt(req: ExecutionRequest): string {
  return `${req.context}\n\n## Tarefa desta etapa\n${req.instructions}\n`;
}

const RESOURCE_PATTERNS = /(usage limit|rate.?limit|quota|429|overloaded|529|insufficient_quota|credit balance|not logged in|please run .*login|authentication|unauthorized|401|ENOTFOUND|ECONNREFUSED|ETIMEDOUT)/i;

export function looksLikeResourceProblem(text: string): boolean {
  return RESOURCE_PATTERNS.test(text);
}
