import { assertStepLease } from './lease';
import type { ClaimedTask } from '../../queue/queue.service';
import { Prisma,type Job,type Step } from '@prisma/client';
import { readAgentNotes,parseAgentNotes } from './session-notes';
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
    const journal=readAgentNotes(worktree);
    if(journal.warning)await logs.log(job.id,journal.warning,{stepId:step.id,attemptId,level:'WARN',source:'worker'});
    if(!journal.text)return 0;
    const parsed=parseAgentNotes(journal.text);
    if(parsed.invalid)await logs.log(job.id,`Notas inválidas ignoradas: ${parsed.invalid}; conteúdo bruto não importado.`,{stepId:step.id,attemptId,level:'WARN',source:'worker'});
    // Deduplicação por hash do conteúdo: robusta mesmo se o agente reescrever o arquivo inteiro.
    const known = await prisma.memoryEntry.findMany({
      where: { projectId: job.projectId, references: { path: ['jobId'], equals: job.id } },
      select: { references: true },
    });
    const seen=new Set(known.flatMap(k=>{const r=k.references as {noteHash?:string;canonicalNoteHash?:string}|null;return [r?.noteHash,r?.canonicalNoteHash].filter((h):h is string=>typeof h==='string');}));
    const fresh=parsed.notes.filter(n=>{if(seen.has(n.hash)||seen.has(n.canonicalHash))return false;seen.add(n.hash);seen.add(n.canonicalHash);return true;});
    const commit = await workspace.headCommit(worktree);
    const author = `agente:${providerId}:sessao:${sessionId ?? attemptId}`;
    let count = 0;
    for (const n of fresh) {
      const {tipo,titulo,conteudo}=n;
      const refsBase = { jobId: job.id, stepId:step.id, attemptId, sessionId: sessionId ?? null, origem: 'notas-do-agente', noteHash:n.hash, canonicalNoteHash:n.canonicalHash,tipo };
      let category: 'EVIDENCIA' | 'PENDENCIA' = 'PENDENCIA';
      let references: Record<string, unknown> = refsBase;
      if (tipo === 'EVIDENCIA') {
        const wanted=n.arquivos;
        const arts = await prisma.artifact.findMany({ where: { projectId:job.projectId,jobId: job.id, name: { in: wanted } }, orderBy: { createdAt: 'desc' } });
        if (wanted.length && wanted.every(name=>arts.some(a=>a.name===name)) && commit) {
          category = 'EVIDENCIA';
          references = { ...refsBase, artifactIds: arts.map((a) => a.id), gitCommit: commit, parameters: {} };
        }
      }
      const prefix = tipo === 'DECISAO_PROPOSTA' ? '[decisão proposta pelo agente — requer aprovação] ' : tipo === 'PROGRESSO' ? '[progresso] ' : tipo === 'EVIDENCIA' && category !== 'EVIDENCIA' ? '[evidência sem artefato verificável] ' : '';
      await prisma.memoryEntry.create({
        data: { camada: 'INTERNA', projectId: job.projectId, category, title: titulo, content: prefix + conteudo, references: references as Prisma.InputJsonValue, author },
      });
      count++;
    }
    if (count) await escreverArquivosDaMemoria(prisma, job.projectId);
    if (count) await logs.log(job.id, `${count} nota(s) do agente guardada(s) na memória interna do processo`, { stepId: step.id, source: 'worker' });
    void outputs;
    return count;
  }

export async function saveCheckpoint(prisma:PrismaService,workspace:WorkspaceService,jobId: string, step: Step, worktree: string, label: string, extra: Record<string, unknown>,complete=false,lease?:{task:ClaimedTask;workerId:string}) {
    if(lease)await prisma.$transaction(tx=>assertStepLease(tx,lease.task,lease.workerId));
    let commit:string|null=null;
    let gitError:string|null=null;
    try {
      commit=await workspace.commitCheckpoint(worktree,`checkpoint: ${label}`);
      if(!commit)gitError='Git não confirmou HEAD';
    }catch(e){gitError=String((e as Error)?.message??e).slice(0,500);}

    await prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, jobId);
      if(lease)await assertStepLease(tx,lease.task,lease.workerId);
      if(complete&&commit){
        await tx.step.update({where:{id:step.id},data:{status:'CONCLUIDO',statusDetail:'resultado verificado; commit '+commit.slice(0,10)}});
      }
      const steps=await tx.step.findMany({where:{jobId},select:{key:true,status:true}});
      const seq = (await tx.checkpoint.count({ where: { jobId } })) + 1;
      await tx.checkpoint.create({
        data: {
          jobId,
          stepId: step.id,
          seq,
          label,
          gitCommit: commit,
          state: { ...extra, etapa: step.key, etapas: Object.fromEntries(steps.map((s) => [s.key, s.status])), gitPreservado:!!commit, ...(gitError?{gitError}: {}) } as Prisma.InputJsonValue,
        },
      });
    });
    return commit;
  }

