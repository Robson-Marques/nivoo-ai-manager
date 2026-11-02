import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatasetRole, HypothesisStatus, Prisma } from '@prisma/client';
import * as fs from 'node:fs';
import { sha256File } from '../common/hash';
import { resolveInside } from '../common/path-guard';
import { oneOf, optString, reqString } from '../common/validate';
import { MemoryService } from '../memory/memory.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceService } from '../storage/workspace.service';
import { ASSET_DEFAULTS } from './asset-defaults';
import { validateOhlcvCsv } from './dataset-validator';

@Injectable()
export class MarketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
    private readonly memory: MemoryService,
  ) {}

  /** Garante WIN e WDO com configurações independentes (idempotente). */
  async ensureAssets(): Promise<void> {
    for (const a of ASSET_DEFAULTS) {
      await this.prisma.marketAsset.upsert({
        where: { code: a.code },
        update: {},
        create: { ...a, rules: a.rules as Prisma.InputJsonValue, validation: a.validation as unknown as Prisma.InputJsonValue },
      });
    }
  }

  listAssets() {
    return this.prisma.marketAsset.findMany({ orderBy: { code: 'asc' } });
  }

  async getAsset(code: string) {
    const a = await this.prisma.marketAsset.findUnique({ where: { code: code.toUpperCase() } });
    if (!a) throw new NotFoundException(`Ativo ${code} não cadastrado`);
    return a;
  }

  /** Atualiza somente o ativo indicado; configurações dos demais não são afetadas. */
  async updateAsset(code: string, body: any) {
    const a = await this.getAsset(code);
    const data: Prisma.MarketAssetUpdateInput = {};
    for (const k of ['name', 'priceUnit', 'sessionOpen', 'sessionClose', 'sessionTz'] as const) {
      const v = optString(body, k, 200);
      if (v) data[k] = v;
    }
    for (const k of ['tickSize', 'pointValue'] as const) {
      if (body?.[k] !== undefined) {
        const n = Number(body[k]);
        if (!(n > 0)) throw new BadRequestException(`${k} deve ser positivo`);
        data[k] = new Prisma.Decimal(n);
      }
    }
    if (body?.rules) data.rules = { ...(a.rules as object), ...body.rules };
    if (body?.validation) data.validation = { ...(a.validation as object), ...body.validation };
    return this.prisma.marketAsset.update({ where: { id: a.id }, data });
  }

  // ---------- Datasets ----------
  async createDataset(projectId: string, body: any) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    const asset = await this.getAsset(reqString(body, 'assetCode', 10));
    const uri = reqString(body, 'uri', 500);
    const dataDir = this.workspace.projectDirs(project.slug).data;
    const abs = resolveInside(dataDir, uri);
    const role = oneOf(body, 'role', ['TREINO', 'VALIDACAO', 'RESERVADO'] as const, 'TREINO') as DatasetRole;
    return this.prisma.dataset.create({
      data: {
        projectId,
        assetId: asset.id,
        name: reqString(body, 'name', 200),
        uri,
        sha256: fs.existsSync(abs) ? await sha256File(abs) : null,
        timeframe: optString(body, 'timeframe', 20) ?? '1min',
        periodStart: body.periodStart ? new Date(body.periodStart) : null,
        periodEnd: body.periodEnd ? new Date(body.periodEnd) : null,
        role,
        notes: optString(body, 'notes', 5000) ?? '',
      },
      include: { asset: { select: { code: true } } },
    });
  }

  listDatasets(projectId: string) {
    return this.prisma.dataset.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, include: { asset: { select: { code: true } } } });
  }

  async validateDataset(projectId: string, datasetId: string) {
    const ds = await this.prisma.dataset.findFirst({ where: { id: datasetId, projectId }, include: { asset: true, project: true } });
    if (!ds) throw new NotFoundException('Dataset não encontrado neste projeto');
    const abs = resolveInside(this.workspace.projectDirs(ds.project.slug).data, ds.uri);
    if (!fs.existsSync(abs)) throw new BadRequestException(`Arquivo ${ds.uri} não existe no diretório de dados do projeto`);
    const hash = await sha256File(abs);
    // O hash registrado é o que vale para experimentos e aprovações: a validação nunca o substitui em
    // silêncio. Arquivo diferente do registrado = dataset inválido (registre um novo dataset para a nova versão).
    const divergente = !!ds.sha256 && ds.sha256 !== hash;
    if (!ds.sha256) await this.prisma.dataset.update({ where: { id: ds.id }, data: { sha256: hash } });
    const report = await validateOhlcvCsv(abs, {
      code: ds.asset.code,
      tickSize: Number(ds.asset.tickSize),
      sessionOpen: ds.asset.sessionOpen,
      sessionClose: ds.asset.sessionClose,
      validation: ds.asset.validation as any,
    });
    if (divergente) {
      report.valid = false;
      report.errorCount += 1;
      report.errors.unshift({ line: 0, issue: `arquivo difere do registrado (registrado ${ds.sha256}, atual ${hash}); registre um novo dataset para usar esta versão` });
    }
    return { datasetId: ds.id, sha256Registrado: ds.sha256 ?? hash, sha256Atual: hash, integro: !divergente, ...report };
  }

  async requestRelease(projectId: string, datasetId: string, body: any) {
    const ds = await this.prisma.dataset.findFirst({ where: { id: datasetId, projectId } });
    if (!ds) throw new NotFoundException('Dataset não encontrado neste projeto');
    if (ds.role !== 'RESERVADO') throw new BadRequestException('Somente conjuntos RESERVADOS precisam de liberação');
    if (ds.released) throw new BadRequestException('Conjunto já liberado');
    return this.prisma.approval.create({
      data: {
        projectId,
        kind: 'LIBERAR_DATASET_RESERVADO',
        subjectId: ds.id,
        subjectHash: `${ds.uri}:${ds.sha256 ?? 'sem-hash'}`,
        description: `Liberar conjunto reservado "${ds.name}" para uso em experimento. Motivo: ${reqString(body, 'reason', 2000)}`,
      },
    });
  }

  // ---------- Pesquisas ----------
  async createResearch(projectId: string, body: any) {
    if (!(await this.prisma.project.findUnique({ where: { id: projectId } }))) throw new NotFoundException('Projeto não encontrado');
    const codes: string[] = Array.isArray(body.assetCodes) ? body.assetCodes.map((c: string) => String(c).toUpperCase()) : [];
    if (codes.length === 0) throw new BadRequestException('Informe ao menos um ativo (assetCodes: WIN, WDO)');
    const assets = await this.prisma.marketAsset.findMany({ where: { code: { in: codes } } });
    if (assets.length !== codes.length) throw new BadRequestException(`Ativo(s) desconhecido(s): ${codes.filter((c) => !assets.find((a) => a.code === c)).join(', ')}`);
    return this.prisma.research.create({
      data: {
        projectId,
        title: reqString(body, 'title', 300),
        question: reqString(body, 'question', 20000),
        assets: { create: assets.map((a) => ({ assetId: a.id })) },
      },
      include: { assets: { include: { asset: true } } },
    });
  }

  listResearches(projectId: string) {
    return this.prisma.research.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { assets: { include: { asset: { select: { code: true } } } }, _count: { select: { hypotheses: true, experiments: true, jobs: true } } },
    });
  }

  async getResearch(projectId: string, researchId: string) {
    const r = await this.prisma.research.findFirst({
      where: { id: researchId, projectId },
      include: {
        assets: { include: { asset: true } },
        hypotheses: { orderBy: { createdAt: 'asc' } },
        experiments: { orderBy: { createdAt: 'asc' }, include: { dataset: { select: { name: true, role: true } }, job: { select: { id: true, status: true } } } },
        jobs: { orderBy: { createdAt: 'desc' }, select: { id: true, title: true, status: true, updatedAt: true } },
        memory: { where: { supersededById: null }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!r) throw new NotFoundException('Pesquisa não encontrada neste projeto');
    return r;
  }

  async createHypothesis(projectId: string, researchId: string, body: any) {
    const r = await this.prisma.research.findFirst({ where: { id: researchId, projectId } });
    if (!r) throw new NotFoundException('Pesquisa não encontrada neste projeto');
    const statement = reqString(body, 'statement', 5000);
    const decisionRule = body.decisionRule ? this.parseRule(body.decisionRule) : undefined;
    const h = await this.prisma.hypothesis.create({
      data: {
        researchId,
        statement,
        rationale: optString(body, 'rationale', 20000) ?? '',
        decisionRule: decisionRule as Prisma.InputJsonValue | undefined,
        decisionRuleSetAt: decisionRule ? new Date() : null,
      },
    });
    await this.prisma.memoryEntry.create({
      data: { projectId, researchId, category: 'HIPOTESE_INVESTIGACAO', title: statement.slice(0, 200), content: h.rationale || statement, references: { hypothesisId: h.id }, author: optString(body, 'author', 100) ?? 'operador' },
    });
    if (r.status === 'ABERTA') await this.prisma.research.update({ where: { id: r.id }, data: { status: 'EM_ANDAMENTO' } });
    return h;
  }

  /**
   * Muda o status de uma hipótese. VALIDADA exige experimento CONCLUIDO (verificado pelo backend)
   * com artefato de métricas e commit; REJEITADA exige conclusão e vai para a memória.
   */
  async updateHypothesis(projectId: string, hypothesisId: string, body: any, viaRule = false) {
    const h = await this.prisma.hypothesis.findFirst({ where: { id: hypothesisId, research: { projectId } }, include: { research: true } });
    if (!h) throw new NotFoundException('Hipótese não encontrada neste projeto');
    const status = oneOf(body, 'status', ['EM_INVESTIGACAO', 'REJEITADA', 'VALIDADA'] as const) as HypothesisStatus;
    if (h.status !== 'EM_INVESTIGACAO') {
      throw new BadRequestException(`Hipótese já decidida (${h.status}); decisões são definitivas — registre uma nova hipótese para revisitar`);
    }
    if (h.decisionRule && !viaRule && status !== 'EM_INVESTIGACAO') {
      throw new BadRequestException('Hipótese com regra pré-registrada: decida por POST /hypotheses/:id/decide');
    }
    const conclusion = status === 'EM_INVESTIGACAO' ? optString(body, 'conclusion', 20000) : reqString(body, 'conclusion', 20000);
    const author = optString(body, 'author', 100) ?? 'operador';
    if (status === 'VALIDADA' || status === 'REJEITADA') {
      const expIds: string[] = Array.isArray(body.experimentIds) ? body.experimentIds : [];
      const exps = await this.prisma.experiment.findMany({
        where: { id: { in: expIds }, projectId, researchId: h.researchId, OR: [{ hypothesisId: h.id }, { hypothesisId: null }] },
      });
      if (status === 'VALIDADA') {
        if (!exps.length) throw new BadRequestException('VALIDADA exige experimentIds desta hipótese');
        const bad = exps.filter((e) => e.status !== 'CONCLUIDO' || !e.codeRef || !e.metricsArtifactId);
        if (bad.length) throw new BadRequestException(`Experimentos sem verificação completa (CONCLUIDO + commit + métricas): ${bad.map((b) => b.name).join(', ')}`);
      }
      const artifactIds = exps.map((e) => e.metricsArtifactId).filter((x): x is string => !!x);
      const references = {
        hypothesisId: h.id,
        experimentIds: exps.map((e) => e.id),
        datasetIds: exps.map((e) => e.datasetId).filter(Boolean),
        artifactIds,
        gitCommit: exps[0]?.codeRef ?? undefined,
        parameters: exps.map((e) => ({ experimento: e.name, parametros: e.parameters })),
      };
      const category = status === 'VALIDADA' ? 'RESULTADO_VALIDADO' : 'HIPOTESE_REJEITADA';
      await this.memory.validateRefs(projectId, category, references as any);
      await this.prisma.$transaction(async (tx) => {
        const created = await tx.memoryEntry.create({
          data: { projectId, researchId: h.researchId, category, title: h.statement.slice(0, 200), content: conclusion!, references: references as Prisma.InputJsonValue, author },
        });
        // A entrada "em investigação" é substituída pela decisão: a memória nunca diz as duas coisas ao mesmo tempo.
        await tx.memoryEntry.updateMany({
          where: { projectId, category: 'HIPOTESE_INVESTIGACAO', supersededById: null, references: { path: ['hypothesisId'], equals: h.id } },
          data: { supersededById: created.id },
        });
      });
    }
    return this.prisma.hypothesis.update({ where: { id: h.id }, data: { status, conclusion } });
  }

  private parseRule(raw: any) {
    const metric = reqString(raw, 'metric', 200);
    const op = String(raw.op ?? '>=');
    if (!['>', '>=', '<', '<=', '==', '!='].includes(op)) throw new BadRequestException('decisionRule.op inválido');
    const value = Number(raw.value);
    if (!Number.isFinite(value)) throw new BadRequestException('decisionRule.value deve ser numérico');
    const datasetRole = raw.datasetRole ? oneOf(raw, 'datasetRole', ['TREINO', 'VALIDACAO', 'RESERVADO'] as const) : undefined;
    return { metric, op, value, ...(datasetRole ? { datasetRole } : {}) };
  }

  /** Pré-registro: a regra só pode ser definida/alterada antes de qualquer experimento da hipótese iniciar. */
  async setDecisionRule(projectId: string, hypothesisId: string, body: any) {
    const h = await this.prisma.hypothesis.findFirst({ where: { id: hypothesisId, research: { projectId } } });
    if (!h) throw new NotFoundException('Hipótese não encontrada neste projeto');
    // Qualquer experimento que possa decidir esta hipótese (vinculado a ela ou sem vínculo, na mesma pesquisa).
    const exps = await this.prisma.experiment.findMany({
      where: { researchId: h.researchId, OR: [{ hypothesisId: h.id }, { hypothesisId: null }] },
      include: { job: true },
    });
    if (exps.some((e) => e.job && e.job.status !== 'PENDENTE')) {
      throw new BadRequestException('Regra de decisão não pode ser alterada após o início de um experimento desta hipótese');
    }
    const rule = this.parseRule(body);
    return this.prisma.hypothesis.update({ where: { id: h.id }, data: { decisionRule: rule, decisionRuleSetAt: new Date() } });
  }

  /**
   * Decide a hipótese aplicando a regra PRÉ-REGISTRADA às métricas de um experimento verificado.
   * Ninguém (nem operador nem agente) escolhe o resultado: VALIDADA se a regra é satisfeita, senão REJEITADA.
   */
  async decideByRule(projectId: string, hypothesisId: string, body: any) {
    const h = await this.prisma.hypothesis.findFirst({ where: { id: hypothesisId, research: { projectId } } });
    if (!h) throw new NotFoundException('Hipótese não encontrada neste projeto');
    if (h.status !== 'EM_INVESTIGACAO') throw new BadRequestException(`Hipótese já decidida (${h.status})`);
    const rule = h.decisionRule as { metric: string; op: string; value: number; datasetRole?: string } | null;
    if (!rule || !h.decisionRuleSetAt) throw new BadRequestException('Hipótese sem regra de decisão pré-registrada');
    // Experimento da mesma pesquisa, vinculado a esta hipótese ou a nenhuma (um experimento pode medir várias).
    const exp = await this.prisma.experiment.findFirst({
      where: { id: reqString(body, 'experimentId', 60), projectId, researchId: h.researchId, OR: [{ hypothesisId: h.id }, { hypothesisId: null }] },
      include: { dataset: true, job: true },
    });
    if (!exp) throw new BadRequestException('Experimento não pertence a esta pesquisa/hipótese');
    if (exp.status !== 'CONCLUIDO' || !exp.codeRef || !exp.metricsArtifactId || !exp.job || exp.job.status !== 'CONCLUIDO') {
      throw new BadRequestException('Experimento não verificado (exige job CONCLUIDO, commit e artefato de métricas)');
    }
    if (exp.job.startedAt && h.decisionRuleSetAt > exp.job.startedAt) {
      throw new BadRequestException('Regra registrada depois do início do experimento: não é pré-registro');
    }
    if (rule.datasetRole && exp.dataset?.role !== rule.datasetRole) {
      throw new BadRequestException(`Regra exige dataset ${rule.datasetRole}; experimento usou ${exp.dataset?.role ?? 'nenhum'}`);
    }
    const value = Number(rule.metric.split('.').reduce((o: any, k) => (o == null ? undefined : o[k]), exp.metrics as any));
    if (!Number.isFinite(value)) throw new BadRequestException(`Métrica ${rule.metric} ausente nas métricas do experimento`);
    const ops: Record<string, (a: number, b: number) => boolean> = {
      '>': (a, b) => a > b, '>=': (a, b) => a >= b, '<': (a, b) => a < b, '<=': (a, b) => a <= b, '==': (a, b) => a === b, '!=': (a, b) => a !== b,
    };
    const passed = ops[rule.op](value, rule.value);
    const status = passed ? 'VALIDADA' : 'REJEITADA';
    const conclusion = `${status} pela regra pré-registrada ${rule.metric} ${rule.op} ${rule.value}: valor observado ${value} (experimento ${exp.name}, dataset ${exp.dataset?.name ?? '-'} [${exp.dataset?.role ?? '-'}], commit ${exp.codeRef}).`;
    return this.updateHypothesis(projectId, h.id, { status, conclusion, experimentIds: [exp.id], author: 'sistema:regra-pre-registrada' }, true);
  }

  /** Encerrar pesquisa só é permitido sem pendências: hipóteses decididas e jobs concluídos. */
  async closeResearch(projectId: string, researchId: string) {
    const r = await this.prisma.research.findFirst({
      where: { id: researchId, projectId },
      include: { hypotheses: true, jobs: true, experiments: true },
    });
    if (!r) throw new NotFoundException('Pesquisa não encontrada neste projeto');
    const pendencias = [
      ...r.hypotheses.filter((h) => h.status === 'EM_INVESTIGACAO').map((h) => `hipótese em investigação: ${h.statement}`),
      ...r.jobs.filter((j) => j.status !== 'CONCLUIDO').map((j) => `job ${j.title} em ${j.status}`),
      ...r.experiments.filter((e) => e.status !== 'CONCLUIDO').map((e) => `experimento ${e.name} em ${e.status}`),
    ];
    if (r.hypotheses.length === 0) pendencias.push('nenhuma hipótese registrada');
    if (pendencias.length) {
      throw new BadRequestException({ message: 'Pesquisa incompleta não pode ser encerrada', pendencias });
    }
    return this.prisma.research.update({ where: { id: r.id }, data: { status: 'ENCERRADA' } });
  }

  async compareExperiments(projectId: string, researchId: string, ids?: string[]) {
    const exps = await this.prisma.experiment.findMany({
      where: { projectId, researchId, ...(ids?.length ? { id: { in: ids } } : {}) },
      include: { dataset: { include: { asset: { select: { code: true } } } }, hypothesis: { select: { statement: true } }, job: { select: { status: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const metricKeys = new Set<string>();
    const paramKeys = new Set<string>();
    for (const e of exps) {
      Object.keys((e.metrics as object) ?? {}).forEach((k) => metricKeys.add(k));
      Object.keys((e.parameters as object) ?? {}).forEach((k) => paramKeys.add(k));
    }
    return {
      metricKeys: [...metricKeys],
      paramKeys: [...paramKeys],
      rows: exps.map((e) => ({
        id: e.id,
        name: e.name,
        status: e.status,
        hypothesis: e.hypothesis?.statement ?? null,
        dataset: e.dataset ? { name: e.dataset.name, role: e.dataset.role, asset: e.dataset.asset.code, sha256: e.dataset.sha256 } : null,
        codeRef: e.codeRef,
        parameters: e.parameters,
        metrics: e.metrics,
        verified: e.status === 'CONCLUIDO' && !!e.metricsArtifactId,
      })),
    };
  }
}
