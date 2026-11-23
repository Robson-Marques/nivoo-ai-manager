import { tipoDe } from '../accounts/connections';
import { BadRequestException, Injectable } from '@nestjs/common';
import { runProcess } from '../common/exec';
import { GeminiVideoProvider } from './gemini-video.provider';
import { NvidiaApiProvider } from './nvidia-api.provider';
import { catalogarNvidiaModelos, modelosNvidiaParaWorkflow, NVIDIA_AREAS } from './nvidia-model-catalog';
import { ProviderRegistry } from './provider-registry.service';

export interface ModelOption {
  id: string;
  nome: string;
  categoria?: string;
  descricao?: string;
}

/** Nome de modelo aceito (aliases como "opus" ou ids completos como "gpt-6.1-sol"). */
export function checkModelName(model: unknown): string {
  const m = String(model ?? '').trim();
  if (!/^[A-Za-z0-9._:\/[\]-]{1,150}$/.test(m)) throw new BadRequestException('Nome de modelo inválido');
  return m;
}

/** Claude Code não lista modelos: aliases (sempre a versão mais recente) e nomes completos conhecidos. */
const CLAUDE: ModelOption[] = [
  { id: 'fable', nome: 'Fable (mais recente)' },
  { id: 'opus', nome: 'Opus (mais recente)' },
  { id: 'sonnet', nome: 'Sonnet (mais recente)' },
  { id: 'claude-haiku-5-5', nome: 'Haiku 5.5' },
];

const CACHE_MS = 60 * 60 * 1000;

/**
 * Modelos de cada IA, lidos do próprio programa oficial sempre que ele informa (Codex: catálogo;
 * Gemini: --list-models), para que modelos novos apareçam sem mudar o sistema. Cache de 1 hora.
 */
@Injectable()
export class ModelCatalogService {
  private readonly cache = new Map<string, { at: number; opcoes: ModelOption[] }>();

  constructor(private readonly registry: ProviderRegistry) {}

  async list(providerId: string): Promise<{ opcoes: ModelOption[]; aviso?: string }> {
    if (!this.registry.has(providerId)) throw new BadRequestException('IA desconhecida');
    if (providerId === 'gemini-video') {
      // Modelos Veo que a chave do Gemini pode usar (lista do próprio Google).
      return (this.registry.get(providerId) as GeminiVideoProvider).modelosParaEscolher();
    }
    if (providerId.startsWith('claude')) return { opcoes: CLAUDE };
    if (tipoDe(providerId) === 'nvidia-api') {
      const hit = this.cache.get(providerId);
      if (hit && Date.now() - hit.at < CACHE_MS) return {
        opcoes: hit.opcoes,
        aviso: 'Somente agentes de programação listados pela API desta conexão. Estar listado não garante permissão de execução.',
      };
      try {
        const modelos = await (this.registry.get(providerId) as NvidiaApiProvider).modelos();
        const ids = new Set(modelos.map(m => m.id));
        const opcoes = modelosNvidiaParaWorkflow(modelos.map(m => m.id)).filter(m => ids.has(m.id));
        this.cache.set(providerId, { at: Date.now(), opcoes });
        return { opcoes, aviso: 'Somente agentes de programação que aparecem na API desta conexão. Disponibilidade real confirmada apenas na execução.' };
      } catch (e: any) {
        return {
          opcoes: [],
          aviso: 'Não foi possível consultar modelos na conta NVIDIA. Nenhum modelo será indicado como disponível sem verificação: ' + String(e?.message ?? e).slice(0, 100),
        };
      }
    }
    if (!tipoDe(providerId)) return { opcoes: [] }; // executores do sistema (arquivos, comandos) não têm modelo
    const hit = this.cache.get(providerId);
    if (hit && Date.now() - hit.at < CACHE_MS) return { opcoes: hit.opcoes };
    const env = (this.registry.get(providerId) as unknown as { env(): NodeJS.ProcessEnv }).env();
    try {
      const opcoes = providerId.startsWith('codex') ? await this.codex(env) : await this.gemini(env);
      if (opcoes.length) this.cache.set(providerId, { at: Date.now(), opcoes });
      return { opcoes };
    } catch (e: any) {
      return { opcoes: [], aviso: `Não foi possível ler a lista de modelos (${String(e?.message ?? e).slice(0, 200)}). Use "Outro…" e digite o nome.` };
    }
  }

  /** Visão completa das áreas, incluindo serviços que NÃO são Chat Completions. */
  async catalogoNvidia(providerId: string) {
    if (tipoDe(providerId) !== 'nvidia-api' || !this.registry.has(providerId)) {
      throw new BadRequestException('O catálogo por especialidade é exclusivo das conexões NVIDIA');
    }
    let ids: string[] = [];
    let aviso: string | null = null;
    try {
      ids = (await (this.registry.get(providerId) as NvidiaApiProvider).modelos()).map((m) => m.id);
    } catch (e: any) {
      aviso = 'Não foi possível consultar os IDs liberados nesta conta: ' + String(e?.message ?? e).slice(0, 180);
    }
    return {
      modelos: catalogarNvidiaModelos(ids),
      areas: NVIDIA_AREAS,
      verificadoNaConta: aviso === null,
      aviso,
      origem: 'Catálogo de referência NVIDIA Build + IDs retornados pela API da conexão',
      observacao: 'O catálogo público contém endpoints de especialidades e modelos somente para download; GET /v1/models não confirma disponibilidade/cotas de todos. Uso direto pelo Studio Workflow somente com chat e ferramentas documentados.',
    };
  }

  /** `codex debug models`: catálogo do Codex (só os visíveis, na ordem de prioridade dele). */
  private async codex(env: NodeJS.ProcessEnv): Promise<ModelOption[]> {
    const r = await runProcess(process.env.NIVOO_CODEX_BIN ?? 'codex', ['debug', 'models'], { cwd: process.cwd(), env, timeoutMs: 30_000, maxBuffer: 20 * 1024 * 1024 });
    if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `saída ${r.exitCode}`);
    const modelos: any[] = JSON.parse(r.stdout).models ?? [];
    return modelos
      .filter((m) => m.slug && m.visibility !== 'hide')
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
      .map((m) => ({ id: String(m.slug), nome: String(m.display_name ?? m.slug) }));
  }

  /** `gemini --list-models`: linhas "id (Nome)". */
  private async gemini(env: NodeJS.ProcessEnv): Promise<ModelOption[]> {
    const r = await runProcess(process.env.NIVOO_GEMINI_BIN ?? 'gemini', ['--list-models'], { cwd: process.cwd(), env, timeoutMs: 45_000 });
    if (r.exitCode !== 0) throw new Error(r.stderr.trim().slice(-300) || `saída ${r.exitCode}`);
    const opcoes: ModelOption[] = [];
    for (const linha of r.stdout.split('\n')) {
      const m = /^([a-z0-9][a-z0-9.\-]*) \((.+)\)\s*$/i.exec(linha.trim());
      if (m) opcoes.push({ id: m[1], nome: m[1] === 'auto' ? 'Automático (o Gemini escolhe)' : m[2] });
    }
    return opcoes;
  }
}
