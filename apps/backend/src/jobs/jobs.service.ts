import { compileLiquidGlassAdoption } from './workflow/compile-liquid-glass-adoption';
import { requireAdoptionContract } from './workflow/adoption-contract';
import { approvalPresentation } from './visual-previews';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { sha256 } from '../common/hash';
import { etapaPedeRenderizacaoMotion } from './executor-priority';
import { compileWorkflowDefinition } from './workflow/compile-plan';
import { hasMotionCommand } from './motion/command';
import { parseSteps } from './workflow/step-contract';
import { parseCriteria } from './workflow/criteria-contract';
import { validateCapabilityCriteria } from './workflow/capability-criteria';
import { dependenciasDeMontagemPorArquivo } from './workflow/media-dependencies';
import { assertAcyclic } from './workflow/graph';
export { normalizarInstrucaoDeEtapa } from './workflow/step-contract';
export type { StepInput } from './workflow/step-contract';
export { opcoesDeVideo, opcoesDeJuncao, TRANSICOES } from './workflow/media-options';
export { operacoesDeArquivos } from './workflow/file-options';
import { AreaScope, mediaEnabledForArea } from '../specialties/media/scope';
import { appConfig } from '../config';
import { readAttemptJournal } from '../worker/executor/attempt-journal';
import { BlockedReason } from '../common/status';
import { optNumber, optString, reqString } from '../common/validate';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { QueueService } from '../queue/queue.service';
import { LogService } from './log.service';
import { aceitarRevisao, conferenciasDasEtapas, lerRevisao, RULE_REVIEW_CRITERION, RULE_REVIEW_STEP, ruleReviewStep } from './rule-review';
import { OrchestratorService } from './orchestrator.service';
import { approvedGoldfish,checkApprovedGoldfishStep } from '../specialties/software/egm/resolution-execution';
import { assertGoldfishProofContracts } from '../specialties/software/egm/resolution-proof';
import { capturasParaRecuperar } from './motion-capture-freshness';


/**
 * Contrato do renderizador motion, aplicado ao registrar/validar o plano.
 * O vídeo durável mora SEMPRE em midia/saida; out/ é só para relatórios,
 * frames PNG/JPEG e outras evidências. Não depende da boa vontade da IA.
 */
/**
 * Compatibilidade com planos antigos: NÃO criar novas etapas pagas apenas
 * porque uma tarefa vai renderizar motion. O plano permanece exatamente com
 * suas tarefas de criação, render e montagem. Quem desenvolve é responsável
 * pela composição; validações técnicas são locais e não precisam de outra IA.
 */
export function comPreflightVisual(raw: unknown, _defaultProvider: string): unknown {
  return raw;
}

/**
 * Fronteira do planejamento: IA recebe TEXTO; local-shell recebe um COMANDO.
 * O nome da ferramenta citado em uma instrução de IA nunca é uma invocação.
 */
import { escreverArquivosDaMemoria, gravarNoProjeto } from '../memory/camadas';

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistry,
    private readonly queue: QueueService,
    private readonly orchestrator: OrchestratorService,
    private readonly logs: LogService,
  ) {}

  /**
   * Valida um plano proposto pela IA da conversa SEM criar nada: mesmas regras de um job criado à mão
   * (etapas de IA com verificação, sem ciclos, política, critérios válidos). Devolve o plano normalizado.
   */
  validatePlan(plan: any, area?: AreaScope, visualProfile?:unknown,request?:string) {
    if (!plan || typeof plan !== 'object') throw new BadRequestException('Plano vazio');
    const title = reqString(plan, 'title', 300);
    const objective = reqString(plan, 'objective', 50000);
    const defaultProvider = optString(plan, 'defaultProvider', 60) ?? 'claude-code-cli';
    if (!this.registry.has(defaultProvider)) throw new BadRequestException(`Conector desconhecido: ${defaultProvider}`);
    if (!Array.isArray(plan.steps) || plan.steps.length === 0) throw new BadRequestException('O plano precisa de pelo menos uma etapa');
    const compiled = compileWorkflowDefinition(plan.steps,plan.criteria??[],defaultProvider,objective,area);
    const brutas = compiled.steps;
    const steps = parseSteps(this.registry,brutas, defaultProvider);
    assertAcyclic(steps);
    const rawCriteria=compileLiquidGlassAdoption(compiled.criteria,{title,objective,steps:brutas},area,visualProfile,request);
    const criteria = parseCriteria(rawCriteria, [], mediaEnabledForArea(area));
    validateCapabilityCriteria(criteria,steps);
    if (criteria.length === 0) throw new BadRequestException('O plano precisa de critérios de aceitação verificáveis');
    requireAdoptionContract({title,objective,steps:brutas,criteria},area,visualProfile,request);
    const limits = plan.limits && typeof plan.limits === 'object' ? plan.limits : {};
    return { title, objective, defaultProvider, steps: brutas, criteria, limits };
  }

  async create(projectId: string, body: any, approvedScope?: import('./approved-scope').ApprovedScope) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, include: { area: true } });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    const title = reqString(body, 'title', 300);
    const objective = reqString(body, 'objective', 50000);
    const defaultProvider = optString(body, 'defaultProvider', 60) ?? 'local-shell';
    if (!this.registry.has(defaultProvider)) throw new BadRequestException(`Conector desconhecido: ${defaultProvider}`);
    const compiled = compileWorkflowDefinition(body.steps??[],body.criteria,defaultProvider,objective,project.area);
    const steps = parseSteps(this.registry,compiled.steps,defaultProvider);
    assertAcyclic(steps);
    const criteria = parseCriteria(compiled.criteria, [], mediaEnabledForArea(project.area));
    validateCapabilityCriteria(criteria,steps);
    if(approvedScope)requireAdoptionContract({title,objective,steps,criteria},project.area,approvedScope.visual.profile,approvedScope.request?.content);
    const egm=approvedGoldfish(approvedScope);
    if(egm){
      if(!egm.proofs)throw new ConflictException('Correção Goldfish exige contratos de regressão por achado.');
      assertGoldfishProofContracts(egm.proofs,criteria);
      if(steps.length!==egm.steps.length)throw new ConflictException('Etapas Goldfish divergentes do plano aprovado.');
      for(const step of steps){
        if(this.registry.get(step.provider??defaultProvider).kind==='executor')throw new ConflictException('Correção Goldfish exige agente de software, não executor direto.');
        checkApprovedGoldfishStep(egm,step);
      }
    }
    // Revisão editorial/visual é decisão do USUÁRIO. Não adicionar sessão
    // independente de IA por padrão; só se a pessoa solicitar conferência
    // explicitamente. Testes técnicos necessários permanecem nos executores.
    // Uma entrega concluída deve ser publicada para o usuário analisar.
    const aiProviders = [...new Set(steps.map((s) => s.provider ?? defaultProvider))].filter((id) => this.registry.get(id).kind !== 'executor');
    // Motion é uma entrega de mídia: composição → render → montagem.
    // Não acrescentar revisor pago independente; a aceitação técnica é do
    // renderizador e dos critérios de vídeo do plano. Revisão editorial extra
    // pode ser pedida explicitamente como outra tarefa, não forçada pelo motor.
    const motionDireto = steps.some((s) =>
      (s.provider ?? defaultProvider) === 'local-shell' && hasMotionCommand(s.instructions));
    if (aiProviders.length && body.conferencia === true && !motionDireto) {
      const reviewer = aiProviders.includes(project.provider) ? project.provider : aiProviders[0];
      steps.push({ ...ruleReviewStep(steps.map((s) => s.key), reviewer), requiresApproval: false, providerOptions: {} });
      if (!criteria.some((c) => c.key === RULE_REVIEW_CRITERION.key)) criteria.push(RULE_REVIEW_CRITERION);
    }
    // Trabalho vindo da conversa ("Fazer"): vai até o fim — sem limite de sessões nem de tempo. Para de
    // verdade só se ficar sem nenhum avanço (repetição) ou estourar o limite de gasto do PROJETO.
    const limits = body.semLimites === true ? { maxSessionsPerStep: 0, maxDurationSec: 0, maxCostUsd: 0, maxAttemptsPerStep: 10, ...(body.limits ?? {}) } : (body.limits ?? {});
    const job = await this.prisma.job.create({
      data: {
        projectId,
        title,
        defaultProvider,
        ...(approvedScope?{approvedScope:approvedScope as unknown as Prisma.InputJsonValue}:{}),
        maxAttemptsPerStep: optNumber(limits, 'maxAttemptsPerStep', 1, 100),
        // 0 = sem limite (sessões e tempo).
        maxDurationSec: limits.maxDurationSec === 0 ? 0 : optNumber(limits, 'maxDurationSec', 10, 7 * 24 * 3600),
        maxCostUsd: optNumber(limits, 'maxCostUsd', 0, 10000),
        stepTimeoutSec: optNumber(limits, 'stepTimeoutSec', 1, 24 * 3600),
        repetitionWindow: optNumber(limits, 'repetitionWindow', 2, 20),
        maxSessionsPerStep: limits.maxSessionsPerStep === 0 ? 0 : optNumber(limits, 'maxSessionsPerStep', 1, 100),
        gitBranch: null,
        objectives: {
          create: { version: 1, text: objective, sha256: sha256(objective), author: optString(body, 'author', 100) ?? 'operador' },
        },
        steps: { create: steps.map((s, i) => ({ ...s, order: i })) },
        criteria: { create: criteria },
      },
    });
    await this.prisma.job.update({ where: { id: job.id }, data: { gitBranch: `job/${job.id}` } });
    await this.logs.log(job.id, `Job criado com ${steps.length} etapa(s) e ${criteria.length} critério(s). Objetivo v1 sha256=${sha256(objective).slice(0, 12)}`);
    if (criteria.length === 0) {
      await this.logs.log(job.id, 'ATENÇÃO: job sem critérios de aceitação — a conclusão será bloqueada até que critérios sejam adicionados.', { level: 'WARN' });
    }
    return this.get(projectId, job.id);
  }

  async list(projectId: string) {
    return this.prisma.job.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { steps: { select: { key: true, status: true } } },
    });
  }

  async listAll(status?: string) {
    return this.prisma.job.findMany({
      where: status ? { status: status as any } : {},
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: { project: { select: { id: true, name: true, slug: true } }, steps: { select: { key: true, status: true } } },
    });
  }

  async get(projectId: string, jobId: string) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, projectId },
      include: {
        objectives: { orderBy: { version: 'asc' } },
        criteria: { orderBy: [{ createdAt: 'asc' }, { key: 'asc' }], include: { checks: { orderBy: { createdAt: 'desc' }, take: 1 } } },
        steps: { orderBy: { order: 'asc' } },
        attempts: { orderBy: { startedAt: 'asc' } },
        checkpoints: { orderBy: { seq: 'asc' } },
        artifacts: { orderBy: { createdAt: 'asc' } },
        approvals: { orderBy: { requestedAt: 'asc' } },
        project: { select: { id: true, name: true, slug: true, area: { select: { template: true, slug: true } } } },
      },
    });
    if (!job) throw new NotFoundException('Job não encontrado neste projeto');
    // Última coisa registrada (ex.: "[ferramenta] Read src/app.ts"): a tela mostra que o trabalho está vivo.
    const ultima = await this.prisma.logEntry.findFirst({ where: { jobId }, orderBy: { id: 'desc' }, select: { message: true, createdAt: true } });
    return { ...job, approvals:job.approvals.map(a=>({...a,presentation:approvalPresentation(a,job)})), ultimaAtividade: ultima ? { mensagem: ultima.message.slice(0, 300), em: ultima.createdAt } : null };
  }

  /** Busca por id global (usado em rotas /jobs/:id); retorna o projectId para checagens de isolamento. */
  async projectOf(jobId: string): Promise<string> {
    const j = await this.prisma.job.findUnique({ where: { id: jobId }, select: { projectId: true } });
    if (!j) throw new NotFoundException('Job não encontrado');
    return j.projectId;
  }

  async newObjectiveVersion(projectId: string, jobId: string, body: any) {
    const text = reqString(body, 'text', 50000);
    const reason = reqString(body, 'reason', 2000);
    const job = await this.get(projectId, jobId);
    if (job.status === 'CONCLUIDO') throw new ConflictException('Job concluído: objetivo não pode ser alterado');
    const version = job.objectiveVersion + 1;
    await this.prisma.$transaction([
      this.prisma.jobObjectiveVersion.create({
        data: { jobId, version, text, sha256: sha256(text), author: optString(body, 'author', 100) ?? 'operador', reason },
      }),
      this.prisma.job.update({ where: { id: jobId }, data: { objectiveVersion: version } }),
    ]);
    await this.logs.log(jobId, `Objetivo atualizado para v${version}: ${reason}`);
    return this.get(projectId, jobId);
  }

  async addSteps(projectId: string, jobId: string, body: any) {
    const job = await this.get(projectId, jobId);
    if (job.status === 'CONCLUIDO') throw new ConflictException('Job concluído');
    const objective=job.objectives.at(-1)?.text??job.title;
    const compiled=compileWorkflowDefinition(body.steps??[],undefined,job.defaultProvider,objective,job.project.area,{append:true});
    const parsed=parseSteps(this.registry,compiled.steps,job.defaultProvider,job.steps.map(s=>s.key));
    if(!parsed.length)throw new BadRequestException('Informe pelo menos uma nova etapa.');
    const steps=await this.prisma.$transaction(async tx=>{
      await OrchestratorService.lockJob(tx,jobId);
      const current=await tx.job.findUniqueOrThrow({where:{id:jobId},include:{steps:true}});
      if(current.status==='CONCLUIDO')throw new ConflictException('Job concluído');
      const existing=current.steps;
      const currentCriteria=await tx.acceptanceCriterion.findMany({where:{jobId}});
      validateCapabilityCriteria(currentCriteria,[...existing,...parsed]);
      const keys=new Set(existing.map(s=>s.key));
      if(parsed.some(s=>keys.has(s.key)))throw new ConflictException('Etapa já existente; recarregue o trabalho.');
      const linked=dependenciasDeMontagemPorArquivo([...existing,...parsed],current.defaultProvider) as Array<{key:string;dependsOn:string[]}>;
      for(const old of existing){
        const next=linked.find(s=>s.key===old.key)!;
        if(next.dependsOn.some(d=>!old.dependsOn.includes(d)))throw new BadRequestException('A nova etapa mudaria dependências de '+old.key+' já persistida. Crie uma continuação explícita, sem reescrever etapas existentes.');
      }
      const additions=parsed.map(s=>({...s,dependsOn:linked.find(x=>x.key===s.key)!.dependsOn}));
      const base=Math.max(-1,...existing.map(s=>s.order))+1;
      const review=existing.find(s=>s.key===RULE_REVIEW_STEP);
      if(review?.status==='EXECUTANDO')throw new ConflictException('Aguarde a etapa de revisão em execução antes de acrescentar etapas.');
      const graph=existing.map(s=>s.key===RULE_REVIEW_STEP?{...s,dependsOn:[...new Set([...s.dependsOn,...additions.map(a=>a.key)])]}:s);
      assertAcyclic([...graph,...additions]);
      await tx.step.createMany({data:additions.map((s,i)=>({...s,jobId,order:base+i}))});
      if(review)await tx.step.update({where:{id:review.id},data:{dependsOn:graph.find(s=>s.id===review.id)!.dependsOn,order:base+additions.length,status:'PENDENTE',statusDetail:'novas etapas: conferir de novo'}});
      return additions;
    });
    await this.logs.log(jobId, `Etapas adicionadas: ${steps.map((s) => s.key).join(', ')}`);
    await this.orchestrator.scheduleReady(jobId);
    return this.get(projectId, jobId);
  }

  async addCriteria(projectId: string, jobId: string, body: any) {
    const job = await this.get(projectId, jobId);
    if (job.status === 'CONCLUIDO') throw new ConflictException('Job concluído');
    const criteria = parseCriteria(body.criteria ?? [], job.criteria.map((c) => c.key), mediaEnabledForArea(job.project.area));
    validateCapabilityCriteria([...job.criteria,...criteria],job.steps);
    await this.prisma.acceptanceCriterion.createMany({ data: criteria.map((c) => ({ ...c, jobId })) });
    await this.logs.log(jobId, `Critérios adicionados: ${criteria.map((c) => c.key).join(', ')}`);
    return this.get(projectId, jobId);
  }

  async updateLimits(projectId: string, jobId: string, body: any) {
    await this.get(projectId, jobId);
    const data = {
      maxAttemptsPerStep: optNumber(body, 'maxAttemptsPerStep', 1, 100),
      // 0 = sem limite (como na criação).
      maxDurationSec: body?.maxDurationSec === 0 ? 0 : optNumber(body, 'maxDurationSec', 10, 7 * 24 * 3600),
      maxCostUsd: optNumber(body, 'maxCostUsd', 0, 10000),
      stepTimeoutSec: optNumber(body, 'stepTimeoutSec', 1, 24 * 3600),
      repetitionWindow: optNumber(body, 'repetitionWindow', 2, 20),
      maxSessionsPerStep: body?.maxSessionsPerStep === 0 ? 0 : optNumber(body, 'maxSessionsPerStep', 1, 100),
    };
    await this.prisma.job.update({ where: { id: jobId }, data });
    await this.logs.log(jobId, `Limites atualizados: ${JSON.stringify(data)}`);
    return this.get(projectId, jobId);
  }

  async start(projectId: string, jobId: string) {
    const job = await this.get(projectId, jobId);
    if (job.status !== 'PENDENTE') throw new ConflictException(`Job em ${job.status}; use retomar`);
    await this.prisma.job.update({ where: { id: jobId }, data: { status: 'EXECUTANDO', startedAt: new Date(), statusDetail: null } });
    await this.logs.log(jobId, 'Job iniciado');
    await this.orchestrator.scheduleReady(jobId);
    return this.get(projectId, jobId);
  }

  /**
   * Pausar: para na hora (a sessão da IA em andamento é encerrada) e guarda tudo — arquivos, notas, checkpoint. O
   * "Continuar" (resume) segue de onde parou, numa sessão nova que recebe o que já foi feito.
   */
  async pausar(projectId: string, jobId: string, by = 'operador') {
    await this.get(projectId, jobId);
    const changed = await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, jobId);
      const r = await tx.job.updateMany({
        where: { id: jobId, status: { in: ['PENDENTE', 'EXECUTANDO', 'AGUARDANDO_RECURSO', 'AGUARDANDO_APROVACAO'] } },
        data: { status: 'BLOQUEADO', blockedReason: BlockedReason.PAUSADO, statusDetail: `pausado por ${by}` },
      });
      if (r.count) await this.queue.cancelForJob(tx, jobId);
      return r.count;
    });
    if (!changed) throw new ConflictException('O trabalho não está em andamento');
    await this.logs.log(jobId, `Trabalho pausado por ${by}. Tudo o que foi feito fica salvo; "Continuar" segue de onde parou.`, { level: 'WARN' });
    return this.get(projectId, jobId);
  }

  async resume(projectId: string, jobId: string, by = 'operador') {
    const job = await this.get(projectId, jobId);
    if (!['BLOQUEADO', 'FALHOU', 'AGUARDANDO_RECURSO'].includes(job.status)) {
      throw new ConflictException(`Job em ${job.status} não pode ser retomado`);
    }
    // Jobs anteriores ao roteamento correto podiam "concluir" render motion
    // com nvidia-api apenas encontrando um MP4 antigo, sem executar comando.
    // Renascer o revisor não corrige isso: evitar novas sessões e gasto inútil.
    const renderFalso = mediaEnabledForArea(job.project.area) ? job.steps.find((s) =>
      s.status === 'CONCLUIDO' && (s.provider ?? job.defaultProvider) !== 'local-shell' &&
      (s.provider ?? job.defaultProvider) !== 'gemini-video' && etapaPedeRenderizacaoMotion(s)) : undefined;
    const renderReal = job.steps.some((s) =>
      (s.provider ?? job.defaultProvider) === 'local-shell' && hasMotionCommand(s.instructions));
    if (renderFalso && !renderReal) {
      throw new ConflictException(
        `O plano antigo marcou "${renderFalso.key}" como renderizado pela IA sem executar o renderizador; ` +
        'retomar repetiria a revisão sem produzir vídeo. Não é seguro aprovar o MP4 anterior. ' +
        'Replaneje a renderização com fonte motion/<pasta> explícita, executor local-shell e novo nome de MP4; ' +
        'os arquivos e resultados anteriores foram preservados.');
    }
    // Uma sessão ainda em andamento (worker vivo encerrando o processo depois do "Pausar") impede a retomada:
    // senão duas sessões trabalhariam ao mesmo tempo no mesmo workspace. "Continuar" logo depois de "Pausar"
    // espera alguns segundos o encerramento em vez de recusar.
    const sessaoAindaFechando = async () => {
      // A sessão só está encerrada quando o worker SOLTA a tarefa (lockedBy=null,
      // via acknowledgeCancelled, após matar o processo e reconciliar a tentativa).
      // Não basta o lease ter vencido: um processo que ignora SIGTERM morre só no
      // SIGKILL (alguns segundos depois), e nesse meio-tempo o lease pode expirar
      // enquanto o worker ainda está encerrando. Retomar aí abriria uma 2ª sessão
      // no mesmo trabalho e leria a tentativa antes de ela virar INTERROMPIDA.
      return this.prisma.queueTask.findFirst({where:{jobId,status:{in:['RUNNING','CANCELLED']},lockedBy:{not:null}},select:{id:true,lockedBy:true}});
    };
    const ate = Date.now() + Number(process.env.NIVOO_ESPERA_ENCERRAR_MS ?? 20_000);
    let fechando = await sessaoAindaFechando();
    while (fechando && Date.now() < ate) {
      await new Promise((r) => setTimeout(r, 500));
      fechando = await sessaoAindaFechando();
    }
    if (fechando) {
      throw new ConflictException(`A sessão anterior deste trabalho ainda está sendo encerrada (tarefa ${fechando.id} no worker ${fechando.lockedBy}). Aguarde alguns segundos e clique em Continuar de novo; nunca rodam duas sessões no mesmo trabalho.`);
    }
    // Em jobs motion antigos, o núcleo inseria uma revisão de IA compulsória
    // ANTES do render. Ela podia bloquear toda a entrega apesar de o HTML e
    // os quadros já existirem. A retomada conserva o histórico, dispensa
    // somente essa etapa EXTRA e executa as etapas produtivas pendentes.
    // Isso NÃO equivale a certificar a qualidade artística do vídeo.
    const motionLegadoBloqueado = job.blockedReason === BlockedReason.CRITERIOS_NAO_ATENDIDOS &&
      job.steps.some((s) => (s.provider ?? job.defaultProvider) === 'local-shell' &&
        hasMotionCommand(s.instructions)) &&
      job.steps.some((s) => /^direcao-arte-/.test(s.key) && s.status === 'BLOQUEADO');
    // A revisão final compulsória também era uma sessão EXTRA de IA.
    // Ela só pode ser dispensada se o trabalho JÁ tiver critério técnico
    // explícito que verifica a existência do vídeo final. Reutilizar esse
    // critério (mesmo arquivo, sem afirmar aprovação artística).
    const entregaFinal = job.criteria.find((c) =>
      c.key === 'video-final' && c.kind === 'FILE_EXISTS' &&
      typeof (c.config as { path?: unknown } | null)?.path === 'string');
    const criterioRegraLegado = job.criteria.find((c) => c.key === RULE_REVIEW_STEP);
    const dispensaRevisaoFinal = motionLegadoBloqueado && !!entregaFinal && !!criterioRegraLegado;
    // Se o fluxo é direto, não há razão para gerar outra captura só para
    // alimentar o revisor artificial que foi dispensado.
    const pasta = motionLegadoBloqueado ? null : await this.pastaDoTrabalho(projectId, jobId);
    const revisoresBloqueados = job.steps.filter((etapa) =>
      ['BLOQUEADO', 'FALHOU'].includes(etapa.status) && /^direcao-arte-/.test(etapa.key));
    const recapturar = new Set<string>(
      pasta
        ? revisoresBloqueados.flatMap((revisao) => capturasParaRecuperar(pasta, revisao, job.steps))
        : [],
    );
    await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, jobId);
      const current=await tx.job.findUniqueOrThrow({where:{id:jobId},select:{status:true}});
      if(!['BLOQUEADO','FALHOU','AGUARDANDO_RECURSO'].includes(current.status))throw new ConflictException('Estado do trabalho mudou durante a retomada.');
      if (dispensaRevisaoFinal && criterioRegraLegado && entregaFinal) {
        // Não apagar evidências nem falsificar relatório: substituir o
        // critério de IA que o próprio Nivoo adicionou pelo mesmo teste real
        // de entrega do MP4 já exigido pelo trabalho.
        await tx.acceptanceCriterion.update({
          where: { id: criterioRegraLegado.id },
          data: {
            key: 'entrega-direta-sem-revisao-extra',
            description: 'Entrega do vídeo final no caminho original; revisão adicional do sistema dispensada, sem certificação artística',
            kind: 'FILE_EXISTS',
            config: entregaFinal.config as Prisma.InputJsonValue,
            status: 'PENDENTE',
          },
        });
      }
      for (const s of job.steps) {
        if (dispensaRevisaoFinal && s.key === RULE_REVIEW_STEP) {
          await tx.step.update({ where: { id: s.id }, data: {
            status: 'CONCLUIDO',
            statusDetail: 'Revisão independente artificial do Nivoo dispensada na retomada; nenhuma aprovação artística presumida',
          } });
          continue;
        }
        if (motionLegadoBloqueado && /^direcao-arte-/.test(s.key)) {
          // Registrar como etapa DISPENSADA, nunca como parecer conforme.
          // ExecStatus não possui estado SKIPPED: o statusDetail documenta
          // que nenhuma aprovação artística foi presumida. Mantemos
          // tentativas, arquivos, snapshots e dependências originais.
          await tx.step.update({ where: { id: s.id }, data: {
            status: 'CONCLUIDO',
            statusDetail: 'Dispensada: revisão visual adicional antiga do Nivoo, sem aprovação artística; seguir para renderização da composição existente',
          } });
          continue;
        }
        const last=await tx.attempt.findFirst({where:{stepId:s.id},orderBy:{number:'desc'}});
        const journal=readAttemptJournal(last?.executionState);
        const recoverable=!!last&&(last.status==='EXECUTANDO'||(last.status==='SUCESSO'&&!!last.treeAfter)
          ||(last.status==='INTERROMPIDA'&&!!journal&&journal.phase!=='TERMINAL'));
        const recomeco={resumeFromAttempt:recoverable?Math.min(s.resumeFromAttempt,Math.max(0,last!.number-1)):last?.number??0};
        if (recapturar.has(s.key) && s.status === 'CONCLUIDO') {
          await tx.step.update({where:{id:s.id},data:{status:'PENDENTE',statusDetail:'recapturar visual atualizado antes da revisão'}});
        } else if(s.status==='EXECUTANDO'){
          // Preserve the process identity and receipt; only the executor
          // holding the next valid claim may reconcile an abandoned attempt.
          await tx.step.update({where:{id:s.id},data:{status:'PENDENTE',statusDetail:'retomada com reconciliação da tentativa anterior',...recomeco}});
        } else if (['BLOQUEADO', 'FALHOU', 'AGUARDANDO_RECURSO'].includes(s.status)) {
          await tx.step.update({
            where: { id: s.id },
            data: {
              status: 'PENDENTE', statusDetail: 'retomada', ...recomeco,
              // A revisão espera todas as capturas vencidas, mesmo quando
              // a dependência original só exigia um dos quadros.
              ...(recapturar.size && revisoresBloqueados.some((r) => r.id === s.id)
                ? { dependsOn: [...new Set([...s.dependsOn, ...recapturar])] }
                : {}),
            },
          });
        }
      }
      // "Tentar de novo" é uma intervenção do usuário: a contagem de "mesma falha
      // N vezes" recomeça. Neutraliza os marcadores de assinatura das correções
      // anteriores (sem apagar o histórico) para que o ciclo de correção não pare
      // de cara pela repetição do ciclo já encerrado.
      await tx.$executeRaw`UPDATE "Step" SET instructions = regexp_replace(instructions, '^NIVOO_RECOVERY_SIGNATURES_V1:', 'NIVOO_RECOVERY_SIGNATURES_V1_CICLO_ANTERIOR:', 'm') WHERE "jobId" = ${jobId} AND key ~ '^correcao-criterios-[0-9]+$'`;
      await tx.job.update({
        where: { id: jobId },
        data: { status: 'EXECUTANDO', blockedReason: null, statusDetail: `retomado por ${by}`, finishedAt: null, startedAt: job.startedAt ?? new Date() },
      });
    });
    await this.logs.log(jobId,
      `Job retomado por ${by} a partir do último checkpoint${motionLegadoBloqueado
        ? '; revisão visual legada dispensada SEM certificar qualidade; render/montagem prosseguem' +
          (dispensaRevisaoFinal ? '; revisor final automático dispensado (critério técnico do vídeo preservado)' : '')
        : recapturar.size ? '; recapturar ' + [...recapturar].join(', ') + ' antes de revisar' : ''}`);
    await this.orchestrator.scheduleReady(jobId);
    return this.get(projectId, jobId);
  }

  /** Solicita nova verificação de critérios (nunca marca conclusão diretamente). */
  async requestEvaluation(projectId: string, jobId: string) {
    const job = await this.get(projectId, jobId);
    if (job.status === 'CONCLUIDO') {
      const receipt=job.completionState as {phase?:string;publish?:boolean;pushStatus?:string}|null;
      if(receipt&&(receipt.phase!=='DELIVERED'||(receipt.publish&&receipt.pushStatus!=='CONFIRMED'))){
        await this.prisma.$transaction(async tx=>{await OrchestratorService.lockJob(tx,jobId);await this.queue.enqueue(tx,'EVALUATE_JOB',jobId,null);});
      }
      return job;
    }
    if (job.steps.some((s) => s.status !== 'CONCLUIDO')) {
      throw new ConflictException('Há etapas não concluídas; retome o job em vez de reavaliar');
    }
    if (!['BLOQUEADO', 'AGUARDANDO_APROVACAO', 'EXECUTANDO'].includes(job.status)) {
      throw new ConflictException(`Job em ${job.status} não pode ser reavaliado`);
    }
    if (job.status === 'BLOQUEADO') {
      await this.prisma.job.update({ where: { id: jobId }, data: { status: 'EXECUTANDO', blockedReason: null } });
    }
    await this.queue.enqueue(this.prisma, 'EVALUATE_JOB', jobId, null);
    await this.logs.log(jobId, 'Reavaliação de critérios solicitada');
    return this.get(projectId, jobId);
  }

  private async pastaDoTrabalho(projectId: string, jobId: string): Promise<string | null> {
    const p = await this.prisma.project.findUnique({ where: { id: projectId }, select: { workspacePath: true } });
    const wt = p ? path.join(p.workspacePath, 'worktrees', jobId) : null;
    return wt && fs.existsSync(wt) ? wt : null;
  }

  /** O que a revisão independente disse (violações e perguntas para o usuário). */
  async revisao(projectId: string, jobId: string) {
    await this.get(projectId, jobId);
    const wt = await this.pastaDoTrabalho(projectId, jobId);
    return (wt && lerRevisao(wt)) ?? { conforme: null, violacoes: [], perguntas: [], observacoes: '' };
  }

  /**
   * "Aceitar assim mesmo": a revisão disse "não conforme" (ex.: por uma dúvida que só o usuário responde) e o
   * usuário aceita o trabalho como está. Fica registrado no relatório quem aceitou e o que estava apontado; os
   * critérios são conferidos de novo e, passando, o trabalho conclui normalmente. Um trabalho nunca fica preso.
   */
  async aceitarRevisao(projectId: string, jobId: string, por = 'usuário') {
    const job = await this.get(projectId, jobId);
    if (job.status !== 'BLOQUEADO' || job.blockedReason !== BlockedReason.CRITERIOS_NAO_ATENDIDOS) {
      throw new ConflictException('Só dá para aceitar assim mesmo um trabalho parado pela conferência final');
    }
    if (!job.criteria.some((c) => c.key === RULE_REVIEW_STEP)) throw new ConflictException('Este trabalho não tem revisão independente');
    if (job.steps.some((s) => s.status !== 'CONCLUIDO')) throw new ConflictException('Há etapas não concluídas; use "Tentar de novo"');
    const wt = await this.pastaDoTrabalho(projectId, jobId);
    if (!wt) throw new ConflictException('A pasta do trabalho não existe mais');
    const nome = String(por).slice(0, 80) || 'usuário';
    aceitarRevisao(wt, nome);
    await this.logs.log(jobId, `Revisão aceita assim mesmo por ${nome}: os critérios são conferidos de novo`, { level: 'WARN' });
    return this.requestEvaluation(projectId, jobId);
  }

  /**
   * O usuário responde às perguntas da revisão ali mesmo: a resposta fica guardada (out/respostas-do-usuario.md e
   * memória do projeto), a IA do trabalho aplica a resposta numa etapa nova e a revisão independente confere de novo.
   */
  async responderRevisao(projectId: string, jobId: string, body: any) {
    const job = await this.get(projectId, jobId);
    if (job.status !== 'BLOQUEADO' || job.blockedReason !== BlockedReason.CRITERIOS_NAO_ATENDIDOS) {
      throw new ConflictException('Só dá para responder à revisão de um trabalho parado pela conferência final');
    }
    const revisao = job.steps.find((s) => s.key === RULE_REVIEW_STEP);
    if (!revisao) throw new ConflictException('Este trabalho não tem revisão independente');
    if (job.steps.some((s) => s.status !== 'CONCLUIDO')) throw new ConflictException('Há etapas não concluídas; use "Tentar de novo"');
    const resposta = reqString(body, 'resposta', 20000).trim();
    if (!resposta) throw new BadRequestException('Escreva a resposta');
    const por = (optString(body, 'por', 80) ?? 'usuário').trim() || 'usuário';
    const wt = await this.pastaDoTrabalho(projectId, jobId);
    if (!wt) throw new ConflictException('A pasta do trabalho não existe mais');
    const r = lerRevisao(wt) ?? { violacoes: [], perguntas: [], observacoes: '' };
    const quando = new Date().toISOString();
    fs.mkdirSync(path.join(wt, 'out'), { recursive: true });
    fs.appendFileSync(path.join(wt, 'out', 'respostas-do-usuario.md'), `## Resposta de ${por} (${quando})\n\n${resposta}\n\n`);
    fs.rmSync(path.join(wt, 'out', 'conferencia-regras.json'), { force: true }); // o veredito antigo sai; a revisão roda de novo
    const n = job.steps.filter((s) => s.key.startsWith('resposta-usuario-')).length + 1;
    const key = `resposta-usuario-${n}`;
    const outras = job.steps.filter((s) => s.key !== RULE_REVIEW_STEP);
    const provider = [...outras].reverse().find((s) => s.provider)?.provider ?? job.defaultProvider;
    const base = Math.max(...job.steps.map((s) => s.order)) + 1;
    const lista = (t: string, xs: string[]) => (xs.length ? [t, ...xs.map((x) => `- ${x}`), ''] : []);
    await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, jobId);
      await tx.step.create({
        data: {
          jobId, key, order: base, provider, dependsOn: outras.map((s) => s.key),
          title: 'Aplicar a resposta do usuário',
          instructions: [
            'A revisão independente deixou perguntas que só o usuário podia responder. Ele RESPONDEU. Aplique a resposta ao trabalho.',
            '',
            ...lista('O que a revisão apontou:', r.violacoes),
            ...lista('Perguntas:', r.perguntas.map((q) => q.pergunta)),
            `Resposta do usuário (${por}):`,
            resposta,
            '',
            'Ajuste os entregáveis de acordo com a resposta (ela também está em out/respostas-do-usuario.md), mantendo o que já foi feito e as regras do projeto.',
            'Atualize out/perguntas-ao-usuario.md: tire o que foi respondido; deixe só o que continuar realmente em aberto.',
          ].join('\n'),
          // A resposta muda o trabalho: as conferências das etapas (testes, build, fotos) rodam de novo.
          verifyCommand: conferenciasDasEtapas(outras).join(' && ') || 'true',
        },
      });
      await tx.step.update({ where: { id: revisao.id }, data: { status: 'PENDENTE', order: base + 1, dependsOn: [...new Set([...revisao.dependsOn, key])], statusDetail: 'resposta do usuário: conferir de novo' } });
      await tx.job.update({ where: { id: jobId }, data: { status: 'EXECUTANDO', blockedReason: null, statusDetail: `aplicando a resposta de ${por}`, finishedAt: null } });
      // A resposta do usuário é decisão dele: memória do projeto, um item por pergunta (responder de novo atualiza).
      await gravarNoProjeto(tx, {
        projectId, category: 'DECISAO_APROVADA', author: por, references: { jobId, origem: 'resposta-a-revisao' },
        title: `Resposta: ${(r.perguntas[0]?.pergunta ?? job.title).replace(/\s+/g, ' ').replace(/^#+\s*/, '').slice(0, 120)}`,
        content: [...lista('Perguntas:', r.perguntas.map((q) => q.pergunta)), 'Resposta:', resposta].join('\n').slice(0, 50000),
      });
    });
    await escreverArquivosDaMemoria(this.prisma, projectId);
    await this.logs.log(jobId, `Resposta de ${por} às perguntas da revisão: a IA aplica e a revisão confere de novo`, { level: 'INFO' });
    await this.orchestrator.scheduleReady(jobId);
    return this.get(projectId, jobId);
  }

  /** Estado real do job: o que está pronto, o que falta. */
  async report(projectId: string, jobId: string) {
    const job = await this.get(projectId, jobId);
    const pendingSteps = job.steps.filter((s) => s.status !== 'CONCLUIDO').map((s) => ({ key: s.key, status: s.status, detalhe: s.statusDetail }));
    const pendingCriteria = job.criteria.filter((c) => c.status !== 'APROVADO').map((c) => ({ key: c.key, status: c.status, descricao: c.description }));
    const pendingApprovals = job.approvals.filter((a) => a.status === 'PENDENTE').map((a) => ({ id: a.id, descricao: a.description }));
    return {
      jobId,
      status: job.status,
      motivo: job.blockedReason,
      detalhe: job.statusDetail,
      concluido: job.status === 'CONCLUIDO',
      objetivo: job.objectives[job.objectives.length - 1],
      etapasPendentes: pendingSteps,
      criteriosPendentes: pendingCriteria,
      aprovacoesPendentes: pendingApprovals,
      semCriterios: job.criteria.length === 0,
      custoUsd: job.costSpentUsd,
      tempoAtivoSeg: job.activeSeconds,
      tentativas: job.attempts.length,
    };
  }
}

export { comVideoCompleto } from './workflow/video-assembly';
