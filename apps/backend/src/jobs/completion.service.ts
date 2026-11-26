import { summarizeSkillEvidence } from '../specialties/skill-evidence';
import { readApprovedScope } from './approved-scope';
import { approvedGoldfish,checkApprovedGoldfishStep,type ApprovedGoldfishResolution } from '../specialties/software/egm/resolution-execution';
import { assertGoldfishProofContracts,goldfishProofEvidence,detectGoldfishGitDrift,renderGoldfishGitDrift,type GoldfishProof } from '../specialties/software/egm/resolution-proof';
import { adoptionOf,adoptionSummaries,nativeAdoptionInventory } from './workflow/adoption-contract';
import { verifyAdoptionInventory,verifyAdoptionCoverage } from './workflow/adoption-evidence';
import { Injectable } from '@nestjs/common';
import { AcceptanceCriterion, Job, Prisma } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sha256, sha256File } from '../common/hash';
import { minimalEnv, runProcess } from '../common/exec';
import { prepareVerificationEnvironment,verificationProblem,redactVerificationResult,verificationPassed,type VerificationProblem } from '../common/verification-environment';
import { resolveInside } from '../common/path-guard';
import { BlockedReason } from '../common/status';
import { PrismaService } from '../prisma/prisma.service';
import { evaluatePolicy } from '../security/policy';
import { ArtifactStoreService } from '../storage/artifact-store.service';
import { WorkspaceService,type IntegrationPlan } from '../storage/workspace.service';
import { LogService } from './log.service';
import { GitService } from '../git/git.service';
import { OrchestratorService } from './orchestrator.service';
import { conferenciasDasEtapas, lerRevisao, RULE_REVIEW_REPORT, RULE_REVIEW_STEP } from './rule-review';
import { assinaturasDasFalhas, MARCADOR_RECUPERACAO, MAX_OCORRENCIAS_MESMA_FALHA, recorrenciasDasFalhas } from './recovery-signature';
import { capturasMotionDesatualizadas } from './motion-capture-freshness';
import { escreverArquivosDaMemoria, gravarNoProjeto } from '../memory/camadas';
import { descartarBancoDeTeste } from '../common/banco-de-teste';
import { avisarConversaQueParou } from '../conversations/jobs-da-conversa';
import { tipoDe } from '../accounts/connections';
import { automaticGoldfishDecision,AUTOMATIC_GOLDFISH_KIND,type AutoReviewRequest } from '../specialties/software/egm/automatic-review';
import { projectModel } from '../providers/project-model';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { assertEvaluationLease,LostStepLease,type EvaluationLease } from '../worker/executor/lease';
import { capabilityReference,orderedCapabilityCriteria,deferredCapabilityCriterion } from './workflow/capability-criteria';
import { SPECIALTY_HANDOFF_KIND,SPECIALTY_HANDOFF_NOTICE,specialtyHandoff } from './workflow/specialty-handoff';

export interface CriterionResult {
  key: string;
  kind: string;
  passed: boolean;
  pendingApproval?: boolean;
  verificationProblem?: VerificationProblem;
  evidence: Record<string, unknown>;
}

type CompletionJob=Prisma.JobGetPayload<{include:{steps:true,criteria:true,project:true}}>;
type CompletionReceipt={version:1;phase:'PREPARED'|'INCORPORATED'|'DELIVERED';contract:string;plan:IntegrationPlan;checks:CriterionResult[];
  memory:Prisma.MemoryEntryCreateArgs;publish:boolean;tag?:string;pushStatus?:'PENDING'|'CONFIRMED'|'ERROR';pushError?:string};
function completionContract(job:CompletionJob):string{
  return sha256(JSON.stringify([job.id,job.projectId,job.objectiveVersion,job.approvedScope,
    [...job.steps].sort((a,b)=>a.id.localeCompare(b.id)).map(s=>[s.id,s.status,s.attemptCount,s.resumeFromAttempt,s.instructions,s.provider,s.providerOptions,s.verifyCommand]),
    [...job.criteria].sort((a,b)=>a.id.localeCompare(b.id)).map(c=>[c.id,criterionHash(c)])]));
}
function readCompletion(value:unknown):CompletionReceipt|null{
  const x=value as Partial<CompletionReceipt>|null;
  return x?.version===1&&['PREPARED','INCORPORATED','DELIVERED'].includes(x.phase??'')&&typeof x.contract==='string'
    &&!!x.plan&&[x.plan.base,x.plan.source,x.plan.target,x.plan.tree].every(v=>typeof v==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v))
    &&typeof x.plan.changed==='boolean'&&Array.isArray(x.checks)&&x.checks.length>0&&x.checks.every(r=>r.passed===true)
    &&!!x.memory?.data&&typeof x.publish==='boolean'?x as CompletionReceipt:null;
}
const receiptJson=(x:CompletionReceipt)=>JSON.parse(JSON.stringify(x)) as Prisma.InputJsonValue;

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


// Reexportação para chamadas existentes e testes de regressão.
export { capturasMotionDesatualizadas } from './motion-capture-freshness';

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
    private readonly git: GitService,
    private readonly orchestrator: OrchestratorService,
    private readonly registry: ProviderRegistry,
  ) {}

  /**
   * A recuperação não limita quantos erros DIFERENTES podem ser corrigidos.
   * Evita loops ao interromper só após três ocorrências da MESMA falha,
   * identificada por sua evidência, preservando limites de orçamento/tempo.
   */
  private async corrigirCriterios(job: Job & { steps: Array<{ id: string; key: string; provider: string | null; status: string; dependsOn: string[]; order: number; verifyCommand: string | null; instructions: string; createdAt: Date }>; project: { provider: string; aiReserva?: unknown } }, falhas: CriterionResult[], criterios: AcceptanceCriterion[], worktree: string,lease?:EvaluationLease): Promise<boolean> {
    const ia = (id: string | null | undefined) => !!id && !!tipoDe(id);
    // Só trabalho feito por IA (o de comandos fixos não tem quem corrija) e só critério automático (o
    // subjetivo reprovado pelo usuário volta para ele, não para a IA).
    // Montagem pelo executor oficial: depois de produzir um MP4, uma revisão
    // reprovada não pode criar outra etapa de IA que remonte o mesmo arquivo.
    // A avaliação registra os critérios pendentes, mas preserva a versão existente
    // para o usuário ouvir e decidir se quer uma alteração explícita.
    if (job.steps.some(s => s.provider === 'juntar-videos')) {
      await this.logs.log(job.id,
        'Montagem de mídia já executada. Não criar etapa automática de remontagem após avaliação; preservar o MP4 e apresentar os critérios pendentes.',
        { source: 'evaluator', level: 'WARN' });
      return false;
    }
    const daIa = job.steps.filter((s) => s.key !== RULE_REVIEW_STEP).map((s) => s.provider ?? job.defaultProvider).filter(ia);
    if (!daIa.length) return false;
    if (falhas.some((f) => criterios.find((c) => c.key === f.key)?.kind === 'MANUAL_APPROVAL')) return false;
    const quem = daIa.includes(job.project.provider) ? job.project.provider : daIa[daIa.length - 1];
    const rodadas = job.steps.filter((s) => s.key.startsWith('correcao-criterios-')).length;
    // O número total serve apenas para nomear a próxima etapa: erros diferentes
    // podem ser corrigidos sucessivamente, sem teto global de correções.
    // Quando o código muda, uma captura anterior não valida a nova composição.
    const vencidas = capturasMotionDesatualizadas(worktree, job.steps);
    if (vencidas.length) {
      // Uma prévia antiga não invalida todas as etapas dependentes: isso
      // refazia direção de arte e renderização, consumindo tokens novamente.
      // Recapture somente os quadros; mantenha IA, motion e MP4 já concluídos.
      const refazer = new Set(vencidas);
      if (job.steps.some(s => s.key === RULE_REVIEW_STEP)) refazer.add(RULE_REVIEW_STEP);
      fs.rmSync(path.join(worktree, RULE_REVIEW_REPORT), {force:true});
      const qualityDir = path.join(worktree, 'out/qualidade');
      if (fs.existsSync(qualityDir)) for (const name of fs.readdirSync(qualityDir)) {
        if (/parecer.*\.json$/i.test(name)) fs.rmSync(path.join(qualityDir,name),{force:true});
      }
      await this.prisma.$transaction(async tx => {
        await OrchestratorService.lockJob(tx,job.id);
      await assertEvaluationLease(tx,lease);
        for (const key of refazer) {
          const step = job.steps.find(s=>s.key===key);
          if(step) await tx.step.update({where:{id:step.id},data:{status:'PENDENTE',statusDetail:'recapturar composição atualizada'}});
        }
        await tx.job.update({where:{id:job.id},data:{status:'EXECUTANDO',blockedReason:null,statusDetail:'recapturando quadros atualizados'}});
      });
      await this.logs.log(job.id, 'Recaptura por alteração visual: '+[...refazer].join(', '), {source:'evaluator',level:'INFO'});
      await this.orchestrator.scheduleReady(job.id);
      return true;
    }
    const correcoesAgora = job.steps.filter((s) => s.key.startsWith('correcao-criterios-')).sort((a, b) => b.order - a.order);
    // A identidade é por erro REAL (violação ou evidência de comando), não por
    // critério nem pelo número de correções: um novo defeito abre nova oportunidade.
    const violacoesAgora = falhas.some((f) => f.key === RULE_REVIEW_STEP) ? (lerRevisao(worktree)?.violacoes ?? []) : [];
    const assinaturas = assinaturasDasFalhas(falhas, violacoesAgora);
    const recorrencias = recorrenciasDasFalhas(job.steps, assinaturas);
    const persistentes = recorrencias.filter((f) => f.ocorrencias >= MAX_OCORRENCIAS_MESMA_FALHA);
    if (persistentes.length) {
      await this.logs.log(job.id,
        `Recuperação interrompida: o MESMO erro foi identificado ${MAX_OCORRENCIAS_MESMA_FALHA} vezes, mesmo após correções. ${persistentes.map((f) => f.descricao).join(' | ')}. Preservados o trabalho e os testes anteriores; não criar outra sessão em loop.`,
        { source: 'evaluator', level: 'WARN' });
      return false;
    }
    // Erro de responsabilidade exclusiva da plataforma: a IA do projeto não
    // controla os endpoints, a tela ou o navegador. Não repetir sessões inúteis.
    const somentePublicacao = falhas.every(f => f.key === RULE_REVIEW_STEP) &&
      violacoesAgora.length > 0 &&
      violacoesAgora.every(v => /(?:player|download|publica[çc][aã]o|v[ií]nculo|associa[çc][aã]o).*?(?:conversa|nivoo|backend|interface)|(?:conversa|nivoo|backend|interface).*?(?:player|download|publica[çc][aã]o|v[ií]nculo|associa[çc][aã]o)/i.test(v));
    if (somentePublicacao) {
      await this.logs.log(job.id,
        'Revisão cobra apenas publicação do player/download (responsabilidade do backend). Não criar outra sessão de IA para essa falha de plataforma.',
        { source: 'evaluator', level: 'WARN' });
      return false;
    }
    // A revisão pode relatar LIMITES DE EVIDÊNCIA (sem acesso à escuta ou ASR).
    // Nenhuma sessão adicional de edição é capaz de tornar o áudio "confirmado"
    // apenas reescrevendo pareceres. Diferenciar incerteza de defeito comprovado.
    const revisaoAtual = lerRevisao(worktree);
    const somenteRevisao = falhas.length > 0 && falhas.every(f => f.key === RULE_REVIEW_STEP);
    // Trabalhos de leitura/conferência não têm uma etapa capaz de remontar a mídia.
    // Uma violação verdadeira continua BLOQUEADA, mas não gera "corrigir relatório"
    // com IA, que nunca reexecutaria a montagem nem alteraria o MP4.
    const trabalhoDeConferencia = /confer[eê]ncia|revis[aã]o|auditoria|verifica[çc][aã]o/i.test(job.title) &&
      job.steps.filter(s => s.key !== RULE_REVIEW_STEP && !/^(correcao-criterios-|resposta-usuario-)/.test(s.key))
        .every(s => /^(medir|revisar|conferir|verificar|analisar|auditar)/i.test(s.key));
    if (somenteRevisao && trabalhoDeConferencia) {
      await this.logs.log(job.id,
        'Trabalho somente de conferência, sem etapa de remontagem: reprovado com evidência, mas sem abrir sessões de IA incapazes de corrigir a mídia.',
        { source: 'evaluator', level: 'WARN' });
      return false;
    }
    const incerta = (v: string) => /(?:falta|faltou|pendente|sem|n[aã]o (?:foi|consegui|consegue|é poss[ií]vel)|precisa|depende).{0,95}(?:confirm|escut|ouvir|audi[çc][aã]o|transcri[çc][aã]o|reconhecimento confi[aá]vel|verifica[çc][aã]o)|(?:ind[ií]cio|suspeita|prov[aá]vel|sem evid[eê]ncia)/i.test(v);
    if (somenteRevisao && revisaoAtual &&
        ((revisaoAtual.perguntas.length > 0 && violacoesAgora.every(incerta)) ||
         (violacoesAgora.length > 0 && violacoesAgora.every(incerta)))) {
      await this.logs.log(job.id,
        'Revisão parou por impossibilidade de confirmar escuta/sincronia, sem falha corrigível demonstrada. Não criar sessões de IA para reescrever o relatório; mostrar a pendência uma vez na revisão.',
        { source: 'evaluator', level: 'WARN' });
      return false;
    }
    // Uma ocorrência anterior da MESMA assinatura pede abordagem diferente/IA
    // reserva. Uma falha nova não herda a repetição de outra.
    const repetidas = Math.max(0, ...recorrencias.map((f) => f.ocorrencias - 1));
    // Cobrança repetida: outra IA conectada (reservas do projeto, depois as que já trabalharam neste trabalho) tenta.
    let quemCorrige = quem;
    if (repetidas > 0) {
      const anterior = correcoesAgora[0].provider ?? quem;
      const candidatas = [...new Set([...(Array.isArray(job.project.aiReserva) ? (job.project.aiReserva as unknown[]).map(String) : []), ...daIa, job.project.provider])].filter((id) => id !== anterior && ia(id) && this.registry.has(id));
      for (const id of candidatas) {
        const st = await this.registry.status(id, 60_000).catch(() => null);
        if (st?.available) {
          quemCorrige = id;
          break;
        }
      }
    }
    const key = `correcao-criterios-${rodadas + 1}`;
    const linhas = falhas.map((f) => {
      const c = criterios.find((x) => x.key === f.key);
      const ev = (f.evidence ?? {}) as Record<string, unknown>;
      // Saída do comando pelo FIM (onde está o erro do teste/build); o resto da evidência resumido.
      const saida = [ev.stdout, ev.stderr].filter((x) => typeof x === 'string' && x).join('\n').slice(-3000);
      const resto = JSON.stringify({ ...ev, stdout: undefined, stderr: undefined }).slice(0, 600);
      return `- ${f.key} — ${c?.description ?? ''}\n  evidência: ${resto}${saida ? `\n  saída do comando (fim):\n${saida}` : ''}`;
    });
    // A revisão independente apontou violações: elas são o que corrigir (o relatório antigo sai; a revisão roda de novo).
    const revisao: string[] = [];
    if (falhas.some((f) => f.key === RULE_REVIEW_STEP)) {
      const arq = path.join(worktree, RULE_REVIEW_REPORT);
      const v = lerRevisao(worktree)?.violacoes ?? [];
      // "Não conforme" sem nenhuma violação apontada = só dúvidas para o usuário: corrigir não resolve (rodaria
      // várias vezes à toa). Se é a única falha, para e mostra as perguntas (o usuário responde ou aceita assim mesmo).
      if (!v.length && falhas.every((f) => f.key === RULE_REVIEW_STEP)) {
        await this.logs.log(job.id, 'A revisão não apontou nada para corrigir, só dúvidas: o trabalho espera a sua decisão (responder ou aceitar assim mesmo)', { source: 'evaluator', level: 'WARN' });
        return false;
      }
      try {
        const r = JSON.parse(fs.readFileSync(arq, 'utf8'));
        revisao.push('', 'A REVISÃO INDEPENDENTE apontou estas violações (corrija cada uma no trabalho):', ...v.slice(0, 40).map((x) => `- ${x.slice(0, 800)}`));
        if (r.observacoes) revisao.push(`Observações da revisão: ${String(r.observacoes).slice(0, 1500)}`);
      } catch {
        /* sem relatório legível: segue só com o critério */
      }
    }
    // A revisão roda de novo depois da correção: o relatório antigo sai SEMPRE (senão um "conforme" velho passaria
    // pela conferência da etapa de revisão mesmo sem ela gravar nada novo).
    if (job.steps.some((s) => s.key === RULE_REVIEW_STEP)) fs.rmSync(path.join(worktree, RULE_REVIEW_REPORT), { force: true });
    // A etapa só termina quando os mesmos critérios passam (comandos e arquivos verificáveis aqui mesmo).
    const confereCriterios = falhas
      .filter((f) => f.key !== RULE_REVIEW_STEP) // a conformidade é dada pela revisão, que roda de novo depois
      .map((f) => criterios.find((x) => x.key === f.key))
      .map((c) => {
        const cfg = (c?.config ?? {}) as Record<string, unknown>;
        if (c?.kind === 'COMMAND' && typeof cfg.command === 'string') return `( ${cfg.command} )`;
        if (c?.kind === 'FILE_EXISTS' && typeof cfg.path === 'string') return `test -e '${String(cfg.path).replace(/'/g, '')}'`;
        return null;
      })
      .filter(Boolean) as string[];
    // Depois da correção, as conferências das etapas (testes, build, fotos) rodam de novo: a correção não pode
    // quebrar o que já passava, e a revisão precisa de evidência nova.
    // Capability acceptance belongs to final evaluation, not the repair slice.
    // Other jobs keep their existing verification behavior.
    const capabilityJob=criterios.some(c=>capabilityReference(c.config));
    const confere = capabilityJob ? 'git diff --check HEAD' : [...new Set([...confereCriterios, ...conferenciasDasEtapas(job.steps)])].join(' && ') || 'true';
    const review = job.steps.find((s) => s.key === RULE_REVIEW_STEP);
    const base = Math.max(...job.steps.map((s) => s.order)) + 1;
    await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, job.id);
      await assertEvaluationLease(tx,lease);
      await tx.step.create({
        data: {
          jobId: job.id, key, order: review ? review.order : base, provider: quemCorrige, dependsOn: job.steps.filter((s) => s.key !== RULE_REVIEW_STEP).map((s) => s.key),
          title: 'Corrigir o que a conferência final cobrou',
          instructions: [
            `${MARCADOR_RECUPERACAO}${assinaturas.map((f) => f.hash).join(',')}`,
            'O trabalho terminou as etapas, mas a conferência final do sistema NÃO passou nestes critérios:',
            ...linhas,
            ...revisao,
            ...(repetidas > 0
              ? [
                  '',
                  `ATENÇÃO: a MESMA falha concreta já apareceu ${repetidas + 1} vez(es) nesta avaliação. Não confunda com outras falhas já resolvidas.`,
                  'Não repita o que já foi tentado: veja o que mudou (git log -p nesta pasta) e o que a revisão diz que ainda falta, e',
                  'MUDE A ABORDAGEM. Se a cobrança é de evidência executada pelo sistema, a evidência precisa estar no lugar que a',
                  'conferência roda (testes do projeto ou nivoo-roteiros/) — um script solto em outra pasta não conta.',
                ]
              : []),
            '',
            'Corrija o trabalho (arquivos do projeto) para que esses critérios passem, mantendo o que já foi feito e as regras do projeto.',
            ...(capabilityJob?['O comando desta etapa é uma verificação técnica mínima de diff, não aceitação. A avaliação final executará os critérios aprovados quando a correção estiver integrada. Preserve os testes úteis como regressão e não modifique o contrato para esconder gaps.']:[]),
            'Faça o trabalho de verdade (ex.: se um inventário ou relatório ficou vazio, preencha com o conteúdo real, lendo os arquivos).',
            'Teste de interação que o sistema precisa executar (foco, digitação, troca de sessão, resposta atrasada da rede…) vai em',
            'nivoo-roteiros/: roteiro .json (com "atrasar"/"falharRede" para rede lenta ou com erro) ou script .cjs/.mjs com o',
            'navegador sem tela — a conferência liga o sistema e roda TODOS eles. Script em outra pasta não roda na conferência.',
            'Não pergunte ao usuário como rodar conferências: isso é do sistema.',
            'Não altere os critérios nem contorne a conferência. Antes de achar que falta informação, leia a conversa do pedido',
            '(contexto/conversa-do-pedido.md), a memória (.nivoo/memoria.md) e out/respostas-do-usuario.md. Se ainda faltar algo que só o',
            'usuário tem, faça a melhor versão possível, registre a dúvida em out/perguntas-ao-usuario.md COM as respostas possíveis',
            '(2 a 4 opções) e siga — não pare o trabalho por isso.',
          ].join('\n'),
          verifyCommand: confere,
        },
      });
      if (review) await tx.step.update({ where: { id: review.id }, data: { status: 'PENDENTE', order: base + 1, dependsOn: [...new Set([...review.dependsOn, key])], statusDetail: 'correção: conferir de novo' } });
      await tx.job.update({ where: { id: job.id }, data: { status: 'EXECUTANDO', blockedReason: null, statusDetail: `corrigindo o que a conferência final cobrou (rodada ${correcoesAgora.length + 1}${repetidas ? ', mudando a abordagem' : ''})` } });
    });
    await this.logs.log(job.id, `Conferência final não passou (${falhas.map((f) => f.key).join(', ')}): a IA corrige sozinha (rodada ${correcoesAgora.length + 1}${repetidas ? `; falha concreta repetida: mudar abordagem${quemCorrige !== (correcoesAgora[0]?.provider ?? quem) ? ` e passar para ${quemCorrige}` : ''}` : '; falha diferente das anteriores'})`, { source: 'evaluator', level: 'WARN' });
    await this.orchestrator.scheduleReady(job.id);
    return true;
  }

  async evaluate(jobId: string,lease?:EvaluationLease): Promise<EvaluationReport> {
    await this.prisma.$transaction(tx=>assertEvaluationLease(tx,lease));
    const job = await this.prisma.job.findUniqueOrThrow({
      where: { id: jobId },
      include: { steps: true, criteria: true, project: true },
    });
    const report: EvaluationReport = { jobId, finalStatus: job.status, pendingSteps: [], criteria: [], pendencias: [] };
    const saved=readCompletion(job.completionState);
    if(saved){
      if(saved.phase==='DELIVERED'&&job.status==='CONCLUIDO'&&saved.pushStatus!=='ERROR'){report.criteria=saved.checks;return report;}
      if(saved.contract!==completionContract(job))return this.blockGoldfishEvaluation(job,report,'O contrato mudou após preparar a incorporação. Recibo anterior preservado; não publicar automaticamente.',lease);
      if(saved.phase==='PREPARED'&&['EXECUTANDO','AGUARDANDO_APROVACAO','AGUARDANDO_RECURSO'].includes(job.status))
        return this.finishCompletion(job,report,saved,lease);
      if(['INCORPORATED','DELIVERED'].includes(saved.phase)&&job.status==='CONCLUIDO')
        return this.finishCompletion(job,report,saved,lease);
    }else if(job.completionState!=null)throw Error('Recibo de conclusão inválido; não repetir a incorporação.');
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

    let egm:ApprovedGoldfishResolution|null=null;
    let repo='';
    try{
      egm=approvedGoldfish(job.approvedScope);
      if(egm){
        repo=this.workspace.projectDirs(job.project.dirKey).repo;
        if(!egm.proofs)throw Error('Correção Goldfish sem contrato de regressão individual. Atualize o plano; nenhuma evidência será presumida.');
        assertGoldfishProofContracts(egm.proofs,job.criteria);
        if(job.steps.length!==egm.steps.length)throw Error('Etapas divergentes do contrato de resolução aprovado.');
        for(const step of job.steps)checkApprovedGoldfishStep(egm,step);
        const drift=await detectGoldfishGitDrift(repo,egm.revision,egm.targetPath);
        if(drift.status!=='unchanged')throw Error(renderGoldfishGitDrift(drift));
      }
    }catch(e){return this.blockGoldfishEvaluation(job,report,(e as Error).message,lease);}
    let worktree:string;
    try{worktree=egm?await this.workspace.ensureJobWorktree(job.project.dirKey,job.id,egm.revision):await this.workspace.ensureJobWorktree(job.project.dirKey,job.id);}
    catch(e){if(!egm)throw e;return this.blockGoldfishEvaluation(job,report,(e as Error).message,lease);}
    let status: 'CONCLUIDO' | 'AGUARDANDO_APROVACAO' | 'BLOQUEADO' = 'BLOQUEADO';
    let reason: string | null = null;
    let completion: Awaited<ReturnType<CompletionService['prepareCompletion']>> | null = null;
    let prepared:CompletionReceipt|null=null;
    // Os critérios são verificados sobre o resultado JÁ INTEGRADO à pasta principal do projeto; só então
    // a pasta principal avança. Se outro job mudou a pasta principal no meio, integra e verifica de novo.
    for (let rodada = 1; ; rodada++) {
      await this.prisma.$transaction(tx=>assertEvaluationLease(tx,lease));
      const sync = await this.workspace.syncWithMain(worktree, `job ${job.id}: integra a pasta principal do projeto`);
      if (!sync.ok) return this.blockConflict(job, report, sync.files,lease);
      report.criteria = [];
      report.pendencias = [];
      const verifiedTree=egm?await this.workspace.repairSourceHash(worktree):null;
      const evaluated=new Map<string,boolean>();
      const deferred:string[]=[];
      let environmentFailure:VerificationProblem|undefined;
      for (const c of orderedCapabilityCriteria(job.criteria)) {
        const wait=environmentFailure?'aguarda resolução da falha do ambiente de verificação':deferredCapabilityCriterion(c,evaluated,job.criteria);
        if(wait){
          deferred.push(c.key+': '+wait);
          await this.prisma.$transaction(async tx=>{await OrchestratorService.lockJob(tx,jobId);await assertEvaluationLease(tx,lease);await tx.acceptanceCriterion.update({where:{id:c.id},data:{status:'PENDENTE',lastCheckedAt:null}});});
          continue; // No invented failed/pass evidence; this check was not executed.
        }
        await this.prisma.$transaction(tx=>assertEvaluationLease(tx,lease));
        const r = egm?await this.check(job,c,worktree,egm.proofs!.filter(p=>p.criterionKey===c.key),lease):await this.check(job,c,worktree,[],lease);
        evaluated.set(c.key,r.passed);
        if(r.verificationProblem)environmentFailure=r.verificationProblem;
        report.criteria.push(r);
        const ev = await this.artifacts.storeContent(
          { projectId: job.projectId, jobId, name: `criterios/${c.key}.evidencia.json`, kind: 'CRITERION_EVIDENCE' },
          JSON.stringify({ criterio: c.key, tipo: c.kind, aprovado: r.passed, aguardandoAprovacao: !!r.pendingApproval, evidencia: r.evidence, verificadoEm: new Date().toISOString() }, null, 2),
        );
        await this.prisma.$transaction(async tx=>{
        await OrchestratorService.lockJob(tx,jobId);await assertEvaluationLease(tx,lease);
        await tx.criterionCheck.create({
          data: { jobId, criterionId: c.id, passed: r.passed, evidence: r.evidence as Prisma.InputJsonValue, artifactId: ev.id },
        });
        await tx.acceptanceCriterion.update({
          where: { id: c.id },
          data: { status: r.passed ? 'APROVADO' : r.pendingApproval ? 'AGUARDANDO_APROVACAO' : 'REPROVADO', lastCheckedAt: new Date() },
        });
        });
      }

      const failed = report.criteria.filter((c) => !c.passed && !c.pendingApproval);
      const waiting = report.criteria.filter((c) => c.pendingApproval);
      reason = null;
      if (job.criteria.length === 0) {
        status = 'BLOQUEADO';
        reason = BlockedReason.SEM_CRITERIOS;
        report.pendencias.push('job sem critérios de aceitação verificáveis: conclusão não permitida');
      } else if (environmentFailure) {
        status = 'BLOQUEADO';
        reason = BlockedReason.VERIFICACAO_IMPOSSIVEL;
        report.pendencias.push('Verificação indisponível ('+environmentFailure.kind+'): '+environmentFailure.detail+'. Resultado preservado. Nenhuma sessão de IA será aberta para corrigir o ambiente.');
      } else if (failed.length > 0) {
        status = 'BLOQUEADO';
        reason = BlockedReason.CRITERIOS_NAO_ATENDIDOS;
        report.pendencias.push(...failed.map((f) => `critério não atendido: ${f.key} — ${JSON.stringify(f.evidence).slice(0, 300)}`));
      } else if (deferred.length > 0) {
        status = 'BLOQUEADO';
        reason = BlockedReason.CRITERIOS_NAO_ATENDIDOS;
      } else if (waiting.length > 0) {
        status = 'AGUARDANDO_APROVACAO';
        report.pendencias.push(...waiting.map((w) => `aguardando aprovação explícita: ${w.key}`));
      } else {
        status = 'CONCLUIDO';
      }
      report.pendencias.push(...deferred.map(d=>'critério ainda não executado: '+d));
      if (status === 'BLOQUEADO' && reason === BlockedReason.CRITERIOS_NAO_ATENDIDOS && failed.length && !egm) {
        if (await this.corrigirCriterios(job as never, failed, job.criteria, worktree,lease)) {
          report.finalStatus = 'EXECUTANDO';
          return report;
        }
      }
      if (status !== 'CONCLUIDO') break;

      // A proof only describes the tree on which its command ran. Test side
      // effects must not silently change the tracked result before publication.
      if(egm&&verifiedTree!==await this.workspace.repairSourceHash(worktree))return this.blockGoldfishEvaluation(job,report,'A árvore mudou durante a verificação dos achados. Evidências anteriores não cobrem a árvore atual; arquivos preservados.',lease);
      // Resultados reproduzíveis preparados ANTES e gravados na MESMA transação da conclusão.
      completion = await this.prepareCompletion(job, worktree);
      if(egm&&verifiedTree!==await this.workspace.repairSourceHash(worktree))return this.blockGoldfishEvaluation(job,report,'A árvore mudou na preparação da publicação. Evidências preservadas, sem incorporação.',lease);
      prepared=await this.prisma.$transaction(async tx=>{
        await OrchestratorService.lockJob(tx,job.id);await assertEvaluationLease(tx,lease);
        await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${'incorporar:'+job.projectId}))) AS l`;
        const fresh=await tx.job.findUniqueOrThrow({where:{id:job.id},include:{steps:true,criteria:true,project:true}});
        if(completionContract(fresh)!==completionContract(job)||!['EXECUTANDO','AGUARDANDO_APROVACAO','AGUARDANDO_RECURSO'].includes(fresh.status))throw new LostStepLease();
        const plan=await this.workspace.prepareIntegration(job.project.dirKey,job.id,await this.commitMessage(job),egm?.revision);
        if(!plan)return null;
        const receipt:CompletionReceipt={version:1,phase:'PREPARED',contract:completionContract(job),plan,checks:report.criteria,memory:completion!.memory,
          publish:!!(plan.changed&&job.project.gitAutoPush&&job.project.gitUrl)};
        await tx.job.update({where:{id:job.id},data:{completionState:receiptJson(receipt)}});
        return receipt;
      },{timeout:120_000,maxWait:120_000});
      if(prepared)return this.finishCompletion(job,report,prepared,lease);
      if(egm){
        const drift=await detectGoldfishGitDrift(repo,egm.revision,egm.targetPath);
        return this.blockGoldfishEvaluation(job,report,renderGoldfishGitDrift(drift)+'\nIncorporação não confirmada; não repetir automaticamente.',lease);
      }
      if (rodada >= 3) return this.blockConflict(job, report, ['a pasta principal mudou repetidamente durante a verificação; retome o job'],lease);
      await this.logs.log(jobId, 'A pasta principal do projeto mudou durante a verificação: integrando de novo e reverificando os critérios', { source: 'evaluator', level: 'WARN' });
    }

    const detail = report.pendencias.length ? report.pendencias.join('\n') : 'todos os critérios verificados com evidências; resultado incorporado à pasta principal do projeto';
    const updated = await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, jobId);
      await assertEvaluationLease(tx,lease);
      const r = await tx.job.updateMany({
        where: { id: jobId, status: { in: ['EXECUTANDO', 'AGUARDANDO_APROVACAO', 'AGUARDANDO_RECURSO'] } },
        data: {
          status,
          blockedReason: reason,
          statusDetail: detail,
          finishedAt: status === 'CONCLUIDO' ? new Date() : null,

        },
      });

      // Trabalho concluído: as lições das tentativas que falharam nele perderam o sentido (o problema foi resolvido).
      if (r.count && status === 'CONCLUIDO') {
        await tx.memoryEntry.deleteMany({
          where: { projectId: job.projectId, AND: [{ references: { path: ['origem'], equals: 'licao-automatica' } }, { references: { path: ['jobId'], equals: job.id } }] },
        });
      }
      return r.count;
    });
    report.finalStatus = updated ? status : (await this.prisma.job.findUniqueOrThrow({ where: { id: jobId } })).status;
    // Versão nova só quando o trabalho mudou arquivos (trabalho sem mudança não gera tag vazia).

    if (updated) await escreverArquivosDaMemoria(this.prisma, job.projectId);
    if (updated && status === 'BLOQUEADO') await avisarConversaQueParou(this.prisma, job.id, detail);
    // Fim do trabalho (concluído ou parado na conferência final): limpeza de dependências e caches da pasta do trabalho.
    if (updated && status !== 'AGUARDANDO_APROVACAO' && !(report.finalStatus === 'EXECUTANDO')) {
      const limpo = await this.workspace.limparLixoDeExecucao(path.join(this.workspace.projectDirs(job.project.dirKey).worktrees, job.id)).catch(() => null);
      if (await descartarBancoDeTeste(job.id)) await this.logs.log(jobId, 'Banco de teste do trabalho apagado', { source: 'evaluator' });
      if (limpo?.removidos.length) await this.logs.log(jobId, `Limpeza: ${limpo.removidos.join(', ')} apagado(s) da pasta do trabalho (${limpo.mb} MB; são só instalação/cache)`, { source: 'evaluator' });
    }
    await this.logs.log(jobId, `Avaliação de conclusão: ${report.finalStatus}. ${detail}`, {
      source: 'evaluator',
      level: status === 'CONCLUIDO' ? 'INFO' : 'WARN',
    });
    return report;
  }

  /** The exact Git target and verified criteria survive worker restart. No
   * provider, verification or merge is repeated after a confirmed receipt. */
  private async finishCompletion(job:CompletionJob,report:EvaluationReport,initial:CompletionReceipt,lease?:EvaluationLease):Promise<EvaluationReport>{
    let state=initial;
    report.criteria=state.checks;
    if(state.phase==='PREPARED'){
      const applied=await this.prisma.$transaction(async tx=>{
        await OrchestratorService.lockJob(tx,job.id);await assertEvaluationLease(tx,lease);
        await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${'incorporar:'+job.projectId}))) AS l`;
        const fresh=await tx.job.findUniqueOrThrow({where:{id:job.id},include:{steps:true,criteria:true,project:true}});
        const actual=readCompletion(fresh.completionState);
        if(actual?.phase!=='PREPARED'||actual.plan.target!==state.plan.target||completionContract(fresh)!==state.contract)throw new LostStepLease();
        if(!['EXECUTANDO','AGUARDANDO_APROVACAO','AGUARDANDO_RECURSO'].includes(fresh.status))throw new LostStepLease();
        if(!await this.workspace.applyIntegration(job.project.dirKey,job.id,state.plan))return false;
        const next:CompletionReceipt={...state,phase:'INCORPORATED'};
        await tx.job.update({where:{id:job.id},data:{status:'CONCLUIDO',blockedReason:null,statusDetail:'Critérios verificados; commit incorporado.',finishedAt:new Date(),
          mergedCommit:state.plan.target,mergeStatus:'INCORPORADO',completionState:receiptJson(next)}});
        await tx.memoryEntry.create(state.memory);
        await tx.memoryEntry.deleteMany({where:{projectId:job.projectId,AND:[{references:{path:['origem'],equals:'licao-automatica'}},{references:{path:['jobId'],equals:job.id}}]}});
        state=next;
        return true;
      },{timeout:120_000,maxWait:120_000});
      if(!applied)return this.blockConflict(job,report,['main divergente ou com alterações locais; recibo Git preservado, sem nova incorporação automática'],lease);
    }
    report.finalStatus='CONCLUIDO';report.pendencias=[];
    const write=async(next:CompletionReceipt)=>{
      await this.prisma.$transaction(async tx=>{
        await OrchestratorService.lockJob(tx,job.id);await assertEvaluationLease(tx,lease);
        const current=await tx.job.findUniqueOrThrow({where:{id:job.id},select:{completionState:true,status:true,mergedCommit:true}});
        if(current.status!=='CONCLUIDO'||current.mergedCommit!==next.plan.target||readCompletion(current.completionState)?.plan.target!==next.plan.target)throw new LostStepLease();
        await tx.job.update({where:{id:job.id},data:{completionState:receiptJson(next)}});
      });
      state=next;
    };
    await escreverArquivosDaMemoria(this.prisma,job.projectId);
    // Delivery itself is idempotent. Do it before remote push so a slow or
    // unavailable Git server does not conceal a completed local result.
    if(state.phase!=='DELIVERED'){
      await this.prisma.$transaction(tx=>assertEvaluationLease(tx,lease));
      const fresh=await this.prisma.job.findUniqueOrThrow({where:{id:job.id}});
      const folder=await this.artifacts.guardarNaPastaDoProjeto(this.workspace.projectDirs(job.project.dirKey).root,fresh);
      if(folder)await this.logs.log(job.id,'Resultados guardados na pasta do projeto: '+folder,{source:'evaluator'});
      await this.pedirEntrega(job,state.plan.target,state.checks,state.plan.changed);
      await this.workspace.limparLixoDeExecucao(path.join(this.workspace.projectDirs(job.project.dirKey).worktrees,job.id)).catch(()=>null);
      await descartarBancoDeTeste(job.id);
      await write({...state,phase:'DELIVERED'});
    }
    if(state.publish&&state.pushStatus!=='CONFIRMED'){
      try{
        if(!state.tag){
          // Persist the name BEFORE sending any external Git operation.
          const tag=await this.git.proximaVersao(job.projectId);
          await write({...state,tag,pushStatus:'PENDING'});
        }
        await this.prisma.$transaction(tx=>assertEvaluationLease(tx,lease));
        await this.git.publishExactVersion(job.projectId,state.tag!,state.plan.target,job.title);
        await write({...state,pushStatus:'CONFIRMED',pushError:undefined});
        await this.logs.log(job.id,'Versão '+state.tag+' confirmada no Git.',{source:'git'});
      }catch(e){
        if(e instanceof LostStepLease)throw e;
        const detail=String((e as Error).message??e).slice(0,500);
        await write({...state,pushStatus:'ERROR',pushError:detail});
        await this.logs.log(job.id,'Resultado local concluído; envio Git não confirmado. '+detail,{source:'git',level:'WARN'});
        report.pendencias.push('Envio Git não confirmado: '+detail);
      }
    }
    return report;
  }

  /** Mensagem do commit do trabalho na pasta principal (e no repositório Git, se ligado). */
  private async commitMessage(job: Job & { title: string }): Promise<string> {
    const obj = await this.prisma.jobObjectiveVersion.findFirst({ where: { jobId: job.id }, orderBy: { version: 'desc' } });
    const objetivo = (obj?.text ?? '').trim();
    return [job.title, '', objetivo.length > 1500 ? `${objetivo.slice(0, 1500)}…` : objetivo, '', `Nivoo: trabalho ${job.id} — critérios verificados e conferência das regras aprovada.`].join('\n');
  }

  /** Envio automático ao Git depois de concluir. Falha não desfaz a conclusão: vira aviso e pendência. */
  /**
   * Entrega na conversa (padrão, qualquer IA): o trabalho aprovado no chat terminou → a IA volta sozinha com o
   * que fez, onde estão os arquivos e as perguntas que dependem do usuário, numeradas, com recomendação.
   */
  private async pedirEntrega(job:Job & {project:{dirKey:string}},mergedCommit:string|null,checks:CriterionResult[],changed=false): Promise<void> {
    const jobId=job.id;
    const files=mergedCommit?await this.workspace.arquivosDoCommit(job.project.dirKey,mergedCommit):[];
    const handoff=specialtyHandoff(job.approvedScope,job.projectId,files);
    const plano = await this.prisma.conversationMessage.findFirst({ where: { jobId, kind: 'plano' }, select: { conversationId: true } });
    if (!plano) return;
    const approved=checks.filter(c=>c.passed);
    const criteria=await this.prisma.acceptanceCriterion.findMany({where:{jobId}});
    const adoption=adoptionSummaries(criteria);
    const completedSteps=await this.prisma.step.findMany({where:{jobId,status:'CONCLUIDO'},select:{id:true,status:true,attemptCount:true}});
    const successfulAttempts=completedSteps.length?await this.prisma.attempt.findMany({where:{jobId,status:'SUCESSO',OR:completedSteps.map(s=>({stepId:s.id,number:s.attemptCount}))},select:{stepId:true,number:true,status:true,contextStats:true}}):[];
    const skillSummary=summarizeSkillEvidence(completedSteps,successfulAttempts);
    const initial=changed&&mergedCommit?await this.prisma.attempt.findFirst({where:{jobId},orderBy:{startedAt:'asc'},select:{contextStats:true}}):null;
    const lite=(initial?.contextStats as {egmExecution?:{route?:string;baseline?:{complete?:boolean;dirty?:string[]}}}|null)?.egmExecution;
    const liteNotice=lite?.route==='lite'&&lite.baseline?.complete&&lite.baseline.dirty?.length===0&&!approvedGoldfish(job.approvedScope)?'Revisão independente Lite do diff incorporado (sujeita à validação da base): /goldfish-lite diff '+jobId:'';
    const egmProofLines=approvedGoldfish(job.approvedScope)?checks.flatMap(c=>{
      const p=c.evidence.egmProof as {observed?:{actionId:string;scenario:string}[]}|undefined;
      return c.passed?(p?.observed??[]).map(e=>'- '+e.actionId+' — cenário registrado no teste '+c.key+': '+e.scenario):[];
    }):[];
    const content=[handoff?SPECIALTY_HANDOFF_NOTICE:'Trabalho concluído. Resultado incorporado à pasta principal do projeto.', 'Critérios deste trabalho verificados pelo Nivoo: '+approved.length+' de '+checks.length+'.', ...adoption,...skillSummary,...(liteNotice?[liteNotice]:[]),...(egmProofLines.length?['Evidências de regressão Goldfish (contratos executados, não revisão semântica independente):',...egmProofLines]:[]), ...approved.slice(0,20).map(c=>'- '+c.key+' ('+c.kind+')'), ...(approved.length>20?['… demais critérios no relatório do trabalho.']:[]), 'Este estado comprova os critérios registrados do trabalho, não a aceitação automática de uma capacidade ou de todo o software. Os arquivos e as prévias estão disponíveis abaixo.'].join('\n');
    // A entrega é determinística: os arquivos e quadros reais já são exibidos pela interface.
    // Nunca iniciar uma segunda sessão de IA só para repetir o pedido de aprovação.
    // Também evita nova entrega se uma avaliação for repetida.
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${plano.conversationId} FOR UPDATE`;
      const existente = await tx.conversationMessage.findFirst({ where: { jobId, kind: 'entrega' }, select: { id: true } });
      if (existente) return;
      let automatic:AutoReviewRequest|null=null;
      let automaticNotice='';
      const scope=readApprovedScope(job.approvedScope,job.projectId);
      if(scope&&changed&&mergedCommit&&!handoff&&criteria.some(c=>capabilityReference(c.config))){
        // Serialize automatic review admission across this project's conversations.
        await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${job.projectId} FOR UPDATE`;
        const current=await tx.project.findUnique({where:{id:job.projectId},include:{area:true}});
        if(current){
          const decision=automaticGoldfishDecision({projectId:job.projectId,area:current.area,approvedScope:job.approvedScope,criteria,passedKeys:new Set(approved.map(c=>c.key)),files,revision:mergedCommit,providerType:tipoDe(current.provider),budgetConfigured:current.maxCostUsd!==null,specialtyHandoff:!!handoff});
          if(decision.kind==='skip')automaticNotice='Goldfish automático não acionado: '+decision.reason+'.';
          else{
            const conversation=await tx.conversation.findFirst({where:{id:plano.conversationId,projectId:job.projectId,archivedAt:null}});
            const newer=await tx.conversationMessage.findFirst({where:{conversationId:plano.conversationId,OR:[{role:'USUARIO',createdAt:{gt:new Date(scope.cutoff)}},{status:'PENDENTE'},{kind:'plano',createdAt:{gt:new Date(scope.approvedAt)}}]},select:{id:true}});
            const prior=await tx.conversationMessage.findFirst({where:{conversation:{projectId:job.projectId},OR:[{AND:[{goldfishState:{path:['automaticRequest','revision'],equals:mergedCommit}},{goldfishState:{path:['automaticRequest','targetPath'],equals:decision.targetPath}}]},{status:'PRONTA',AND:[{goldfishState:{path:['binding','revision'],equals:mergedCommit}},{goldfishState:{path:['resolution','targetPath'],equals:decision.targetPath}},{goldfishState:{path:['resolution','ready'],equals:true}},{OR:[{goldfishState:{path:['binding','preset'],equals:7}},{goldfishState:{path:['binding','preset'],equals:'feature_spec'}},{goldfishState:{path:['binding','preset'],equals:'uninterrupted'}}]}]}]},select:{id:true}});
            if(!conversation||newer||prior)automaticNotice='Goldfish automático não acionado: conversa alterada, arquivada ou revisão já registrada.';
            else{
              automatic={version:1,jobId,projectId:job.projectId,conversationId:plano.conversationId,revision:mergedCommit,targetPath:decision.targetPath,preset:decision.preset,providerId:current.provider,model:projectModel(current,current.provider)??null};
              automaticNotice='Goldfish automático: revisão crítica pontual da fase 7 enfileirada, complementar à entrega; não equivale a aprovação independente nem impede uso do resultado.';
            }
          }
        }
      }
      await tx.conversationMessage.create({
        data: {
          conversationId: plano.conversationId,
          role: 'ASSISTENTE',
          content:automaticNotice?content+'\n\n'+automaticNotice:content,
          status: 'PRONTA',
          kind: 'entrega',
          jobId,
        },
      });
      if(automatic){
        const latest=await tx.conversationMessage.findFirst({where:{conversationId:plano.conversationId},orderBy:{createdAt:'desc'},select:{createdAt:true}});
        const createdAt=new Date(Math.max(Date.now(),(latest?.createdAt.getTime()??0)+1));
        const next=await tx.conversationMessage.create({data:{conversationId:plano.conversationId,role:'ASSISTENTE',status:'PENDENTE',kind:AUTOMATIC_GOLDFISH_KIND,jobId,content:'Revisão crítica automática do contrato '+automatic.targetPath,createdAt,goldfishState:{automaticRequest:automatic} as unknown as Prisma.InputJsonValue}});
        await tx.queueTask.create({data:{type:'PLAN_MESSAGE',messageId:next.id}});
        await tx.conversation.update({where:{id:plano.conversationId},data:{updatedAt:createdAt}});
      }
      if(handoff&&handoff.conversationId===plano.conversationId){
        const conversation=await tx.conversation.findFirst({where:{id:plano.conversationId,projectId:job.projectId,archivedAt:null}});
        const later=await tx.conversationMessage.findFirst({where:{conversationId:plano.conversationId,OR:[{role:'USUARIO',createdAt:{gt:new Date(handoff.cutoff)}},{status:'PENDENTE'},{kind:'plano',createdAt:{gt:new Date(handoff.approvedAt)}}]},select:{id:true}});
        if(conversation&&!later){
          const latest=await tx.conversationMessage.findFirst({where:{conversationId:plano.conversationId},orderBy:{createdAt:'desc'},select:{createdAt:true}});
          const createdAt=new Date(Math.max(Date.now(),(latest?.createdAt.getTime()??0)+1));
          const next=await tx.conversationMessage.create({data:{conversationId:plano.conversationId,role:'ASSISTENTE',status:'PENDENTE',kind:SPECIALTY_HANDOFF_KIND,jobId,content:'',createdAt}});
          await tx.queueTask.create({data:{type:'PLAN_MESSAGE',messageId:next.id}});
          await tx.conversation.update({where:{id:plano.conversationId},data:{updatedAt:createdAt}});
        }
      }
    });
  }

  /** Versionamento padrão: tag da próxima versão + push (o commit já entrou na pasta principal). */
  private async autoPush(job: Job & { title: string }): Promise<void> {
    const avisar = async (texto: string) => {
      const origem = await this.prisma.conversationMessage.findFirst({ where: { jobId: job.id }, select: { conversationId: true } });
      if (origem) await this.prisma.conversationMessage.create({ data: { conversationId: origem.conversationId, role: 'ASSISTENTE', status: 'PRONTA', kind: 'sistema', content: texto, jobId: job.id } });
    };
    try {
      const r = await this.git.versionar(job.projectId, `${job.title}`);
      const texto = `Versão ${r.tag} enviada ao Git (commit + tag + push)${r.atualizou ? '; antes, trouxe as novidades que já estavam no repositório' : ''}.`;
      await this.logs.log(job.id, texto, { source: 'git' });
      await avisar(texto);
    } catch (e: any) {
      const motivo = String(e?.response?.message ?? e?.message ?? e);
      await this.logs.log(job.id, `Envio automático ao Git falhou: ${motivo}`, { source: 'git', level: 'WARN' });
      await gravarNoProjeto(this.prisma, { projectId: job.projectId, category: 'PENDENCIA', title: 'Envio ao Git pendente', content: `O trabalho "${job.title}" foi concluído, mas o envio automático ao Git falhou: ${motivo}. Use "Enviar para o Git".`, references: { jobId: job.id, origem: 'git' }, author: 'sistema:git' });
      await escreverArquivosDaMemoria(this.prisma, job.projectId);
      await avisar(`O trabalho foi concluído, mas o envio ao Git falhou: ${motivo}. Veja a aba Git.`);
    }
  }

  /** Conflito ao integrar com a pasta principal: o job NÃO é dado como concluído; pendência registrada. */
  private async blockConflict(job: Job & { title: string }, report: EvaluationReport, files: string[],lease?:EvaluationLease): Promise<EvaluationReport> {
    const detail = `conflito ao integrar com a pasta principal do projeto: ${files.join(', ')}`;
    const r = await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, job.id);
      await assertEvaluationLease(tx,lease);
      return tx.job.updateMany({
        where: { id: job.id, status: { in: ['EXECUTANDO', 'AGUARDANDO_APROVACAO', 'AGUARDANDO_RECURSO'] } },
        data: { status: 'BLOQUEADO', blockedReason: BlockedReason.CONFLITO_INCORPORACAO, statusDetail: detail, mergeStatus: 'CONFLITO' },
      });
    });
    if (r.count) {
      await gravarNoProjeto(this.prisma, {
        projectId: job.projectId,
        category: 'PENDENCIA',
        title: `Resultado do trabalho "${job.title}" não incorporado (conflito)`,
        content: `${detail}. O trabalho continua na branch job/${job.id}. Resolva os arquivos em conflito e retome o trabalho.`,
        references: { jobId: job.id, origem: 'conflito-incorporacao', arquivos: files },
        author: 'sistema:verificador',
      });
      await escreverArquivosDaMemoria(this.prisma, job.projectId);
    }
    await this.logs.log(job.id, `Job BLOQUEADO (CONFLITO_INCORPORACAO): ${detail}`, { source: 'evaluator', level: 'ERROR' });
    report.finalStatus = 'BLOQUEADO';
    report.pendencias = [detail];
    return report;
  }

  private async blockGoldfishEvaluation(job:Job,report:EvaluationReport,detail:string,lease?:EvaluationLease):Promise<EvaluationReport>{
    const r=await this.prisma.$transaction(async tx=>{
      await OrchestratorService.lockJob(tx,job.id);
      await assertEvaluationLease(tx,lease);
      return tx.job.updateMany({where:{id:job.id,status:{in:['EXECUTANDO','AGUARDANDO_APROVACAO','AGUARDANDO_RECURSO']}},data:{status:'BLOQUEADO',blockedReason:BlockedReason.VERIFICACAO_IMPOSSIVEL,statusDetail:detail}});
    });
    if(r.count){
      await this.logs.log(job.id,'Goldfish: publicação não autorizada. '+detail,{source:'evaluator',level:'WARN'});
      await avisarConversaQueParou(this.prisma,job.id,detail);
    }
    report.finalStatus=r.count?'BLOQUEADO':(await this.prisma.job.findUniqueOrThrow({where:{id:job.id}})).status;
    report.pendencias.push(detail);
    return report;
  }

  private async check(job: Job, c: AcceptanceCriterion, worktree: string,proofs:readonly GoldfishProof[]=[],lease?:EvaluationLease): Promise<CriterionResult> {
    const cfg = (c.config ?? {}) as Record<string, any>;
    const base = { key: c.key, kind: c.kind };
    // A mídia (vídeos) fica em <projeto>/midia/, FORA do git: um caminho "midia/..." resolve na pasta do projeto,
    // não na cópia (worktree) do repositório. Senão o vídeo é feito mas o critério FILE_EXISTS não o acha.
    const dirs = this.workspace.projectDirs((job as Job & { project: { dirKey: string } }).project.dirKey);
    const baseDoCaminho = (p: string) => (/^midia\//i.test(String(p)) ? dirs.root : worktree);
    try {
      const capability=capabilityReference(c.config);
      if(capability){
        const contract=resolveInside(worktree,capability.contract);
        if(!fs.existsSync(contract)||!fs.statSync(contract).isFile()||!fs.statSync(contract).size)return {...base,passed:false,evidence:{erro:'Contrato da Capability ausente ou vazio',capability:capability.id,contrato:capability.contract}};
      }
      if(nativeAdoptionInventory(c)){
        const adoption=adoptionOf(c.config)!;
        const inventory=verifyAdoptionInventory(worktree,adoption,readApprovedScope(job.approvedScope,job.projectId)?.visual);
        return {...base,passed:true,evidence:{adoption:adoption.artifact,adoptionInventory:inventory,verificador:'inventario-nativo'}};
      }
      switch (c.kind) {
        case 'COMMAND': {
          const adoption=adoptionOf(c.config);
          const inventory=adoption?verifyAdoptionInventory(worktree,adoption,readApprovedScope(job.approvedScope,job.projectId)?.visual):null;
          const cmd = String(cfg.command ?? '');
          await this.logs.log(job.id, `Conferência final: critério "${c.key}" rodando (${cmd.replace(/\s+/g, ' ').slice(0, 160)})`, { source: 'evaluator' });
          const pol = evaluatePolicy(cmd);
          if (!pol.allowed) return { ...base, passed: false, evidence: { erro: 'comando bloqueado pela política', motivos: pol.reasons } };
          const prepared=await prepareVerificationEnvironment(job.projectId,job.id,`${worktree}/out`,dirs.midia);
          if(!prepared.ok)return {...base,passed:false,verificationProblem:prepared.problem,evidence:{executado:false,problema:prepared.problem}};
          const r = redactVerificationResult(await runProcess('bash', ['-e', '-o', 'pipefail', '-c', cmd], {
            cwd: worktree,signal:lease?.signal,
            env: prepared.env,
            encerrarGrupoAoSair: true,
            // Critério pode rodar testes e build (como a conferência das etapas): mesmo limite, 30 min por padrão.
            timeoutMs: (cfg.timeoutSec ?? Number(process.env.NIVOO_VERIFY_TIMEOUT_SEC ?? 1800)) * 1000,
            maxBuffer: 20 * 1024 * 1024,
          }),prepared.redact);
          const expected = cfg.expectExitCode ?? 0;
          const problem=verificationPassed(r,expected)?null:verificationProblem(r,cmd);
          const missing=verificationPassed(r,expected)&&Array.isArray(cfg.adoptionFamilies)?verifyAdoptionCoverage(r.stdout,cfg.adoptionFamilies):[];
          const proof=proofs.length?goldfishProofEvidence(verificationPassed(r,expected)?r.stdout:'',proofs):null;
          return {
            ...base,
            passed: verificationPassed(r,expected)&&!missing.length&&!proof?.missing.length,
            ...(problem?{verificationProblem:problem}:{}),
            evidence: { ...(proof?{egmProof:proof}:{}),...(inventory?{adoptionInventory:inventory,adoption:adoption!.artifact}:{}),...(Array.isArray(cfg.adoptionFamilies)?{adoptionCoverage:{expected:cfg.adoptionFamilies,missing}}:{}),...(missing.length?{erro:'Famílias de adoção sem evidência integrada: '+missing.join(', ')}:{}), comando: cmd, exitCode: r.exitCode, esperado: expected, timeout: r.timedOut, interrompido:r.aborted, ...(problem?{problema:problem}:{}), stdout: r.stdout.slice(-4000), stderr: r.stderr.slice(-2000) },
          };
        }
        case 'FILE_EXISTS': {
          const p = resolveInside(baseDoCaminho(cfg.path), String(cfg.path));
          if (!fs.existsSync(p)) return { ...base, passed: false, evidence: { caminho: cfg.path, existe: false } };
          const st = fs.statSync(p);
          const minBytes = cfg.minBytes ?? 1;
          return {
            ...base,
            // Pasta também vale ("existe"); arquivo precisa ter o tamanho mínimo.
            passed: st.isDirectory() || (st.isFile() && st.size >= minBytes),
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

  /** Registra na memória do projeto a evidência do trabalho concluído (commit e artefatos). */
  private async prepareCompletion(job: Job, worktree: string): Promise<{ memory: Prisma.MemoryEntryCreateArgs }> {
    const commit = await this.workspace.commitCheckpoint(worktree, `job ${job.id}: concluído (critérios verificados)`);
    const artifacts = await this.prisma.artifact.findMany({ where: { jobId: job.id, kind: { in: ['FILE', 'METRICS', 'REPORT'] } } });
    return {
      memory: {
        data: {
          camada: 'INTERNA',
          projectId: job.projectId,
          category: 'EVIDENCIA',
          title: `Resultado do trabalho "${job.title}"`,
          content: `Trabalho concluído e conferido pelo verificador. Commit ${commit}. Artefatos: ${artifacts.map((a) => `${a.name} (${a.sha256.slice(0, 12)})`).join(', ') || 'nenhum'}.`,
          references: { jobId: job.id, gitCommit: commit, artifactIds: artifacts.map((a) => a.id) },
          author: 'sistema:verificador',
        },
      },
    };
  }
}

