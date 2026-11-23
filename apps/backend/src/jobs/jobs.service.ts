import * as fs from 'node:fs';
import * as path from 'node:path';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CriterionKind, Prisma } from '@prisma/client';
import { sha256 } from '../common/hash';
import { aplicarPrioridadeDosExecutores, normalizarCenasDeMontagem, erroDeComandoLocal } from './executor-priority';
import { caminhoDoProjeto } from '../common/path-guard';
import { appConfig } from '../config';
import { BlockedReason } from '../common/status';
import { oneOf, optNumber, optString, reqString } from '../common/validate';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { MotorNarracao, VOZES_NARRACAO, vozConhecida, vozPadraoDoMotor } from '../providers/vozes';
import { QueueService } from '../queue/queue.service';
import { evaluatePolicy } from '../security/policy';
import { LogService } from './log.service';
import { aceitarRevisao, conferenciasDasEtapas, lerRevisao, RULE_REVIEW_CRITERION, RULE_REVIEW_STEP, ruleReviewStep } from './rule-review';
import { OrchestratorService } from './orchestrator.service';
import { capturasParaRecuperar } from './motion-capture-freshness';

const CRITERION_KINDS = ['COMMAND', 'FILE_EXISTS', 'ARTIFACT_PRESENT', 'METRIC_THRESHOLD', 'MANUAL_APPROVAL'] as const;

/**
 * Contrato do renderizador motion, aplicado ao registrar/validar o plano.
 * O vídeo durável mora SEMPRE em midia/saida; out/ é só para relatórios,
 * frames PNG/JPEG e outras evidências. Não depende da boa vontade da IA.
 */
/**
 * Insere a revisão do quadro ANTES do MP4 na estrutura do job, mesmo quando
 * o planejador esquece de propor uma etapa de direção de arte. Não escolhe
 * automaticamente uma referência: o agente recebe os anexos originais.
 */
function comPreflightVisual(raw: unknown, defaultProvider: string): unknown {
  if (!Array.isArray(raw)) return raw;
  const keys = new Set(raw.map((s: any) => String(s?.key ?? '')));
  const result: any[] = [];
  const referencia = raw.find((s: any) => {
    const provider = String(s?.provider ?? defaultProvider);
    return provider !== 'local-shell' && !['gemini-video', 'juntar-videos', 'gerar-narracao', 'arquivos-projeto'].includes(provider);
  });
  const ai = referencia ? String(referencia.provider ?? defaultProvider) :
    (defaultProvider !== 'local-shell' && !['gemini-video', 'juntar-videos', 'gerar-narracao', 'arquivos-projeto'].includes(defaultProvider) ? defaultProvider : null);
  for (const s of raw) {
    const text = String(s?.instructions ?? '');
    const isRender = (s?.provider ?? defaultProvider) === 'local-shell' && /\bnivoo-renderizar-motion\b/.test(text);
    if (!isRender || !ai) { result.push(s); continue; }
    // validatePlan já insere essas duas etapas; create recebe o plano
    // normalizado e não pode duplicá-las.
    if (Array.isArray(s.dependsOn) && s.dependsOn.some((d: unknown) => String(d).startsWith('direcao-arte-'))) {
      result.push(s);
      continue;
    }
    const source = /\bnivoo-renderizar-motion\s+(motion\/[A-Za-z0-9._/-]+)/.exec(text)?.[1];
    if (!source || source.split('/').includes('..')) {
      throw new BadRequestException('O renderizador motion deve indicar uma pasta motion/<nome> para a conferência visual prévia');
    }
    const seconds = /--segundos\s+(\d+)/.exec(text)?.[1] ?? '15';
    const size = /--tamanho\s+(\d+x\d+)/.exec(text)?.[1] ?? '1920x1080';
    const slug = String(s.key).slice(0, 28);
    let n = 1, key = 'qa-visual-' + slug;
    while (keys.has(key)) key = 'qa-visual-' + slug + '-' + (++n);
    keys.add(key);
    const evidence = 'out/qualidade/' + key;
    let check = 'direcao-arte-' + slug, n2 = 1;
    while (keys.has(check)) check = 'direcao-arte-' + slug + '-' + (++n2);
    keys.add(check);
    const previous = Array.isArray(s.dependsOn) ? s.dependsOn : [];
    result.push({
      key, title: 'Capturar composição antes do vídeo', provider: 'local-shell',
      dependsOn: previous,
      instructions: `nivoo-conferir-arte ${source} --saida ${evidence} --segundos ${seconds} --tamanho ${size}`,
      verifyCommand: `test -s ${evidence}/quadro.png && test -s ${evidence}/evidencias.json`,
    });
    result.push({
      key: check, title: 'Inspecionar fidelidade e acabamento antes da renderização',
      provider: ai, dependsOn: [key],
      instructions: [
        `LEIA ${evidence}/evidencias.json e ABRA ${evidence}/quadro.png.`,
        'Leia o briefing original em contexto/conversa-do-pedido.md e compare com a REFERÊNCIA VISUAL CORRETA em contexto/anexos (não confunda fundos, logos e fotos isoladas com cartaz final).',
        'Confira textos literalmente, proporção e enquadramento dos ativos, força visual relativa, paleta, amarelos e vermelhos quando pedidos, textura, brilho, profundidade e margens.',
        'Quando a referência tiver relevo, compare profundidade 2.5D: separação de planos, perspectiva sutil, sombras de contato, luz consistente, brilho de bordas e oclusão. Cartões chapados com sombras iguais não reproduzem o efeito.',
        'Sem referência com volume, não imponha 3D. Preserve o logotipo original, fotografias e legibilidade, e verifique um quadro do movimento além do quadro estático.',
        'Em peça sem referência, confira consistência com o estilo do briefing, sem adicionar neon/efeitos apenas por ser premium.',
        'Se observar diferenças, corrija APENAS os elementos necessários no HTML/CSS/JS e CAPTURE DE NOVO o quadro usando o mesmo comando nivoo-conferir-arte da etapa anterior.',
        'Não redimensione ou recolora imagens originais indevidamente. Não refaça a sequência de animação já aprovada.',
        `Salve ${evidence}/parecer.json contendo {"conforme":true|false,"referencia":"caminho ou sem referencia","comparacoes":[{"aspecto":"...","observacao":"...","acao":"..."}],"correcoes":[],"pendencias":[]}.`,
        'Só marque conforme=true se a imagem final foi realmente aberta e verificada; se faltar ferramenta de inspeção, registre impedimento concreto, não invente aprovação.',
        'A checagem é ANTES de renderizar MP4, para evitar repetição de vídeos caros.',
      ].join('\n'),
      verifyCommand: `python3 -c "import json,sys; d=json.load(open('${evidence}/parecer.json')); sys.exit(0 if d.get('conforme') is True and isinstance(d.get('comparacoes'),list) and len(d['comparacoes'])>=3 and not d.get('pendencias') else 1)"`,
    });
    result.push({ ...s, dependsOn: [...new Set([...previous, check])] });
  }
  return result;
}

function validarSaidaMotion(command: string, origem: string): string {
  if (!/\bnivoo-renderizar-motion\b/.test(command)) return command;
  let fixed = command;
  // Compatibilidade: corrige automaticamente planos que tentam criar MP4 em out/.
  // Atualiza também as referências subsequentes (ex.: ffmpeg -i out/...).
  const obsolete = [...fixed.matchAll(/--saida\s+["']?(out\/[A-Za-z0-9._-]+\.mp4)["']?/g)].map(m => m[1]);
  for (const oldPath of obsolete) fixed = fixed.split(oldPath).join('midia/saida/' + path.basename(oldPath));
  // Valida cada chamada, inclusive em scripts com vários renderizadores.
  const renders = fixed.split(/\bnivoo-renderizar-motion\b/).slice(1);
  for (const render of renders) {
    const line = render.split('\n', 1)[0];
    const output = /--saida\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/.exec(line);
    if (!output || !/^midia\/saida\/[A-Za-z0-9._-]+\.mp4$/i.test(output[1] ?? output[2] ?? output[3])) {
      throw new BadRequestException(`${origem}: nivoo-renderizar-motion exige --saida midia/saida/<nome>.mp4 (nunca out/)`);
    }
  }
  return fixed;
}


/**
 * Fronteira do planejamento: IA recebe TEXTO; local-shell recebe um COMANDO.
 * O nome da ferramenta citado em uma instrução de IA nunca é uma invocação.
 */
export function normalizarInstrucaoDeEtapa(texto: string, provider: string, origem: string): string {
  return provider === 'local-shell' ? validarSaidaMotion(texto, origem) : texto;
}

export interface StepInput {
  key: string;
  title: string;
  instructions: string;
  provider?: string;
  dependsOn: string[];
  verifyCommand?: string;
  requiresApproval: boolean;
  providerOptions: Prisma.InputJsonValue;
}

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

  private parseSteps(raw: unknown, defaultProvider: string, existingKeys: string[] = []): StepInput[] {
    if (!Array.isArray(raw)) throw new BadRequestException('steps deve ser uma lista');
    const steps: StepInput[] = raw.map((s: any) => {
      const key = reqString(s, 'key', 60);
      if (!/^[a-z0-9][a-z0-9_-]*$/i.test(key)) throw new BadRequestException(`Chave de etapa inválida: ${key}`);
      if (key === RULE_REVIEW_STEP) throw new BadRequestException(`A etapa ${RULE_REVIEW_STEP} é criada pelo sistema`);
      const rawInstructions = reqString(s, 'instructions', 100000);
      const rawVerifyCommand = optString(s, 'verifyCommand', 5000);
      const provider = optString(s, 'provider', 60);
      // O texto de uma etapa de IA NÃO é um script: pode citar comandos,
      // erros antigos e caminhos inválidos como parte da análise.
      // Validar/normalizar comandos SOMENTE quando serão executados como Bash.
      const instructions = normalizarInstrucaoDeEtapa(rawInstructions, provider ?? defaultProvider, `Etapa ${key} (instruções)`);
      const verifyCommand = rawVerifyCommand ? validarSaidaMotion(rawVerifyCommand, `Etapa ${key} (conferência)`) : undefined;
      if ((provider ?? defaultProvider) === 'local-shell') {
        const invalido = erroDeComandoLocal(instructions);
        if (invalido) throw new BadRequestException(`Etapa ${key}: ${invalido}`);
      }
      if (provider && !this.registry.has(provider)) throw new BadRequestException(`Conector desconhecido: ${provider}`);
      // Etapas executadas por IA precisam de verificação determinística: o agente não encerra a etapa sozinho.
      if (this.registry.get(provider ?? defaultProvider).kind !== 'executor' && !verifyCommand) {
        throw new BadRequestException(`Etapa ${key} usa conector de IA e exige verifyCommand (verificação determinística)`);
      }
      const opts = s.providerOptions ?? {};
      const providerOptions: Record<string, unknown> = {};
      if (opts.model !== undefined) providerOptions.model = String(opts.model).slice(0, 100);
      if (opts.maxTurns !== undefined) {
        const n = Number(opts.maxTurns);
        if (!Number.isInteger(n) || n < 1 || n > 500) throw new BadRequestException(`Etapa ${key}: maxTurns deve ser inteiro entre 1 e 500`);
        providerOptions.maxTurns = n;
      }
      // Etapa de vídeo (Omni): a descrição do vídeo é a instrução; o sistema confere que o arquivo saiu.
      let verificacao = verifyCommand;
      if ((provider ?? defaultProvider) === 'gemini-video') {
        Object.assign(providerOptions, opcoesDeVideo(key, opts));
        verificacao = verifyCommand ?? `test -s '${providerOptions.arquivo}'`;
      }
      // Juntar as cenas num vídeo só (etapa do sistema, ffmpeg).
      if ((provider ?? defaultProvider) === 'juntar-videos') {
        Object.assign(providerOptions, opcoesDeJuncao(key, opts));
        // Vídeo editado em midia/ fica na pasta de mídia durável (fora do worktree): quem confere é o provider (exitCode).
        verificacao = verifyCommand ?? (String(providerOptions.arquivo).startsWith('midia/') ? 'true' : `test -s '${providerOptions.arquivo}'`);
      }
      // Gerador local de prévia: somente MP3, antes de qualquer montagem de vídeo.
      if ((provider ?? defaultProvider) === 'gerar-narracao') {
        const origem = opts.narracao && typeof opts.narracao === 'object' ? opts.narracao : opts;
        // "arquivo" em gerar-narracao é o DESTINO MP3, não um áudio de entrada.
        // O validador da locução não pode interpretá-lo como narracao.arquivo.
        const { arquivo: _saida, ...entrada } = origem;
        const validada = narracaoValida(key, { ...entrada, motor: 'kokoro' });
        if (validada.arquivo) throw new BadRequestException(`Etapa ${key}: gerar-narracao exige texto ou trechos, não arquivo pronto`);
        const arquivo = String(opts.arquivo ?? 'out/previa-locucao.mp3');
        if (!/^out\/[a-zA-Z0-9_/-]+\.mp3$/.test(arquivo) || arquivo.split('/').includes('..'))
          throw new BadRequestException(`Etapa ${key}: arquivo deve ser out/<nome>.mp3`);
        Object.assign(providerOptions, validada, { arquivo });
        if (opts.fechamentoAlternativo !== undefined) {
          const fechamento = String(opts.fechamentoAlternativo).trim();
          if (!fechamento || fechamento.length > 300 || [...'[]<>'].some(c => fechamento.includes(c)))
            throw new BadRequestException(`Etapa ${key}: fechamentoAlternativo deve ser uma frase simples com até 300 caracteres`);
          providerOptions.fechamentoAlternativo = fechamento;
        }
        verificacao = verifyCommand ?? `test -s '${arquivo}'`;
      }
      // Apagar/mover arquivos (etapa do sistema): lista validada. O "Fazer" do plano já é a confirmação, e o
      // git guarda tudo (dá para voltar qualquer arquivo) — não pede uma segunda confirmação.
      if ((provider ?? defaultProvider) === 'arquivos-projeto') {
        Object.assign(providerOptions, operacoesDeArquivos(key, opts));
        const r = (providerOptions.remover as string[]).map((p) => `test ! -e '${p}'`);
        const m = (providerOptions.mover as Array<{ para: string }>).map((x) => `test -e '${x.para}'`);
        verificacao = verifyCommand ?? ([...r, ...m].join(' && ') || 'true');
      }
      // Política sobre o que vai RODAR: comandos (verificação; instruções só de etapa de comando). Instrução de IA é texto
      // — "não use rm -rf" ou um achado citando DELETE FROM não é uma ação destrutiva.
      const ehComando = (provider ?? defaultProvider) === 'local-shell';
      const pol = evaluatePolicy(`${ehComando ? instructions : ''}\n${verificacao ?? ''}`);
      return {
        key,
        title: optString(s, 'title', 300) ?? key,
        instructions,
        provider,
        dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.map(String) : [],
        verifyCommand: verificacao,
        requiresApproval: s.requiresApproval === true || pol.requiresApproval,
        providerOptions: providerOptions as Prisma.InputJsonValue,
      };
    });
    const keys = new Set(existingKeys);
    for (const s of steps) {
      if (keys.has(s.key)) throw new BadRequestException(`Etapa duplicada: ${s.key}`);
      keys.add(s.key);
    }
    for (const s of steps) {
      for (const d of s.dependsOn) if (!keys.has(d)) throw new BadRequestException(`Etapa ${s.key} depende de etapa inexistente: ${d}`);
    }
    return steps;
  }

  private assertAcyclic(all: Array<{ key: string; dependsOn: string[] }>): void {
    const map = new Map(all.map((s) => [s.key, s.dependsOn]));
    const state = new Map<string, number>();
    const visit = (k: string) => {
      if (state.get(k) === 2) return;
      if (state.get(k) === 1) throw new BadRequestException(`Dependência cíclica envolvendo ${k}`);
      state.set(k, 1);
      for (const d of map.get(k) ?? []) visit(d);
      state.set(k, 2);
    };
    for (const k of map.keys()) visit(k);
  }

  private parseCriteria(raw: unknown, existingKeys: string[] = []) {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) throw new BadRequestException('criteria deve ser uma lista');
    const keys = new Set(existingKeys);
    return raw.map((c: any) => {
      const key = reqString(c, 'key', 60);
      if (keys.has(key)) throw new BadRequestException(`Critério duplicado: ${key}`);
      keys.add(key);
      const kind = oneOf(c, 'kind', CRITERION_KINDS) as CriterionKind;
      const config = (c.config ?? {}) as Record<string, unknown>;
      if (kind === 'COMMAND') {
        reqString(config, 'command');
        config.command = validarSaidaMotion(String(config.command), `Critério ${key}`);
        const pol = evaluatePolicy(String(config.command));
        if (!pol.allowed) throw new BadRequestException(`Comando do critério ${key} não permitido: ${pol.reasons.join('; ')}`);
      }
      if (kind === 'FILE_EXISTS') {
        const destino = reqString(config, 'path');
        if (/^out\/.+\.(?:mp4|mov|mkv|webm|m4v)$/i.test(destino)) {
          throw new BadRequestException(`Critério ${key}: vídeos devem ser verificados em midia/saida/, nunca out/`);
        }
      }
      if (kind === 'ARTIFACT_PRESENT' && !config.name && !config.pattern) throw new BadRequestException(`Critério ${key}: informe name ou pattern`);
      if (kind === 'METRIC_THRESHOLD') {
        reqString(config, 'path');
        if (!['>', '>=', '<', '<=', '==', '!='].includes(String(config.op ?? '>='))) throw new BadRequestException(`Critério ${key}: operador inválido`);
        if (config.value === undefined || config.value === null || typeof config.value === 'boolean' ||
            (typeof config.value === 'string' && !config.value.trim()) || !Number.isFinite(Number(config.value)))
          throw new BadRequestException(`Critério ${key}: config.value numérico obrigatório para METRIC_THRESHOLD. Se a verificação é textual, escolha COMMAND; não invente um número`);
        config.value = Number(config.value);
      }
      return { key, description: reqString(c, 'description', 2000), kind, config: config as Prisma.InputJsonValue };
    });
  }

  /**
   * Valida um plano proposto pela IA da conversa SEM criar nada: mesmas regras de um job criado à mão
   * (etapas de IA com verificação, sem ciclos, política, critérios válidos). Devolve o plano normalizado.
   */
  validatePlan(plan: any) {
    if (!plan || typeof plan !== 'object') throw new BadRequestException('Plano vazio');
    const title = reqString(plan, 'title', 300);
    const objective = reqString(plan, 'objective', 50000);
    const defaultProvider = optString(plan, 'defaultProvider', 60) ?? 'claude-code-cli';
    if (!this.registry.has(defaultProvider)) throw new BadRequestException(`Conector desconhecido: ${defaultProvider}`);
    if (!Array.isArray(plan.steps) || plan.steps.length === 0) throw new BadRequestException('O plano precisa de pelo menos uma etapa');
    const brutas = comPreflightVisual(comVideoCompleto(aplicarPrioridadeDosExecutores(plan.steps, defaultProvider), defaultProvider), defaultProvider);
    const steps = this.parseSteps(brutas, defaultProvider);
    this.assertAcyclic(steps);
    const criteria = this.parseCriteria(plan.criteria ?? []);
    if (criteria.length === 0) throw new BadRequestException('O plano precisa de critérios de aceitação verificáveis');
    const limits = plan.limits && typeof plan.limits === 'object' ? plan.limits : {};
    return { title, objective, defaultProvider, steps: brutas, criteria: plan.criteria, limits };
  }

  async create(projectId: string, body: any) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    const title = reqString(body, 'title', 300);
    const objective = reqString(body, 'objective', 50000);
    const defaultProvider = optString(body, 'defaultProvider', 60) ?? 'local-shell';
    if (!this.registry.has(defaultProvider)) throw new BadRequestException(`Conector desconhecido: ${defaultProvider}`);
    const steps = this.parseSteps(comPreflightVisual(comVideoCompleto(aplicarPrioridadeDosExecutores(body.steps ?? [], defaultProvider), defaultProvider), defaultProvider), defaultProvider);
    this.assertAcyclic(steps);
    const criteria = this.parseCriteria(body.criteria);
    // A trava: trabalho feito por IA termina com a conferência independente das regras do projeto.
    // (Só pode ser dispensada pela API, explicitamente — a conversa nunca dispensa.)
    const aiProviders = [...new Set(steps.map((s) => s.provider ?? defaultProvider))].filter((id) => this.registry.get(id).kind !== 'executor');
    if (aiProviders.length && body.conferencia !== false) {
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
        project: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!job) throw new NotFoundException('Job não encontrado neste projeto');
    // Última coisa registrada (ex.: "[ferramenta] Read src/app.ts"): a tela mostra que o trabalho está vivo.
    const ultima = await this.prisma.logEntry.findFirst({ where: { jobId }, orderBy: { id: 'desc' }, select: { message: true, createdAt: true } });
    return { ...job, ultimaAtividade: ultima ? { mensagem: ultima.message.slice(0, 300), em: ultima.createdAt } : null };
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
    const steps = this.parseSteps(body.steps ?? [], job.defaultProvider, job.steps.map((s) => s.key));
    this.assertAcyclic([...job.steps, ...steps]);
    const base = job.steps.length;
    await this.prisma.step.createMany({ data: steps.map((s, i) => ({ ...s, jobId, order: base + i })) });
    // A conferência das regras continua sendo a última etapa e passa a cobrir as etapas novas.
    const review = job.steps.find((s) => s.key === RULE_REVIEW_STEP);
    if (review) {
      await this.prisma.step.update({
        where: { id: review.id },
        data: { dependsOn: [...review.dependsOn, ...steps.map((s) => s.key)], order: base + steps.length, status: 'PENDENTE', statusDetail: 'novas etapas: conferir de novo' },
      });
    }
    await this.logs.log(jobId, `Etapas adicionadas: ${steps.map((s) => s.key).join(', ')}`);
    await this.orchestrator.scheduleReady(jobId);
    return this.get(projectId, jobId);
  }

  async addCriteria(projectId: string, jobId: string, body: any) {
    const job = await this.get(projectId, jobId);
    if (job.status === 'CONCLUIDO') throw new ConflictException('Job concluído');
    const criteria = this.parseCriteria(body.criteria ?? [], job.criteria.map((c) => c.key));
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
    // Uma sessão ainda em andamento (worker vivo encerrando o processo depois do "Pausar") impede a retomada:
    // senão duas sessões trabalhariam ao mesmo tempo no mesmo workspace. "Continuar" logo depois de "Pausar"
    // espera alguns segundos o encerramento em vez de recusar.
    const sessaoAindaFechando = async () => {
      const vivos = await this.prisma.attempt.findMany({ where: { jobId, status: 'EXECUTANDO' } });
      const limite = new Date(Date.now() - 2 * appConfig().leaseMs);
      for (const a of vivos) {
        const hb = await this.prisma.workerHeartbeat.findUnique({ where: { id: a.workerId } });
        if (hb && hb.lastSeenAt > limite) return a;
      }
      return null;
    };
    const ate = Date.now() + Number(process.env.NIVOO_ESPERA_ENCERRAR_MS ?? 20_000);
    let fechando = await sessaoAindaFechando();
    while (fechando && Date.now() < ate) {
      await new Promise((r) => setTimeout(r, 500));
      fechando = await sessaoAindaFechando();
    }
    if (fechando) {
      throw new ConflictException(`A sessão #${fechando.number} ainda está sendo encerrada pelo worker ${fechando.workerId}. Aguarde alguns segundos e clique em Continuar de novo.`);
    }
    // Retomar uma revisão visual bloqueada primeiro refaz as capturas vencidas,
    // em vez de iniciar outra sessão de IA com os mesmos PNGs antigos.
    const pasta = await this.pastaDoTrabalho(projectId, jobId);
    const revisoresBloqueados = job.steps.filter((etapa) =>
      ['BLOQUEADO', 'FALHOU'].includes(etapa.status) && /^direcao-arte-/.test(etapa.key));
    const recapturar = new Set<string>(
      pasta
        ? revisoresBloqueados.flatMap((revisao) => capturasParaRecuperar(pasta, revisao, job.steps))
        : [],
    );
    await this.prisma.$transaction(async (tx) => {
      await OrchestratorService.lockJob(tx, jobId);
      for (const s of job.steps) {
        const ultima = await tx.attempt.aggregate({ where: { stepId: s.id }, _max: { number: true } });
        const recomeco = { resumeFromAttempt: ultima._max.number ?? 0 }; // limites contam a partir da retomada
        if (recapturar.has(s.key) && s.status === 'CONCLUIDO') {
          await tx.step.update({
            where: { id: s.id },
            data: { status: 'PENDENTE', statusDetail: 'recapturar visual atualizado antes da revisão' },
          });
        } else if (s.status === 'EXECUTANDO') {
          // Worker morreu (sem sinal): a tentativa órfã é encerrada; a etapa volta para PENDENTE.
          await tx.attempt.updateMany({
            where: { stepId: s.id, status: 'EXECUTANDO' },
            data: { status: 'INTERROMPIDA', endedAt: new Date(), error: 'tentativa órfã encerrada na retomada (worker sem sinal)' },
          });
          await tx.step.update({ where: { id: s.id }, data: { status: 'PENDENTE', statusDetail: 'retomada', ...recomeco } });
        } else if (['BLOQUEADO', 'FALHOU', 'AGUARDANDO_RECURSO'].includes(s.status)) {
          await tx.step.update({ where: { id: s.id }, data: { status: 'PENDENTE', statusDetail: 'retomada', ...recomeco } });
        }
      }
      await tx.job.update({
        where: { id: jobId },
        data: { status: 'EXECUTANDO', blockedReason: null, statusDetail: `retomado por ${by}`, finishedAt: null, startedAt: job.startedAt ?? new Date() },
      });
    });
    await this.logs.log(jobId, `Job retomado por ${by} a partir do último checkpoint${recapturar.size ? '; recapturar ' + [...recapturar].join(', ') + ' antes de revisar' : ''}`);
    await this.orchestrator.scheduleReady(jobId);
    return this.get(projectId, jobId);
  }

  /** Solicita nova verificação de critérios (nunca marca conclusão diretamente). */
  async requestEvaluation(projectId: string, jobId: string) {
    const job = await this.get(projectId, jobId);
    if (job.status === 'CONCLUIDO') return job;
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

const CAMINHO_SEGURO = /^(?!\/)(?!.*\.\.)[\w\-./ ]{1,200}$/;

/** Opções de uma etapa de vídeo vindas do plano, validadas (nada de caminho fora do projeto). */
export function opcoesDeVideo(key: string, o: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const arquivo = caminhoDoProjeto(o.arquivo ?? `videos/${key}.mp4`) ?? '';
  if (!/\.mp4$/i.test(arquivo)) throw new BadRequestException(`Etapa ${key}: "arquivo" deve ser um caminho do projeto terminando em .mp4`);
  out.arquivo = arquivo;
  if (o.duracaoSeg !== undefined) {
    const n = Number(o.duracaoSeg);
    if (!Number.isInteger(n) || n < 1 || n > 60) throw new BadRequestException(`Etapa ${key}: duracaoSeg deve ser inteiro entre 1 e 60`);
    out.duracaoSeg = n;
  }
  if (o.proporcao !== undefined) {
    if (!/^\d{1,2}:\d{1,2}$/.test(String(o.proporcao))) throw new BadRequestException(`Etapa ${key}: proporcao deve ser como 16:9 ou 9:16`);
    out.proporcao = String(o.proporcao);
  }
  if (o.resolucao !== undefined) {
    if (!/^\d{3,4}p$|^4k$/i.test(String(o.resolucao))) throw new BadRequestException(`Etapa ${key}: resolucao deve ser como 720p ou 1080p`);
    out.resolucao = String(o.resolucao);
  }
  if (o.negativo !== undefined) out.negativo = String(o.negativo).slice(0, 1000);
  if (o.imagem !== undefined) {
    const img = String(o.imagem).trim();
    if (!CAMINHO_SEGURO.test(img) || !/\.(png|jpe?g|webp)$/i.test(img)) throw new BadRequestException(`Etapa ${key}: "imagem" deve ser um caminho de imagem do projeto (png, jpg, webp)`);
    out.imagem = img;
  }
  if (o.conexao !== undefined) out.conexao = String(o.conexao).slice(0, 60);
  // Legenda da cena (texto curto que aparece no vídeo completo) e estilo da transição para a cena seguinte.
  if (o.legenda !== undefined && String(o.legenda).trim()) out.legenda = String(o.legenda).trim().slice(0, 300);
  if (o.transicao !== undefined) out.transicao = transicaoValida(key, o.transicao);
  // Trilha de fundo do vídeo completo (na cena: vai para a junção) e cena sem música própria.
  if (o.trilha !== undefined) out.trilha = trilhaValida(key, o.trilha);
  if (o.narracao !== undefined) out.narracao = narracaoValida(key, o.narracao);
  if (o.semMusica !== undefined) out.semMusica = o.semMusica === true;
  if (o.semAudio !== undefined) out.semAudio = o.semAudio === true;
  return out;
}

/** Lista de apagar/mover de uma etapa "arquivos-projeto", validada (só caminhos do projeto, nada protegido). */
export function operacoesDeArquivos(key: string, o: any): { remover: string[]; mover: Array<{ de: string; para: string }> } {
  const ok = (p: unknown) => {
    const r = caminhoDoProjeto(p);
    if (!r) throw new BadRequestException(`Etapa ${key}: caminho inválido ou protegido: ${String(p)}`);
    return r;
  };
  const remover = Array.isArray(o.remover) ? o.remover.map(ok) : [];
  const mover = Array.isArray(o.mover) ? o.mover.map((m: any) => ({ de: ok(m?.de), para: ok(m?.para) })) : [];
  if (!remover.length && !mover.length) throw new BadRequestException(`Etapa ${key}: informe "remover" e/ou "mover"`);
  if (remover.length + mover.length > 2000) throw new BadRequestException(`Etapa ${key}: no máximo 2000 itens por etapa`);
  return { remover, mover };
}

/** Opções da etapa que junta as cenas: lista de cenas (na ordem) e o arquivo final, só caminhos do projeto. */
/** Estilos de transição entre as cenas (nomes do ffmpeg xfade); "corte" = sem transição. */
export const TRANSICOES = ['fade', 'fadeblack', 'fadewhite', 'dissolve', 'wipeleft', 'wiperight', 'slideleft', 'slideright', 'slideup', 'circleopen', 'circleclose', 'smoothleft', 'zoomin', 'corte'];

/** Trilha de fundo: um áudio do projeto ou a descrição da música que o Google (Lyria) compõe; volume 0–1. */
/** Narração (voz): Kokoro local por padrão, Gemini paga opcional, ou um áudio pronto do projeto. */
function narracaoValida(key: string, n: any): { texto?: string; arquivo?: string; voz?: string; motor?: MotorNarracao; velocidade?: number; pronuncias?: Record<string, string>; volumeFundoSobVoz?: number; ritmo?: 'calmo' | 'natural' | 'dinamico'; trechos?: Array<{ texto: string; intencao?: 'chamada' | 'destaque' | 'pergunta' | 'natural'; velocidade?: number; pausaAposMs?: number }> } {
  if (!n || typeof n !== 'object') throw new BadRequestException(`Etapa ${key}: narracao deve ser {"texto":"..."} ou {"arquivo":"audio/voz.mp3"}`);
  const out: ReturnType<typeof narracaoValida> = {};
  if (n.arquivo !== undefined) {
    const a = caminhoDoProjeto(n.arquivo);
    if (!a || !/\.(mp3|wav|m4a|aac|ogg)$/i.test(a)) throw new BadRequestException(`Etapa ${key}: narracao.arquivo deve ser um áudio do projeto (mp3, wav, m4a, aac, ogg)`);
    out.arquivo = a;
  }
  if (n.texto !== undefined && String(n.texto).trim()) out.texto = String(n.texto).trim().slice(0, 5000);
  if (n.trechos !== undefined) {
    if (!Array.isArray(n.trechos) || n.trechos.length < 1 || n.trechos.length > 12 || out.arquivo)
      throw new BadRequestException(`Etapa ${key}: trechos devem ter entre 1 e 12 frases e não podem acompanhar áudio pronto`);
    const partes: NonNullable<typeof out.trechos> = [];
    for (const [i, trecho] of n.trechos.entries()) {
      if (!trecho || typeof trecho.texto !== 'string' || !trecho.texto.trim() || trecho.texto.length > 700)
        throw new BadRequestException(`Etapa ${key}: texto inválido no trecho ${i + 1}`);
      const t: typeof partes[number] = { texto: trecho.texto.trim() };
      if (trecho.intencao !== undefined) {
        if (!['chamada', 'destaque', 'pergunta', 'natural'].includes(trecho.intencao))
          throw new BadRequestException(`Etapa ${key}: intenção inválida no trecho ${i + 1}`);
        t.intencao = trecho.intencao;
      }
      if (trecho.velocidade !== undefined) {
        if (typeof trecho.velocidade !== 'number' || !Number.isFinite(trecho.velocidade) || trecho.velocidade < 0.75 || trecho.velocidade > 1.25)
          throw new BadRequestException(`Etapa ${key}: velocidade inválida no trecho ${i + 1}`);
        t.velocidade = trecho.velocidade;
      }
      if (trecho.pausaAposMs !== undefined) {
        if (!Number.isInteger(trecho.pausaAposMs) || trecho.pausaAposMs < 0 || trecho.pausaAposMs > 1500)
          throw new BadRequestException(`Etapa ${key}: pausaAposMs inválida no trecho ${i + 1}`);
        t.pausaAposMs = trecho.pausaAposMs;
      }
      partes.push(t);
    }
    if (partes.reduce((sum, t) => sum + t.texto.length, 0) > 5000)
      throw new BadRequestException(`Etapa ${key}: trechos excedem o limite de texto`);
    out.trechos = partes;
  }
  if (!out.arquivo && !out.texto && !out.trechos?.length)
    throw new BadRequestException(`Etapa ${key}: narração exige texto, trechos ou arquivo`);
  const motor = n.motor === undefined ? undefined : String(n.motor).trim().toLowerCase();
  if (motor !== undefined && motor !== 'kokoro' && motor !== 'gemini') throw new BadRequestException(`Etapa ${key}: narracao.motor deve ser "kokoro" ou "gemini"`);
  if (motor) out.motor = motor as MotorNarracao;
  if (n.voz !== undefined && String(n.voz).trim()) {
    const v = vozConhecida(String(n.voz).trim());
    if (!v) throw new BadRequestException(`Etapa ${key}: narracao.voz "${String(n.voz).trim()}" não existe. Vozes: ${VOZES_NARRACAO.map((x) => `${x.id} (${x.genero})`).join(', ')}`);
    if (out.motor && v.motor !== out.motor) throw new BadRequestException(`Etapa ${key}: a voz ${v.id} pertence ao motor ${v.motor}, não ao ${out.motor}`);
    out.motor ??= v.motor;
    out.voz = v.id;
  } else if (out.motor) {
    out.voz = vozPadraoDoMotor(out.motor);
  }
  if (n.ritmo !== undefined) {
    if (!['calmo', 'natural', 'dinamico'].includes(n.ritmo))
      throw new BadRequestException(`Etapa ${key}: narracao.ritmo deve ser calmo, natural ou dinamico`);
    out.ritmo = n.ritmo;
  }
  if (n.velocidade !== undefined) {
    const v = Number(n.velocidade);
    if (!(v >= 0.75 && v <= 1.25)) throw new BadRequestException(`Etapa ${key}: narracao.velocidade deve ficar entre 0.75 e 1.25`);
    out.velocidade = v;
  }
  if (n.pronuncias !== undefined) {
    if (!n.pronuncias || typeof n.pronuncias !== 'object' || Array.isArray(n.pronuncias)) throw new BadRequestException(`Etapa ${key}: narracao.pronuncias deve ser um objeto {"texto original":"pronúncia"}`);
    const entradas = Object.entries(n.pronuncias);
    if (entradas.length > 50) throw new BadRequestException(`Etapa ${key}: narracao.pronuncias aceita no máximo 50 substituições`);
    const pronuncias: Record<string, string> = {};
    for (const [de, para] of entradas) {
      const d = de.trim().slice(0, 100);
      const p = String(para).trim().slice(0, 100);
      if (d && p) pronuncias[d] = p;
    }
    if (Object.keys(pronuncias).length) out.pronuncias = pronuncias;
  }
  if (n.volumeFundoSobVoz !== undefined) {
    const v = Number(n.volumeFundoSobVoz);
    if (!(v >= 0 && v <= 1)) throw new BadRequestException(`Etapa ${key}: narracao.volumeFundoSobVoz deve ser entre 0 e 1`);
    out.volumeFundoSobVoz = v;
  }
  return out;
}

function trilhaValida(key: string, t: any): { arquivo?: string; descricao?: string; volume?: number } {
  if (!t || typeof t !== 'object') throw new BadRequestException(`Etapa ${key}: trilha deve ser {"descricao":"..."} ou {"arquivo":"audio/musica.mp3"}`);
  const out: { arquivo?: string; descricao?: string; volume?: number } = {};
  if (t.arquivo !== undefined) {
    const a = caminhoDoProjeto(t.arquivo);
    if (!a || !/\.(mp3|wav|m4a|aac|ogg)$/i.test(a)) throw new BadRequestException(`Etapa ${key}: trilha.arquivo deve ser um áudio do projeto (mp3, wav, m4a, aac, ogg)`);
    out.arquivo = a;
  }
  if (t.descricao !== undefined && String(t.descricao).trim()) out.descricao = String(t.descricao).trim().slice(0, 1000);
  if (!out.arquivo && !out.descricao) throw new BadRequestException(`Etapa ${key}: trilha precisa de "descricao" (música gerada) ou "arquivo" (áudio do projeto)`);
  if (t.volume !== undefined) {
    const v = Number(t.volume);
    if (!(v > 0 && v <= 1)) throw new BadRequestException(`Etapa ${key}: trilha.volume deve ser entre 0 e 1`);
    out.volume = v;
  }
  return out;
}

function transicaoValida(key: string, t: unknown): string {
  const v = String(t).trim().toLowerCase();
  if (!TRANSICOES.includes(v)) throw new BadRequestException(`Etapa ${key}: transicao deve ser uma de: ${TRANSICOES.join(', ')}`);
  return v;
}

export function opcoesDeJuncao(key: string, o: any): { cenas: string[]; arquivo: string; legendas?: string[]; transicoes?: string[]; trilha?: ReturnType<typeof trilhaValida>; volumeCenas?: number; cortes?: Array<{ inicio?: number; fim?: number; velocidade?: number } | null>; narracao?: ReturnType<typeof narracaoValida>; sincronizarVideoComNarracao?: boolean } {
  const cenas: string[] = normalizarCenasDeMontagem(o).map((c: unknown): string => {
    const caminho = caminhoDoProjeto(c);
    if (!caminho || !/\.(mp4|mov|webm)$/i.test(caminho))
      throw new BadRequestException(`Etapa ${key}: "cenas" deve ser a lista de vídeos do projeto, na ordem`);
    return caminho;
  });
  if (!cenas.length) throw new BadRequestException(`Etapa ${key}: "cenas" deve ser a lista de vídeos do projeto, na ordem`);
  if (cenas.length > 200) throw new BadRequestException(`Etapa ${key}: no máximo 200 cenas`);
  const arquivo = caminhoDoProjeto(o.arquivo) ?? '';
  if (!/\.mp4$/i.test(arquivo)) throw new BadRequestException(`Etapa ${key}: "arquivo" deve ser um caminho do projeto terminando em .mp4`);
  if (cenas.includes(arquivo)) throw new BadRequestException(`Etapa ${key}: o vídeo final não pode ter o nome de uma cena`);
  const out: ReturnType<typeof opcoesDeJuncao> = { cenas, arquivo };
  if (o.trilha !== undefined) out.trilha = trilhaValida(key, o.trilha);
  if (o.volumeCenas !== undefined) {
    const v = Number(o.volumeCenas);
    if (!(v >= 0 && v <= 1)) throw new BadRequestException(`Etapa ${key}: volumeCenas deve ser entre 0 (sem o som das cenas) e 1`);
    out.volumeCenas = v;
  }
  if (Array.isArray(o.legendas) && o.legendas.some((l: unknown) => String(l ?? '').trim())) out.legendas = cenas.map((_: string, i: number) => String(o.legendas[i] ?? '').trim().slice(0, 300));
  if (o.transicao !== undefined || Array.isArray(o.transicoes)) {
    const lista = Array.isArray(o.transicoes) ? o.transicoes : [];
    out.transicoes = cenas.slice(1).map((_: string, i: number) => transicaoValida(key, lista[i] ?? o.transicao ?? 'fade'));
  }
  // Recorte/velocidade por clipe (edição): cortes[i] = { inicio, fim, velocidade } alinhado com cenas.
  if (Array.isArray(o.cortes) && o.cortes.some((c: unknown) => c && typeof c === 'object')) {
    const cortes = cenas.map((_: string, i: number) => {
      const c = o.cortes[i];
      if (!c || typeof c !== 'object') return null;
      const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
      const inicio = n(c.inicio);
      const fim = n(c.fim);
      const velocidade = n(c.velocidade);
      if (inicio !== undefined && inicio < 0) throw new BadRequestException(`Etapa ${key}: corte ${i + 1} tem início negativo`);
      if (fim !== undefined && inicio !== undefined && fim <= inicio) throw new BadRequestException(`Etapa ${key}: corte ${i + 1} tem fim menor ou igual ao início`);
      if (velocidade !== undefined && !(velocidade >= 0.25 && velocidade <= 8)) throw new BadRequestException(`Etapa ${key}: velocidade do corte ${i + 1} deve ser entre 0.25 e 8`);
      const r: { inicio?: number; fim?: number; velocidade?: number } = {};
      if (inicio) r.inicio = inicio;
      if (fim !== undefined) r.fim = fim;
      if (velocidade !== undefined && velocidade !== 1) r.velocidade = velocidade;
      return Object.keys(r).length ? r : null;
    });
    if (!cortes.every((c: unknown) => c === null)) out.cortes = cortes;
  }
  if (o.narracao !== undefined) out.narracao = narracaoValida(key, o.narracao);
  if (o.sincronizarVideoComNarracao !== undefined) {
    if (typeof o.sincronizarVideoComNarracao !== 'boolean') throw new BadRequestException(`Etapa ${key}: sincronizarVideoComNarracao deve ser booleano`);
    if (o.sincronizarVideoComNarracao && !out.narracao) throw new BadRequestException(`Etapa ${key}: sincronização exige narração`);
    out.sincronizarVideoComNarracao = o.sincronizarVideoComNarracao;
  }
  return out;
}

/**
 * Plano com duas ou mais cenas de vídeo ganha, sozinho, a etapa final que junta tudo num vídeo só (o Omni
 * gera de 4 a 8 s por vez; quem pediu o vídeo quer o vídeo inteiro). Se o plano já tem a etapa, nada muda.
 * Nome do final: `<pasta das cenas>/<pasta>-completo.mp4` (ex.: videos/pizzaria/pizzaria-completo.mp4).
 */
export function comVideoCompleto(entrada: unknown, defaultProvider: string): unknown {
  if (!Array.isArray(entrada)) return entrada;
  let raw: any[] = entrada;
  if (raw.some((s: any) => (s?.provider ?? defaultProvider) === 'juntar-videos')) return raw;
  let cenas = raw.filter((s: any) => (s?.provider ?? defaultProvider) === 'gemini-video' && typeof s?.key === 'string');
  if (cenas.length < 2) return raw;
  // Com trilha de fundo, as cenas vêm SEM música própria (só falas e sons do ambiente): a música corre única,
  // de ponta a ponta, na montagem.
  const trilha = cenas.map((s: any) => s.providerOptions?.trilha).find((t: unknown) => t);
  const narracao = cenas.map((s: any) => s.providerOptions?.narracao).find((n: unknown) => n);
  if (trilha) {
    raw = raw.map((s: any) => (cenas.includes(s) ? { ...s, providerOptions: { ...(s.providerOptions ?? {}), semMusica: true } } : s));
    cenas = raw.filter((s: any) => (s?.provider ?? defaultProvider) === 'gemini-video' && typeof s?.key === 'string');
  }
  if (narracao) {
    raw = raw.map((s: any) => (cenas.includes(s) ? { ...s, providerOptions: { ...(s.providerOptions ?? {}), semAudio: true } } : s));
    cenas = raw.filter((s: any) => (s?.provider ?? defaultProvider) === 'gemini-video' && typeof s?.key === 'string');
  }
  const arquivos = cenas.map((s: any) => caminhoDoProjeto(s.providerOptions?.arquivo ?? `videos/${s.key}.mp4`));
  if (arquivos.some((a) => !a)) return raw; // a validação da cena aponta o erro
  const pastas = [...new Set(arquivos.map((a) => path.posix.dirname(a as string)))];
  const pasta = pastas.length === 1 && pastas[0] !== '.' ? pastas[0] : 'videos';
  const nome = pasta === 'videos' ? 'video' : path.posix.basename(pasta);
  let arquivo = `${pasta}/${nome}-completo.mp4`;
  for (let n = 2; arquivos.includes(arquivo); n++) arquivo = `${pasta}/${nome}-completo-${n}.mp4`;
  const chaves = new Set(raw.map((s: any) => String(s?.key)));
  let key = 'video-completo';
  for (let n = 2; chaves.has(key); n++) key = `video-completo-${n}`;
  return [
    ...raw,
    {
      key,
      title: 'Juntar as cenas no vídeo completo',
      provider: 'juntar-videos',
      instructions: `Junta as ${cenas.length} cenas, na ordem, em ${arquivo}.`,
      dependsOn: cenas.map((s: any) => s.key),
      providerOptions: {
        cenas: arquivos,
        arquivo,
        // Legenda de cada cena (se o plano trouxe) e a transição escolhida em cada cena para a seguinte.
        ...(cenas.some((s: any) => String(s.providerOptions?.legenda ?? '').trim()) ? { legendas: cenas.map((s: any) => String(s.providerOptions?.legenda ?? '').trim()) } : {}),
        ...(cenas.some((s: any) => s.providerOptions?.transicao) ? { transicoes: cenas.slice(0, -1).map((s: any) => String(s.providerOptions?.transicao ?? 'fade')) } : {}),
        ...(trilha ? { trilha } : {}),
        ...(narracao ? { narracao, volumeCenas: 0 } : {}),
      },
    },
  ];
}
