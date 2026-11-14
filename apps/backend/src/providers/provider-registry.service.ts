import { Injectable, NotFoundException } from '@nestjs/common';
import { appConfig } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { ClaudeCodeCliProvider } from './claude-code-cli.provider';
import { CodexCliProvider } from './codex-cli.provider';
import { GeminiCliProvider } from './gemini-cli.provider';
import { LocalShellProvider } from './local-shell.provider';
import { AiProvider, ProviderStatus } from './provider.interface';

@Injectable()
export class ProviderRegistry {
  private readonly providers = new Map<string, AiProvider>();
  private readonly cache = new Map<string, { at: number; status: ProviderStatus }>();

  constructor(
    private readonly prisma: PrismaService,
    claude: ClaudeCodeCliProvider,
    codex: CodexCliProvider,
    gemini: GeminiCliProvider,
    shell: LocalShellProvider,
  ) {
    for (const p of [claude, codex, gemini, shell]) this.providers.set(p.id, p);
  }

  /** Usado apenas pelos testes (NIVOO_ENABLE_TEST_PROVIDER=1). */
  registerTestProvider(p: AiProvider): void {
    if (!appConfig().enableTestProvider) throw new Error('Provedor de teste não habilitado');
    if (p.kind !== 'test') throw new Error('Somente provedores kind=test podem ser registrados dinamicamente');
    this.providers.set(p.id, p);
    this.cache.delete(p.id);
  }

  ids(): string[] {
    return [...this.providers.keys()];
  }

  get(id: string): AiProvider {
    const p = this.providers.get(id);
    if (!p) throw new NotFoundException(`Conector desconhecido: ${id}`);
    return p;
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  async status(id: string, maxAgeMs = 60000): Promise<ProviderStatus> {
    const hit = this.cache.get(id);
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
    if (cfg && !cfg.enabled) {
      status = { ...status, available: false, errors: [...status.errors, 'desabilitado nas configurações'] };
    }
    this.cache.set(id, { at: Date.now(), status });
    return status;
  }

  async statusAll(maxAgeMs = 60000): Promise<ProviderStatus[]> {
    return Promise.all(this.ids().map((id) => this.status(id, maxAgeMs)));
  }

  invalidate(id?: string): void {
    if (id) this.cache.delete(id);
    else this.cache.clear();
  }
}
