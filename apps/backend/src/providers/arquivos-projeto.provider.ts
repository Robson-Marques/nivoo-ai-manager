import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveInside } from '../common/path-guard';
import { AiProvider, ExecutionRequest, ExecutionResult, ProviderStatus } from './provider.interface';

/**
 * Apagar e mover arquivos do projeto como etapa do SISTEMA (as IAs editam arquivos, mas o Claude, por
 * exemplo, não tem terminal e não consegue apagar). A lista vem do plano aprovado no "Fazer" e tudo fica no
 * histórico do git (commit do trabalho; no GitHub/GitLab, se ligado) — dá para voltar qualquer arquivo.
 * Nunca mexe em .git, contexto/, .nivoo/ ou fora da pasta do trabalho.
 */
const PROTEGIDOS = /^(\.git|contexto|\.nivoo)(\/|$)/;

export function descreverOperacoes(o: { remover?: string[]; mover?: Array<{ de: string; para: string }> }): string {
  const partes: string[] = [];
  if (o.remover?.length) partes.push(`apagar ${o.remover.length} item(ns): ${o.remover.slice(0, 30).join(', ')}${o.remover.length > 30 ? ` … e mais ${o.remover.length - 30}` : ''}`);
  if (o.mover?.length) partes.push(`mover ${o.mover.length}: ${o.mover.slice(0, 20).map((m) => `${m.de} → ${m.para}`).join(', ')}${o.mover.length > 20 ? ' …' : ''}`);
  return partes.join('; ');
}

@Injectable()
export class ArquivosProjetoProvider implements AiProvider {
  readonly id = 'arquivos-projeto';
  readonly label = 'Apagar/mover arquivos (sistema)';
  readonly kind = 'executor' as const;

  async checkAvailability(): Promise<ProviderStatus> {
    return {
      id: this.id, label: this.label, kind: this.kind, available: true, installed: true, authenticated: true,
      limits: {}, capabilities: ['apagar-arquivos', 'mover-arquivos'], errors: [], checkedAt: new Date().toISOString(), isAi: false,
    };
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    const o = (req.options ?? {}) as { remover?: string[]; mover?: Array<{ de: string; para: string }> };
    const feitos: string[] = [];
    const avisos: string[] = [];
    const alvo = (rel: string) => {
      const r = String(rel).replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
      if (!r || PROTEGIDOS.test(r)) throw new Error(`caminho protegido ou vazio: ${rel}`);
      return resolveInside(req.cwd, r);
    };
    try {
      for (const m of o.mover ?? []) {
        const de = alvo(m.de);
        const para = alvo(m.para);
        if (!fs.existsSync(de)) {
          avisos.push(`não existe (mover): ${m.de}`);
          continue;
        }
        if (fs.existsSync(para)) throw new Error(`destino já existe: ${m.para}`);
        fs.mkdirSync(path.dirname(para), { recursive: true });
        fs.renameSync(de, para);
        feitos.push(`movido: ${m.de} → ${m.para}`);
      }
      for (const rel of o.remover ?? []) {
        const a = alvo(rel);
        if (!fs.existsSync(a)) {
          avisos.push(`já não existia: ${rel}`);
          continue;
        }
        fs.rmSync(a, { recursive: true, force: true });
        feitos.push(`apagado: ${rel}`);
      }
    } catch (e: any) {
      return { exitCode: 1, output: feitos.join('\n'), error: String(e?.message ?? e) };
    }
    for (const l of [...feitos, ...avisos]) req.onLog(l);
    return { exitCode: 0, output: [...feitos, ...avisos].join('\n') || 'nada a fazer', stopReason: 'completed' };
  }
}
