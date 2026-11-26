import { Injectable, NotFoundException } from '@nestjs/common';
import { acharConexao, ehAdicional, ehFalhaDeLogin, listarConexoes, marcarFalhaLogin, tipoDe } from '../accounts/connections';
import { appConfig } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { ClaudeApiProvider, ClaudeCodeCliProvider } from './claude-code-cli.provider';
import { CodexApiProvider, CodexCliProvider } from './codex-cli.provider';
import { GeminiApiProvider } from './gemini-api.provider';
import { NvidiaApiProvider } from './nvidia-api.provider';
import { GroqFreeProvider, OpenRouterFreeProvider } from './free-cloud-api.provider';
import { GeminiImageProvider } from './gemini-image.provider';
import { GeminiVideoProvider } from './gemini-video.provider';
import { JuntarVideosProvider } from './juntar-videos.provider';
import { GerarNarracaoProvider } from './gerar-narracao.provider';
import { ArquivosProjetoProvider } from './arquivos-projeto.provider';
import { LocalShellProvider } from './local-shell.provider';
import { AiProvider, ProviderStatus, type ExecutionResult } from './provider.interface';
import { isTransientRateLimit,resourceRateLimitDelayMs } from './resource-rate-limit';

@Injectable()
export class ProviderRegistry {
  private readonly providers = new Map<string, AiProvider>();
  private readonly cache = new Map<string, { at: number; status: ProviderStatus }>();

  constructor(
    private readonly prisma: PrismaService,
    claude: ClaudeCodeCliProvider,
    codex: CodexCliProvider,
    claudeApi: ClaudeApiProvider,
    codexApi: CodexApiProvider,
    geminiApi: GeminiApiProvider,
    nvidiaApi: NvidiaApiProvider,
    openRouterFree: OpenRouterFreeProvider,
    groqFree: GroqFreeProvider,
    video: GeminiVideoProvider,
    image: GeminiImageProvider,
    juntar: JuntarVideosProvider,
    gerarNarracao: GerarNarracaoProvider,
    arquivos: ArquivosProjetoProvider,
    shell: LocalShellProvider,
  ) {
    for (const p of [claude, claudeApi, codex, codexApi, geminiApi, nvidiaApi, openRouterFree, groqFree, video, image, juntar, gerarNarracao, arquivos, shell]) this.providers.set(p.id, p);
  }

  /** Usado apenas pelos testes (NIVOO_ENABLE_TEST_PROVIDER=1). */
  registerTestProvider(p: AiProvider): void {
    if (!appConfig().enableTestProvider) throw new Error('Provedor de teste não habilitado');
    if (p.kind !== 'test') throw new Error('Somente provedores kind=test podem ser registrados dinamicamente');
    this.providers.set(p.id, p);
    this.cache.delete(p.id);
  }

  ids(): string[] {
    return [...this.providers.keys(), ...listarConexoes().filter((c) => ehAdicional(c.id)).map((c) => c.id)];
  }

  /**
   * Conector pelo id. Conexões adicionais (`<tipo>--<hex>`, ex.: a segunda conta do ChatGPT) são instâncias
   * do mesmo CLI com credenciais e pasta próprias. Nome visível = nome da conexão.
   */
  get(id: string): AiProvider {
    const p = this.providers.get(id);
    if (p) {
      const c = tipoDe(id) ? acharConexao(id) : undefined;
      return c ? Object.assign(Object.create(p), { label: c.nome }) : p;
    }
    if (ehAdicional(id)) {
      const c = acharConexao(id);
      const base = this.providers.get(tipoDe(id)!) as unknown as { paraConexao?(id: string, nome: string): AiProvider };
      if (c && base?.paraConexao) return base.paraConexao(id, c.nome);
    }
    throw new NotFoundException(`Conector desconhecido: ${id}`);
  }

  has(id: string): boolean {
    return this.providers.has(id) || (ehAdicional(id) && !!acharConexao(id));
  }

  async status(id: string, maxAgeMs = 60000): Promise<ProviderStatus> {
    const hit = this.cache.get(id);
    const cooldown=await this.prisma.providerCooldown.findUnique({where:{providerId:id}});
    const delay=cooldown?cooldown.until.getTime()-Date.now():0;
    if(delay>0){
      const p=this.get(id);
      const previous=hit?.status;
      return {...(previous??{id,label:p.label,kind:p.kind,installed:true,authenticated:'desconhecido' as const,limits:{},capabilities:[],errors:[],isAi:p.kind!=='executor'}),available:false,limits:{...(previous?.limits??{}),retryAfterMs:delay},errors:['HTTP 429: provedor em espera compartilhada até '+cooldown!.until.toISOString()],checkedAt:new Date().toISOString()};
    }
    if (hit && Date.now() - hit.at < maxAgeMs) return hit.status;
    const p = this.get(id);
    const cfg = await this.prisma.providerConfig.findUnique({ where: { id } });
    let status: ProviderStatus;
    try {
      status = await p.checkAvailability();
    } catch (e: any) {
      status = {
        id,
        label: p.label,
        kind: p.kind,
        available: false,
        installed: false,
        authenticated: false,
        limits: {},
        capabilities: [],
        errors: [String(e?.message ?? e)],
        checkedAt: new Date().toISOString(),
        isAi: p.kind !== 'executor',
      };
    }
    const falha = acharConexao(id)?.falhaLogin;
    if (falha && status.available) {
      status = { ...status, available: false, authenticated: false, errors: [...status.errors, `a IA recusou o login (${falha.mensagem}). Reconecte em Conexões`] };
    }
    if (cfg && !cfg.enabled) {
      status = { ...status, available: false, errors: [...status.errors, 'desabilitado nas configurações'] };
    }
    this.cache.set(id, { at: Date.now(), status });
    return status;
  }

  /** Only actual provider rate-limit receipts open the shared cooldown.
   * Cache/status reads never extend it and successful concurrent requests
   * cannot erase a later 429. No credential or provider output is stored. */
  async recordRateLimit(id:string,result:ExecutionResult):Promise<void>{
    if(result.interrupted||!result.resourceUnavailable||!isTransientRateLimit(result.error??''))return;
    const now=new Date();
    const previous=await this.prisma.providerCooldown.findUnique({where:{providerId:id}});
    const count=previous&&now.getTime()-previous.updatedAt.getTime()<24*60*60_000?previous.failures:0;
    const until=new Date(now.getTime()+resourceRateLimitDelayMs(count,result.retryAfterMs));
    await this.prisma.$executeRaw`
      INSERT INTO "ProviderCooldown" ("providerId","until","failures","updatedAt")
      VALUES (${id},${until},1,${now})
      ON CONFLICT ("providerId") DO UPDATE SET
        "until"=GREATEST("ProviderCooldown"."until",EXCLUDED."until"),
        "failures"=CASE WHEN "ProviderCooldown"."updatedAt" < ${new Date(now.getTime()-24*60*60_000)}
          THEN 1 ELSE LEAST("ProviderCooldown"."failures"+1,6) END,
        "updatedAt"=GREATEST("ProviderCooldown"."updatedAt",EXCLUDED."updatedAt")`;
    this.cache.delete(id);
  }

  async statusAll(maxAgeMs = 60000): Promise<ProviderStatus[]> {
    return Promise.all(this.ids().map((id) => this.status(id, maxAgeMs)));
  }

  /** Resultado de uma sessão real: login recusado marca a conexão; sucesso limpa a marca. */
  registrarResultado(id: string, ok: boolean, erro?: string | null): void {
    if (ok) marcarFalhaLogin(id, null);
    else if (ehFalhaDeLogin(erro)) marcarFalhaLogin(id, String(erro));
    else return;
    this.cache.delete(id);
  }

  invalidate(id?: string): void {
    if (id) this.cache.delete(id);
    else this.cache.clear();
  }
}
