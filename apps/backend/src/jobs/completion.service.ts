import { Injectable } from '@nestjs/common';
import { AcceptanceCriterion, Job, Prisma } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sha256, sha256File } from '../common/hash';
import { ambienteDaConferencia, minimalEnv, portaLivre, runProcess } from '../common/exec';
import { resolveInside } from '../common/path-guard';
import { BlockedReason } from '../common/status';
import { PrismaService } from '../prisma/prisma.service';
import { evaluatePolicy } from '../security/policy';
import { ArtifactStoreService } from '../storage/artifact-store.service';
import { WorkspaceService } from '../storage/workspace.service';
import { LogService } from './log.service';
import { GitService } from '../git/git.service';
import { OrchestratorService } from './orchestrator.service';
import { conferenciasDasEtapas, lerRevisao, RULE_REVIEW_REPORT, RULE_REVIEW_STEP } from './rule-review';
import { escreverArquivosDaMemoria, gravarNoProjeto } from '../memory/camadas';
import { descartarBancoDeTeste, prepararBancoDeTeste } from '../common/banco-de-teste';
import { avisarConversaQueParou } from '../conversations/jobs-da-conversa';
import { tipoDe } from '../accounts/connections';
import { ProviderRegistry } from '../providers/provider-registry.service';

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


export function capturasMotionDesatualizadas(worktree: string, steps: Array<{key:string; provider:string|null; instructions:string; status:string}>): string[] {
  const vencidas: string[] = [];
  for (const step of steps) {
    if (step.provider !== 'local-shell' || step.status !== 'CONCLUIDO') continue;
    const match = /\bnivoo-conferir-arte\s+(motion\/[A-Za-z0-9._/-]+)\\s+--saida\\s+(out\/qualidade\\/[A-Za-z0-9_-]+)/.exec(step.instructions);
    if (!match || match[1].split('/').includes('..')) continue;
    const dir = path.resolve(worktree, match[1]);
    const png = path.resolve(worktree, match[2], 'quadro.png');
    if (!dir.startsWith(worktree + path.sep) || !fs.existsSync(dir) || !fs.existsSync(png)) continue;
    const pngTime = fs.statSync(png).mtimeMs;
    const fontes: string[] = [];
    const ler = (pasta: string, level: number) => {
      if (level > 3 || fontes.length > 200) return;
      for (const item of fs.readdirSync(pasta, {withFileTypes:true})) {
        if (item.isSymbolicLink()) continue;
        const full = path.join(pasta,item.name);
        if (item.isDirectory()) ler(full,level+1);
        else if(item.isFile() && /\.(html|css|js|mjs|png|jpe?g|svg|webp)$/i.test(item.name)) fontes.push(full);
      }
    };
    ler(dir,0);
    if(fontes.some(f=>fs.statSync(f).mtimeMs>pngTime+200)) vencidas.push(step.key);
  }
  return vencidas;
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
    private readonly git: GitService,
    private readonly orchestrator: OrchestratorService,
    private readonly registry: ProviderRegistry,
  ) {}

  /**
   * Auto-correção final tem teto RÍGIDO por trabalho. Uma correção é uma nova
   * etapa, portanto o limite de tentativas POR ETAPA não a contém. Limite
   * global impede ciclos de revisão/correção com dezenas de etapas pagas.
   */
  private async corrigirCriterios(job: Job & { steps: Array<{ id: string; key: string; provider: string | null; dependsOn: string[]; order: number; verifyCommand: string | null; instructions: string; createdAt: Date }>; project: { provider: string; aiReserva?: unknown } }, falhas: CriterionResult[], criterios: AcceptanceCriterion[], worktree: string): Promise<boolean> {
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
    // O teto conta TODA correção no mesmo trabalho. Retomar, trocar a IA e
    // alterar o texto da violação não zeram esse limite. Recuperar um trabalho
    // bloqueado exige análise/decisão, e não novas correções automáticas.
    // Quando o código muda, uma captura anterior não valida a nova composição.
    const vencidas = capturasMotionDesatualizadas(worktree, job.steps);
    if (vencidas.length) {
      const refazer = new Set(vencidas);
      let changed = true;
      while (changed) {
        changed = false;
        for (const step of job.steps) {
          if (refazer.has(step.key) || step.key.startsWith('correcao-criterios-')) continue;
          if (step.dependsOn.some(dep => refazer.has(dep))) { refazer.add(step.key); changed = true; }
        }
      }
      if (job.steps.some(s => s.key === RULE_REVIEW_STEP)) refazer.add(RULE_REVIEW_STEP);
      fs.rmSync(path.join(worktree, RULE_REVIEW_REPORT), {force:true});
      const qualityDir = path.join(worktree, 'out/qualidade');
      if (fs.existsSync(qualityDir)) for (const name of fs.readdirSync(qualityDir)) {
        if (/parecer.*\.json$/i.test(name)) fs.rmSync(path.join(qualityDir,name),{force:true});
      }
      await this.prisma.$transaction(async tx => {
        await OrchestratorService.lockJob(tx,job.id);
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
    const configurado = Number(process.env.NIVOO_CORRECOES_MAX ?? 2);
    const maxRodadas = Number.isFinite(configurado) ? Math.min(3,Math.max(0,Math.floor(configurado))) : 2;
    const correcoesAgora = job.steps.filter((s) => s.key.startsWith('correcao-criterios-')).sort((a, b) => b.order - a.order);
    if (maxRodadas === 0 || rodadas >= maxRodadas) {
      await this.logs.log(job.id,
        `Conferência final reprovada, mas o limite global de ${maxRodadas} correção(ões) automática(s) já foi atingido (${rodadas} executadas). Não criarei outra etapa. É necessário corrigir a causa, a ferramenta ou o critério.`,
        { source:'evaluator',level:'WARN' });
      return false;
    }
    // A cobrança de agora: violações apontadas pela revisão + critérios automáticos que falharam.
    const violacoesAgora = falhas.some((f) => f.key === RULE_REVIEW_STEP) ? (lerRevisao(worktree)?.violacoes ?? []) : [];
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
    const cobranca = [
      ...violacoesAgora.map((v) => v.slice(0, 300)),
      ...falhas.filter((f) => f.key !== RULE_REVIEW_STEP).map((f) => `${f.key} — ${criterios.find((c) => c.key === f.key)?.description ?? ''}`),
    ];
    const normal = (t: string) => t.toLowerCase().replace(/[^a-z0-9à-ú]+/g, ' ').trim();
    const mesmaCobranca = (instr: string) => cobranca.length > 0 && cobranca.every((c) => normal(instr).includes(normal(c)));
    // Quantas correções seguidas (da mais recente para trás) já cobraram exatamente isto.
    let repetidas = 0;
    for (const c of correcoesAgora) {
      if (!mesmaCobranca(c.instructions)) break;
      repetidas++;
    }
    if (repetidas >= 3) {
      await this.logs.log(job.id, `A conferência final cobrou as MESMAS coisas depois de ${repetidas} correções seguidas (mudando a abordagem${new Set(correcoesAgora.slice(0, repetidas).map((c) => c.provider)).size > 1 ? ' e a IA' : ''}): a IA não está conseguindo resolver sozinha e girar de novo só gastaria. O trabalho espera você (responder, "Tentar de novo" ou aceitar assim mesmo).`, { source: 'evaluator', level: 'WARN' });
      return false;
    }
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
    const confere = [...new Set([...confereCriterios, ...conferenciasDasEtapas(job.steps)])].join(' && ') || 'true';
    const review = job.steps.find((s) => s.key === RULE_REVIEW_STEP);
    const base = Math.max(...job.steps.map((s) => s.order)) + 1;
    await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, job.id);
      await tx.step.create({
        data: {
          jobId: job.id, key, order: review ? review.order : base, provider: quemCorrige, dependsOn: job.steps.filter((s) => s.key !== RULE_REVIEW_STEP).map((s) => s.key),
          title: 'Corrigir o que a conferência final cobrou',
          instructions: [
            'O trabalho terminou as etapas, mas a conferência final do sistema NÃO passou nestes critérios:',
            ...linhas,
            ...revisao,
            ...(repetidas > 0
              ? [
                  '',
                  `ATENÇÃO: é a ${repetidas + 1}ª vez seguida que a conferência cobra EXATAMENTE isto — as correções anteriores NÃO resolveram.`,
                  'Não repita o que já foi tentado: veja o que mudou (git log -p nesta pasta) e o que a revisão diz que ainda falta, e',
                  'MUDE A ABORDAGEM. Se a cobrança é de evidência executada pelo sistema, a evidência precisa estar no lugar que a',
                  'conferência roda (testes do projeto ou nivoo-roteiros/) — um script solto em outra pasta não conta.',
                ]
              : []),
            '',
            'Corrija o trabalho (arquivos do projeto) para que esses critérios passem, mantendo o que já foi feito e as regras do projeto.',
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
    await this.logs.log(job.id, `Conferência final não passou (${falhas.map((f) => f.key).join(', ')}): a IA corrige sozinha (rodada ${correcoesAgora.length + 1}${repetidas ? `; a mesma cobrança pela ${repetidas + 1}ª vez: muda a abordagem${quemCorrige !== (correcoesAgora[0]?.provider ?? quem) ? ` e passa para ${quemCorrige}` : ''}` : ''})`, { source: 'evaluator', level: 'WARN' });
    await this.orchestrator.scheduleReady(job.id);
    return true;
  }

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
    let trouxeMudanca = false;
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
      if (status === 'BLOQUEADO' && reason === BlockedReason.CRITERIOS_NAO_ATENDIDOS) {
        if (await this.corrigirCriterios(job as never, failed, job.criteria, worktree)) {
          report.finalStatus = 'EXECUTANDO';
          return report;
        }
      }
      if (status !== 'CONCLUIDO') break;

      // Resultados reproduzíveis preparados ANTES e gravados na MESMA transação da conclusão.
      completion = await this.prepareCompletion(job, worktree);
      const ff = await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${'incorporar:' + job.projectId}))) AS l`;
          return this.workspace.integrateIntoMain(job.project.dirKey, job.id, await this.commitMessage(job));
        },
        { timeout: 120_000, maxWait: 120_000 },
      );
      if (ff.ok) {
        mergedCommit = ff.commit;
        trouxeMudanca = ff.mudou !== false;
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
      if (r.count && completion && status === 'CONCLUIDO') await tx.memoryEntry.create(completion.memory);
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
    if (updated && status === 'CONCLUIDO' && trouxeMudanca && job.project.gitAutoPush && job.project.gitUrl) await this.autoPush(job);
    if (updated) await escreverArquivosDaMemoria(this.prisma, job.projectId);
    if (updated && status === 'BLOQUEADO') await avisarConversaQueParou(this.prisma, job.id, detail);
    // Fim do trabalho (concluído ou parado na conferência final): limpeza de dependências e caches da pasta do trabalho.
    if (updated && status !== 'AGUARDANDO_APROVACAO' && !(report.finalStatus === 'EXECUTANDO')) {
      const limpo = await this.workspace.limparLixoDeExecucao(path.join(this.workspace.projectDirs(job.project.dirKey).worktrees, job.id)).catch(() => null);
      if (await descartarBancoDeTeste(job.id)) await this.logs.log(jobId, 'Banco de teste do trabalho apagado', { source: 'evaluator' });
      if (limpo?.removidos.length) await this.logs.log(jobId, `Limpeza: ${limpo.removidos.join(', ')} apagado(s) da pasta do trabalho (${limpo.mb} MB; são só instalação/cache)`, { source: 'evaluator' });
    }
    if (updated && status === 'CONCLUIDO') {
      // Resultados (relatórios, inventários, planos de out/) também na pasta DEFINITIVA do projeto.
      const pasta = await this.artifacts.guardarNaPastaDoProjeto(this.workspace.projectDirs(job.project.dirKey).root, job).catch(async (e) => {
        await this.logs.log(jobId, `Não consegui guardar os resultados na pasta do projeto: ${e?.message ?? e}`, { source: 'evaluator', level: 'ERROR' });
        return null;
      });
      if (pasta) await this.logs.log(jobId, `Resultados guardados na pasta do projeto: ${pasta}/`, { source: 'evaluator' });
      await this.pedirEntrega(job.id);
    }
    await this.logs.log(jobId, `Avaliação de conclusão: ${report.finalStatus}. ${detail}`, {
      source: 'evaluator',
      level: status === 'CONCLUIDO' ? 'INFO' : 'WARN',
    });
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
  private async pedirEntrega(jobId: string): Promise<void> {
    const plano = await this.prisma.conversationMessage.findFirst({ where: { jobId, kind: 'plano' }, select: { conversationId: true } });
    if (!plano) return;
    await this.prisma.$transaction(async (tx) => {
      const m = await tx.conversationMessage.create({ data: { conversationId: plano.conversationId, role: 'ASSISTENTE', content: '', status: 'PENDENTE', kind: 'entrega', jobId } });
      await tx.queueTask.create({ data: { type: 'PLAN_MESSAGE', messageId: m.id } });
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

  private async check(job: Job, c: AcceptanceCriterion, worktree: string): Promise<CriterionResult> {
    const cfg = (c.config ?? {}) as Record<string, any>;
    const base = { key: c.key, kind: c.kind };
    // A mídia (vídeos) fica em <projeto>/midia/, FORA do git: um caminho "midia/..." resolve na pasta do projeto,
    // não na cópia (worktree) do repositório. Senão o vídeo é feito mas o critério FILE_EXISTS não o acha.
    const dirs = this.workspace.projectDirs((job as Job & { project: { dirKey: string } }).project.dirKey);
    const baseDoCaminho = (p: string) => (/^midia\//i.test(String(p)) ? dirs.root : worktree);
    try {
      switch (c.kind) {
        case 'COMMAND': {
          const cmd = String(cfg.command ?? '');
          await this.logs.log(job.id, `Conferência final: critério "${c.key}" rodando (${cmd.replace(/\s+/g, ' ').slice(0, 160)})`, { source: 'evaluator' });
          const pol = evaluatePolicy(cmd);
          if (!pol.allowed) return { ...base, passed: false, evidence: { erro: 'comando bloqueado pela política', motivos: pol.reasons } };
          const r = await runProcess('bash', ['-e', '-o', 'pipefail', '-c', cmd], {
            cwd: worktree,
            env: ambienteDaConferencia({
              NIVOO_JOB_ID: job.id,
              NIVOO_OUTPUT_DIR: `${worktree}/out`,
              NIVOO_MIDIA_DIR: dirs.midia,
              NIVOO_PORTA_TESTE: String(await portaLivre().catch(() => 0)),
              ...((await prepararBancoDeTeste(job.id).catch(() => null))?.env ?? {}),
            }),
            encerrarGrupoAoSair: true,
            // Critério pode rodar testes e build (como a conferência das etapas): mesmo limite, 30 min por padrão.
            timeoutMs: (cfg.timeoutSec ?? Number(process.env.NIVOO_VERIFY_TIMEOUT_SEC ?? 1800)) * 1000,
            maxBuffer: 20 * 1024 * 1024,
          });
          const expected = cfg.expectExitCode ?? 0;
          return {
            ...base,
            passed: r.exitCode === expected && !r.timedOut,
            evidence: { comando: cmd, exitCode: r.exitCode, esperado: expected, timeout: r.timedOut, stdout: r.stdout.slice(-4000), stderr: r.stderr.slice(-2000) },
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

