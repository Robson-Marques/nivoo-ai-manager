import * as fs from 'node:fs';
import * as path from 'node:path';

export interface VisualPreview {
  key: string;
  title: string;
  file: string;
  updatedAt: number;
}

/** Somente aprovações que explicitamente exigem prévias visuais. */
export function isVisualApproval(description: string): boolean {
  return /pr[eé]vias?|quadros? (?:visuais?|para aprova[cç][aã]o)/i.test(description);
}

export function requiredPreviewCount(description: string): number {
  if (/\b(duas|dois|2)\s+pr[eé]vias?/i.test(description)) return 2;
  const n = /\b(\d+)\s+pr[eé]vias?/i.exec(description);
  return n ? Math.max(1, Math.min(20, Number(n[1]))) : 1;
}

/** Retorna apenas quadros oficiais realmente produzidos, não nomes sugeridos pela IA. */
export function visualPreviews(worktree: string, steps: Array<{ key: string; title: string; instructions: string; provider: string | null; status: string }>): VisualPreview[] {
  const root = path.resolve(worktree);
  const result: VisualPreview[] = [];
  for (const step of steps) {
    if (step.provider !== 'local-shell' || step.status !== 'CONCLUIDO') continue;
    const match = /\bnivoo-conferir-arte\s+motion\/[A-Za-z0-9._/-]+\s+--saida\s+(out\/qualidade\/[A-Za-z0-9_-]+)/.exec(step.instructions);
    if (!match || match[1].split('/').includes('..')) continue;
    const file = path.resolve(root, match[1], 'quadro.png');
    if (!file.startsWith(root + path.sep)) continue;
    try {
      const stat = fs.statSync(file);
      if (stat.isFile() && stat.size > 0) result.push({ key: step.key, title: step.title, file, updatedAt: stat.mtimeMs });
    } catch { /* arquivo ainda não entregue: não é prévia válida */ }
  }
  return result;
}
