import type { SkillObservation } from '../specialties/skill-evidence';
import type { McpResolvido } from '../mcp/mcp';
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
  /** Exact eligible agent IDs reported by the connection; absence means unknown, not empty. */
  agentModels?:string[];
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
  /** Pasta de mídia durável do projeto (<projeto>/midia), fora do git: vídeos enviados e vídeos editados. */
  projectMediaDir?: string;
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
  /** Adapter observations only; not model claims or log parsing. */
  onSkillRead?: (event:SkillObservation)=>void;
  /** Opções por etapa (não secretas): modelo e limite de turnos da sessão. */
  /** images: arquivos de imagem anexados (para IAs que recebem imagem pela linha de comando). */
  /** Etapa de vídeo: arquivo, duracaoSeg, proporcao, resolucao, negativo, imagem, conexao. */
  options?: { model?: string; maxTurns?: number; images?: string[]; [k: string]: unknown };
  /** Ferramentas MCP liberadas para o projeto (já com os segredos; nunca vão para o texto da IA). */
  mcp?: McpResolvido[];
}

export interface ExecutionResult {
  /** 0 = sucesso operacional da tentativa (não significa job concluído). */
  exitCode: number;
  output: string;
  error?: string;
  /** Structured failure emitted by the local connector, not inferred from model text. */
  connectorFailure?:{kind:'spawn'|'connector-exception'|'sandbox';detail:string};
  /** Recurso indisponível (limite de uso, autenticação ausente, rede): reagendar. */
  resourceUnavailable?: boolean;
  /** Tempo mínimo de espera indicado pelo provedor (ex.: Retry-After no HTTP 429). */
  retryAfterMs?: number;
  interrupted?: boolean;
  costUsd?: number;
  /** true quando o provedor não informou o custo (timeout/interrupção) e ele foi estimado pelos tokens. */
  costEstimated?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
  /** True only when the provider input count explicitly excludes cached tokens. */
  inputExcludesCache?: boolean;
  usagePartial?: boolean;
  /**
   * A sessão do agente terminou por limite da própria sessão (ex.: turnos), sem erro.
   * Não é falha nem conclusão: o trabalho continua em uma nova sessão.
   */
  sessionEnded?: boolean;
  sessionId?: string;
  /** Set only by the dedicated CLI transport after native event validation. */
  reviewIsolation?: 'cli-inline-v1';
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

/** Profile is carried once: in the system channel when supported, otherwise
 * in the prompt. The exact original text remains in the audit artifact. */
export function buildPrompt(req: Pick<ExecutionRequest,'context'|'instructions'|'systemPrompt'>,profileInSystem=false):string{
  const profile=req.systemPrompt??'';
  let context=req.context,instructions=req.instructions;
  function hasBlock(text:string):number{
    if(!profile)return -1;
    let pos=text.indexOf(profile);
    while(pos>=0){
      if((pos===0||text[pos-1]==='\n')&&(pos+profile.length===text.length||text[pos+profile.length]==='\n'))return pos;
      pos=text.indexOf(profile,pos+profile.length);
    }
    return -1;
  }
  const c=hasBlock(context),i=hasBlock(instructions);
  const remove=(text:string,pos:number)=>text.slice(0,pos)+'[Perfil integral do projeto recebido no canal de sistema.]'+text.slice(pos+profile.length);
  if(profileInSystem&&profile){
    if(c>=0)context=remove(context,c);
    else if(i>=0)instructions=remove(instructions,i);
  }else if(profile&&c<0&&i<0){
    context=[profile,context].filter(Boolean).join('\n\n');
  }
  return `${context}\n\n## Tarefa desta etapa\n${instructions}\n`;
}

const RESOURCE_PATTERNS = /(usage limit|limit reached|hit your [\w -]*limit|\d+[- ]hour limit|weekly limit|session limit|limit · resets|limit will reset|rate.?limit|quota|\b429\b|overloaded|\b529\b|\b503\b|service ?unavailable|high demand|insufficient_quota|credit balance|not logged in|please run .*login|authentication_error|invalid api key|api key not valid|api_key_invalid|resource_exhausted|unauthorized|\b401\b|\bENOTFOUND\b|\bECONNREFUSED\b|\bETIMEDOUT\b|\bECONNRESET\b)/i;

export function looksLikeResourceProblem(text: string): boolean {
  return RESOURCE_PATTERNS.test(text);
}
