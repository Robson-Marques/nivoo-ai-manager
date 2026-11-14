import { Injectable } from '@nestjs/common';
import { AcceptanceCriterion, Job, Prisma } from '@prisma/client';
import * as fs from 'node:fs';
import { sha256, sha256File } from '../common/hash';
import { minimalEnv, runProcess } from '../common/exec';
import { resolveInside } from '../common/path-guard';
import { BlockedReason } from '../common/status';
import { PrismaService } from '../prisma/prisma.service';
import { evaluatePolicy } from '../security/policy';
import { ArtifactStoreService } from '../storage/artifact-store.service';
import { WorkspaceService } from '../storage/workspace.service';
import { LogService } from './log.service';
import { OrchestratorService } from './orchestrator.service';

export interface CriterionResult {
  key: string;
  kind: string;
  passed: boolean;
  pendingApproval?: boolean;
  evidence: Record<string, unknown>;
}

export interface EvaluationReport {
  jobId: string;
  finalStatus: string;
  pendingSteps: string[];
  criteria: CriterionResult[];
  pendencias: string[];
}

export function criterionHash(c: Pick<AcceptanceCriterion, 'kind' | 'description' | 'config'>): string {
  return sha256(JSON.stringify([c.kind, c.description, c.config ?? {}]));
}

const OPS: Record<string, (a: number, b: number) => boolean> = {
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
};

function getPath(obj: any, p: string): unknown {
  return p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/**
 * Único componente que pode marcar um job como CONCLUIDO.
 * Verifica critérios com evidências gravadas; critérios subjetivos exigem aprovação explícita.
 */
@Injectable()
export class CompletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly artifacts: ArtifactStoreService,
    private readonly workspace: WorkspaceService,
    private readonly logs: LogService,
  ) {}

  async evaluate(jobId: string): Promise<EvaluationReport> {
    const job = await this.prisma.job.findUniqueOrThrow({
      where: { id: jobId },
      include: { steps: true, criteria: true, project: true },
    });
    const report: EvaluationReport = { jobId, finalStatus: job.status, pendingSteps: [], criteria: [], pendencias: [] };
    if (!['EXECUTANDO', 'AGUARDANDO_APROVACAO', 'AGUARDANDO_RECURSO'].includes(job.status)) {
      report.pendencias.push(`job em ${job.status}; avaliação ignorada`);
      return report;
    }
    report.pendingSteps = job.steps.filter((s) => s.status !== 'CONCLUIDO').map((s) => `${s.key} (${s.status})`);
    if (report.pendingSteps.length > 0) {
      report.pendencias.push(...report.pendingSteps.map((s) => `etapa pendente: ${s}`));
      await this.logs.log(jobId, `Avaliação adiada: etapas pendentes ${report.pendingSteps.join(', ')}`, { source: 'evaluator' });
      return report;
    }

    const worktree = await this.workspace.ensureJobWorktree(job.project.dirKey, job.id);
    let status: 'CONCLUIDO' | 'AGUARDANDO_APROVACAO' | 'BLOQUEADO' = 'BLOQUEADO';
    let reason: string | null = null;
    let completion: Awaited<ReturnType<CompletionService['prepareCompletion']>> | null = null;
    let mergedCommit: string | null = null;
    // Os critérios são verificados sobre o resultado JÁ INTEGRADO à pasta principal do projeto; só então
    // a pasta principal avança. Se outro job mudou a pasta principal no meio, integra e verifica de novo.
    for (let rodada = 1; ; rodada++) {
      const sync = await this.workspace.syncWithMain(worktree, `job ${job.id}: integra a pasta principal do projeto`);
      if (!sync.ok) return this.blockConflict(job, report, sync.files);
      report.criteria = [];
      report.pendencias = [];
      for (const c of job.criteria) {
        const r = await this.check(job, c, worktree);
        report.criteria.push(r);
        const ev = await this.artifacts.storeContent(
          { projectId: job.projectId, jobId, name: `criterios/${c.key}.evidencia.json`, kind: 'CRITERION_EVIDENCE' },
          JSON.stringify({ criterio: c.key, tipo: c.kind, aprovado: r.passed, aguardandoAprovacao: !!r.pendingApproval, evidencia: r.evidence, verificadoEm: new Date().toISOString() }, null, 2),
        );
        await this.prisma.criterionCheck.create({
          data: { jobId, criterionId: c.id, passed: r.passed, evidence: r.evidence as Prisma.InputJsonValue, artifactId: ev.id },
        });
        await this.prisma.acceptanceCriterion.update({
          where: { id: c.id },
          data: { status: r.passed ? 'APROVADO' : r.pendingApproval ? 'AGUARDANDO_APROVACAO' : 'REPROVADO', lastCheckedAt: new Date() },
        });
      }

      const failed = report.criteria.filter((c) => !c.passed && !c.pendingApproval);
      const waiting = report.criteria.filter((c) => c.pendingApproval);
      reason = null;
      if (job.criteria.length === 0) {
        status = 'BLOQUEADO';
        reason = BlockedReason.SEM_CRITERIOS;
        report.pendencias.push('job sem critérios de aceitação verificáveis: conclusão não permitida');
      } else if (failed.length > 0) {
        status = 'BLOQUEADO';
        reason = BlockedReason.CRITERIOS_NAO_ATENDIDOS;
        report.pendencias.push(...failed.map((f) => `critério não atendido: ${f.key} — ${JSON.stringify(f.evidence).slice(0, 300)}`));
      } else if (waiting.length > 0) {
        status = 'AGUARDANDO_APROVACAO';
        report.pendencias.push(...waiting.map((w) => `aguardando aprovação explícita: ${w.key}`));
      } else {
        status = 'CONCLUIDO';
      }
      if (status !== 'CONCLUIDO') break;

      // Resultados reproduzíveis preparados ANTES e gravados na MESMA transação da conclusão.
      completion = await this.prepareCompletion(job, worktree);
      const ff = await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${'incorporar:' + job.projectId}))) AS l`;
          return this.workspace.fastForwardMain(job.project.dirKey, job.id);
        },
        { timeout: 120_000, maxWait: 120_000 },
      );
      if (ff.ok) {
        mergedCommit = ff.commit;
        break;
      }
      if (rodada >= 3) return this.blockConflict(job, report, ['a pasta principal mudou repetidamente durante a verificação; retome o job']);
      await this.logs.log(jobId, 'A pasta principal do projeto mudou durante a verificação: integrando de novo e reverificando os critérios', { source: 'evaluator', level: 'WARN' });
    }

    const detail = report.pendencias.length ? report.pendencias.join('\n') : 'todos os critérios verificados com evidências; resultado incorporado à pasta principal do projeto';
    const updated = await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, jobId);
      const r = await tx.job.updateMany({
        where: { id: jobId, status: { in: ['EXECUTANDO', 'AGUARDANDO_APROVACAO', 'AGUARDANDO_RECURSO'] } },
        data: {
          status,
          blockedReason: reason,
          statusDetail: detail,
          finishedAt: status === 'CONCLUIDO' ? new Date() : null,
          ...(status === 'CONCLUIDO' ? { mergeStatus: 'INCORPORADO', mergedCommit } : {}),
        },
      });
      if (r.count && completion && status === 'CONCLUIDO') {
        if (completion.experiment) await tx.experiment.update(completion.experiment);
        await tx.memoryEntry.create(completion.memory);
      }
      return r.count;
    });
    report.finalStatus = updated ? status : (await this.prisma.job.findUniqueOrThrow({ where: { id: jobId } })).status;
    await this.logs.log(jobId, `Avaliação de conclusão: ${report.finalStatus}. ${detail}`, {
      source: 'evaluator',
      level: status === 'CONCLUIDO' ? 'INFO' : 'WARN',
    });
    return report;
  }

  /** Conflito ao integrar com a pasta principal: o job NÃO é dado como concluído; pendência registrada. */
  private async blockConflict(job: Job & { title: string }, report: EvaluationReport, files: string[]): Promise<EvaluationReport> {
    const detail = `conflito ao integrar com a pasta principal do projeto: ${files.join(', ')}`;
    const r = await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, job.id);
      return tx.job.updateMany({
        where: { id: job.id, status: { in: ['EXECUTANDO', 'AGUARDANDO_APROVACAO', 'AGUARDANDO_RECURSO'] } },
        data: { status: 'BLOQUEADO', blockedReason: BlockedReason.CONFLITO_INCORPORACAO, statusDetail: detail, mergeStatus: 'CONFLITO' },
      });
    });
    if (r.count) {
      await this.prisma.memoryEntry.create({
        data: {
          projectId: job.projectId,
          researchId: job.researchId,
          category: 'PENDENCIA',
          title: `Resultado do job "${job.title}" não incorporado (conflito)`,
          content: `${detail}. O trabalho continua na branch job/${job.id}. Resolva os arquivos em conflito e retome o job.`,
          references: { jobId: job.id, origem: 'conflito-incorporacao', arquivos: files },
          author: 'sistema:verificador',
        },
      });
    }
    await this.logs.log(job.id, `Job BLOQUEADO (CONFLITO_INCORPORACAO): ${detail}`, { source: 'evaluator', level: 'ERROR' });
    report.finalStatus = 'BLOQUEADO';
    report.pendencias = [detail];
    return report;
  }

  private async check(job: Job, c: AcceptanceCriterion, worktree: string): Promise<CriterionResult> {
    const cfg = (c.config ?? {}) as Record<string, any>;
    const base = { key: c.key, kind: c.kind };
    try {
      switch (c.kind) {
        case 'COMMAND': {
          const cmd = String(cfg.command ?? '');
          const pol = evaluatePolicy(cmd);
          if (!pol.allowed) return { ...base, passed: false, evidence: { erro: 'comando bloqueado pela política', motivos: pol.reasons } };
          const r = await runProcess('bash', ['-e', '-o', 'pipefail', '-c', cmd], {
            cwd: worktree,
            env: minimalEnv({
              NIVOO_JOB_ID: job.id,
              NIVOO_OUTPUT_DIR: `${worktree}/out`,
              // Verificadores do operador podem ficar no diretório de dados do projeto (fora do alcance do agente).
              NIVOO_DATA_DIR: this.workspace.projectDirs((job as any).project.dirKey).data,
            }),
            timeoutMs: (cfg.timeoutSec ?? 300) * 1000,
          });
          const expected = cfg.expectExitCode ?? 0;
          return {
            ...base,
            passed: r.exitCode === expected && !r.timedOut,
            evidence: { comando: cmd, exitCode: r.exitCode, esperado: expected, timeout: r.timedOut, stdout: r.stdout.slice(-4000), stderr: r.stderr.slice(-2000) },
          };
        }
        case 'FILE_EXISTS': {
          const p = resolveInside(worktree, String(cfg.path));
          if (!fs.existsSync(p)) return { ...base, passed: false, evidence: { caminho: cfg.path, existe: false } };
          const st = fs.statSync(p);
          const minBytes = cfg.minBytes ?? 1;
          return {
            ...base,
            passed: st.isFile() && st.size >= minBytes,
            evidence: { caminho: cfg.path, existe: true, bytes: st.size, minBytes, sha256: st.isFile() ? await sha256File(p) : null },
          };
        }
        case 'ARTIFACT_PRESENT': {
          const all = await this.prisma.artifact.findMany({ where: { jobId: job.id, projectId: job.projectId }, orderBy: { createdAt: 'desc' } });
          const re = cfg.pattern ? new RegExp(String(cfg.pattern)) : null;
          const match = all.find((a) => (re ? re.test(a.name) : a.name === cfg.name) && a.sizeBytes >= (cfg.minBytes ?? 1));
          return {
            ...base,
            passed: !!match,
            evidence: match
              ? { artefatoId: match.id, nome: match.name, sha256: match.sha256, bytes: match.sizeBytes }
              : { procurado: cfg.name ?? cfg.pattern, encontrado: false, artefatosDoJob: all.map((a) => a.name).slice(0, 50) },
          };
        }
        case 'METRIC_THRESHOLD': {
          const name = String(cfg.artifact ?? 'metrics.json');
          const art = await this.prisma.artifact.findFirst({ where: { jobId: job.id, projectId: job.projectId, name }, orderBy: { createdAt: 'desc' } });
          if (!art) return { ...base, passed: false, evidence: { erro: `artefato de métricas ${name} ausente` } };
          const { content } = await this.artifacts.read(job.projectId, art.id);
          const value = Number(getPath(JSON.parse(content.toString('utf8')), String(cfg.path)));
          const op = OPS[String(cfg.op ?? '>=')];
          if (!op || Number.isNaN(value)) return { ...base, passed: false, evidence: { erro: 'métrica inválida ou operador desconhecido', valor: value, op: cfg.op } };
          return {
            ...base,
            passed: op(value, Number(cfg.value)),
            evidence: { artefatoId: art.id, sha256: art.sha256, metrica: cfg.path, valor: value, op: cfg.op ?? '>=', limite: cfg.value },
          };
        }
        case 'MANUAL_APPROVAL': {
          const hash = criterionHash(c);
          // Só conta a decisão sobre o conteúdo atual do critério.
          const approvals = await this.prisma.approval.findMany({
            where: { jobId: job.id, subjectId: c.id, kind: 'CRITERIO_SUBJETIVO', subjectHash: hash },
            orderBy: { requestedAt: 'desc' },
          });
          const latest = approvals[0];
          if (latest?.status === 'APROVADO') {
            return { ...base, passed: true, evidence: { aprovacaoId: latest.id, aprovadoPor: latest.decidedBy, em: latest.decidedAt, motivo: latest.reason } };
          }
          if (latest?.status === 'REJEITADO') {
            return { ...base, passed: false, evidence: { aprovacaoId: latest.id, rejeitadoPor: latest.decidedBy, motivo: latest.reason } };
          }
          const pending =
            latest ??
            (await this.prisma.approval.create({
              data: { jobId: job.id, projectId: job.projectId, kind: 'CRITERIO_SUBJETIVO', subjectId: c.id, subjectHash: hash, description: `Critério subjetivo: ${c.description}` },
            }));
          return { ...base, passed: false, pendingApproval: true, evidence: { aprovacaoId: pending.id, status: 'PENDENTE' } };
        }
      }
    } catch (e: any) {
      return { ...base, passed: false, evidence: { erro: String(e?.message ?? e) } };
    }
    return { ...base, passed: false, evidence: { erro: 'tipo de critério desconhecido' } };
  }

  /** Vincula resultados reproduzíveis ao experimento e registra evidência na memória do projeto. */
  /** Vincula resultados reproduzíveis ao experimento e prepara a evidência para a memória do projeto. */
  private async prepareCompletion(job: Job, worktree: string): Promise<{
    experiment: Prisma.ExperimentUpdateArgs | null;
    memory: Prisma.MemoryEntryCreateArgs;
  }> {
    const commit = await this.workspace.commitCheckpoint(worktree, `job ${job.id}: concluído (critérios verificados)`);
    const artifacts = await this.prisma.artifact.findMany({ where: { jobId: job.id, kind: { in: ['FILE', 'METRICS', 'REPORT'] } } });
    const exp = await this.prisma.experiment.findUnique({ where: { jobId: job.id } });
    let metrics: unknown = null;
    const metricsArt = artifacts.filter((a) => a.name === 'metrics.json').sort((a, b) => +b.createdAt - +a.createdAt)[0];
    if (metricsArt) {
      try {
        metrics = JSON.parse((await this.artifacts.read(job.projectId, metricsArt.id)).content.toString('utf8'));
      } catch {
        metrics = null;
      }
    }
    return {
      experiment: exp
        ? {
            where: { id: exp.id },
            data: {
              status: 'CONCLUIDO',
              codeRef: commit,
              metrics: (metrics ?? undefined) as Prisma.InputJsonValue | undefined,
              metricsArtifactId: metricsArt?.id ?? null,
            },
          }
        : null,
      memory: {
        data: {
          projectId: job.projectId,
          researchId: job.researchId,
          category: 'EVIDENCIA',
          title: `Evidência do job "${job.title}"`,
          content: `Job concluído pelo verificador do backend. Commit ${commit}. Artefatos: ${artifacts.map((a) => `${a.name} (${a.sha256.slice(0, 12)})`).join(', ') || 'nenhum'}.`,
          references: {
            jobId: job.id,
            gitCommit: commit,
            artifactIds: artifacts.map((a) => a.id),
            experimentIds: exp ? [exp.id] : [],
            datasetIds: exp?.datasetId ? [exp.datasetId] : [],
            parameters: (exp?.parameters ?? {}) as Prisma.InputJsonValue,
          },
          author: 'sistema:verificador',
        },
      },
    };
  }
}
