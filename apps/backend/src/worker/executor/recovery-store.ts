import { Prisma,type Job,type Step } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sha256 } from '../../common/hash';
import { BlockedReason } from '../../common/status';
import { looksLikeResourceProblem } from '../../providers/provider.interface';
import { OrchestratorService } from '../../jobs/orchestrator.service';
import { escreverArquivosDaMemoria } from '../../memory/camadas';
import type { PrismaService } from '../../prisma/prisma.service';
import type { WorkspaceService } from '../../storage/workspace.service';
import type { LogService } from '../../jobs/log.service';

/** Erros que não são do trabalho da IA: não geram lição. */
export function ehProblemaDeInfra(texto: string): boolean {
  return /command not found|comando não encontrado|exit 127|timeout após \d+ ms|limite de \d+ sess|recusou o login|não está conectada/i.test(texto) || looksLikeResourceProblem(texto);
}

const MOTIVO_LICAO: Record<string, string> = {
  REPETICAO_IMPRODUTIVA: 'a IA ficou repetindo sem avançar',
  LIMITE_TENTATIVAS: 'esgotou as tentativas',
  LIMITE_SESSOES: 'esgotou as sessões',
  POLITICA: 'bloqueado por segurança',
};

  /**
   * Lição de falha (versão determinística e auditável do "aprendizado contínuo"): o que foi tentado e
   * por que não funcionou fica na memória DO PROJETO, com referência às tentativas, e entra com alta
   * prioridade no contexto de sessões futuras do mesmo projeto — nunca de outros projetos.
   */
export async function recordLesson(prisma:PrismaService,job: Job, step: Step, reason: string, detail: string): Promise<void> {
    const teaches: string[] = [BlockedReason.REPETICAO_IMPRODUTIVA, BlockedReason.LIMITE_TENTATIVAS, BlockedReason.LIMITE_SESSOES, BlockedReason.POLITICA];
    if (!teaches.includes(reason)) return; // limites de tempo/orçamento e interrupções não dizem nada sobre a abordagem
    const recent = await prisma.attempt.findMany({ where: { stepId: step.id }, orderBy: { number: 'desc' }, take: 3 });
    // Problema de infraestrutura (programa faltando, IA sem crédito/login, limite do próprio sistema) não diz
    // nada sobre o jeito de fazer: não vira lição.
    if (ehProblemaDeInfra(`${detail} ${recent.map((a) => `${a.error ?? ''} ${(a.output ?? '').slice(-500)}`).join(' ')}`)) return;
    // Uma lição por etapa e motivo (não uma por tentativa).
    const ja = await prisma.memoryEntry.findFirst({
      where: { projectId: job.projectId, supersededById: null, AND: [{ references: { path: ['origem'], equals: 'licao-automatica' } }, { references: { path: ['stepId'], equals: step.id } }, { references: { path: ['motivo'], equals: reason } }] },
    });
    if (ja) return;
    const tried = recent
      .reverse()
      .map((a) => `#${a.number} ${a.status}${a.stopReason ? ` (${a.stopReason})` : ''}: ${(a.error ?? '').slice(0, 300)}${a.output ? ` — saída: ${a.output.trim().slice(-200)}` : ''}`)
      .join(' | ');
    await prisma.memoryEntry.create({
      data: {
        camada: 'INTERNA',
        projectId: job.projectId,
        category: 'PENDENCIA',
        title: `Lição: "${step.title || step.key}" (${job.title}) — ${MOTIVO_LICAO[reason] ?? reason}`,
        content: `O que aconteceu: ${detail}.\nInstruções da etapa: ${step.instructions.slice(0, 400)}\nTentativas: ${tried || 'nenhuma'}\nNão repita esta abordagem sem mudar algo essencial.`,
        references: { origem: 'licao-automatica', jobId: job.id, stepId: step.id, motivo: reason, attemptIds: recent.map((a) => a.id) },
        author: 'sistema:licoes',
      },
    }).catch(() => undefined);
  }

  /**
   * Notas estruturadas deixadas pelo agente em .nivoo/notas.jsonl (uma por linha):
   * {"tipo": "DECISAO_PROPOSTA|EVIDENCIA|PENDENCIA|PROGRESSO", "titulo": "...", "conteudo": "...", "arquivos": ["out/x"]}
   * São versionadas no git do job e importadas para a memória do projeto. Decisões do agente
   * entram como PENDENCIA (proposta) — só o operador aprova decisões.
   */
export async function ingestNotes(prisma:PrismaService,workspace:WorkspaceService,logs:LogService,job: Job, step: Step, attemptId: string, worktree: string, providerId: string, sessionId: string | undefined, outputs: { id: string; name: string }[]): Promise<number> {
    const file = path.join(worktree, '.nivoo', 'notas.jsonl');
    if (!fs.existsSync(file)) return 0;
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
    // Deduplicação por hash do conteúdo: robusta mesmo se o agente reescrever o arquivo inteiro.
    const known = await prisma.memoryEntry.findMany({
      where: { projectId: job.projectId, references: { path: ['jobId'], equals: job.id } },
      select: { references: true },
    });
    const seen = new Set(known.map((k) => (k.references as any)?.noteHash).filter(Boolean));
    const fresh = lines.filter(l=>{const hash=sha256(l.trim());if(seen.has(hash))return false;seen.add(hash);return true;});
    const commit = await workspace.headCommit(worktree);
    const author = `agente:${providerId}:sessao:${sessionId ?? attemptId}`;
    let count = 0;
    for (const line of fresh) {
      let n: any;
      try {
        n = JSON.parse(line);
        if(!n||typeof n!=='object'||Array.isArray(n))throw Error('nota deve ser objeto JSON');
      } catch {
        await logs.log(job.id, `Nota inválida ignorada (não é JSON): ${line.slice(0, 200)}`, { stepId: step.id, level: 'WARN', source: 'worker' });
        await prisma.memoryEntry.create({
          data: { camada: 'INTERNA', projectId: job.projectId, category: 'PENDENCIA', title: 'nota inválida do agente', content: line.slice(0, 2000), references: { jobId: job.id, attemptId, noteHash: sha256(line.trim()), origem: 'notas-do-agente' }, author },
        });
        continue;
      }
      count++;
      const tipo = String(n.tipo ?? '').toUpperCase();
      const titulo = String(n.titulo ?? tipo).slice(0, 200);
      const conteudo = String(n.conteudo ?? '').slice(0, 20000);
      const refsBase = { jobId: job.id, attemptId, sessionId: sessionId ?? null, origem: 'notas-do-agente', noteHash: sha256(line.trim()) };
      let category: 'EVIDENCIA' | 'PENDENCIA' = 'PENDENCIA';
      let references: Record<string, unknown> = refsBase;
      if (tipo === 'EVIDENCIA') {
        const wanted: string[] = Array.isArray(n.arquivos) ? n.arquivos.map((a: string) => String(a).replace(/^out\//, '')) : [];
        const arts = await prisma.artifact.findMany({ where: { jobId: job.id, name: { in: wanted } }, orderBy: { createdAt: 'desc' } });
        if (arts.length && commit) {
          category = 'EVIDENCIA';
          references = { ...refsBase, artifactIds: arts.map((a) => a.id), gitCommit: commit, parameters: {} };
        }
      }
      const prefix = tipo === 'DECISAO_PROPOSTA' ? '[decisão proposta pelo agente — requer aprovação] ' : tipo === 'PROGRESSO' ? '[progresso] ' : tipo === 'EVIDENCIA' && category !== 'EVIDENCIA' ? '[evidência sem artefato verificável] ' : '';
      await prisma.memoryEntry.create({
        data: { camada: 'INTERNA', projectId: job.projectId, category, title: titulo, content: prefix + conteudo, references: references as Prisma.InputJsonValue, author },
      });
    }
    if (fresh.length) await escreverArquivosDaMemoria(prisma, job.projectId);
    if (count) await logs.log(job.id, `${count} nota(s) do agente guardada(s) na memória interna do processo`, { stepId: step.id, source: 'worker' });
    void outputs;
    return count;
  }

export async function saveCheckpoint(prisma:PrismaService,workspace:WorkspaceService,jobId: string, step: Step, worktree: string, label: string, extra: Record<string, unknown>) {
    const commit = await workspace.commitCheckpoint(worktree, `checkpoint: ${label}`).catch(() => null);
    const steps = await prisma.step.findMany({ where: { jobId }, select: { key: true, status: true } });
    await prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, jobId);
      const seq = (await tx.checkpoint.count({ where: { jobId } })) + 1;
      await tx.checkpoint.create({
        data: {
          jobId,
          stepId: step.id,
          seq,
          label,
          gitCommit: commit,
          state: { etapa: step.key, etapas: Object.fromEntries(steps.map((s) => [s.key, s.status])), ...extra } as Prisma.InputJsonValue,
        },
      });
    });
    return commit;
  }

