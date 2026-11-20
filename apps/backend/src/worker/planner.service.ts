import { caminhoDoProjeto } from '../common/path-guard';
import { ferramentasDaIa } from '../providers/ferramentas';
import { mcpDoProjeto } from '../mcp/mcp';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Anexo, copiarAnexosParaSessao, descreverAnexo } from '../conversations/attachments';
import { ehFalhaDeLogin } from '../accounts/connections';
import { trocarParaReserva } from '../projects/mover-trabalho';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { minimalEnv, runProcess } from '../common/exec';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { ClaimedTask, QueueService } from '../queue/queue.service';
import { AGENT_RULES } from '../security/policy';
import { SESSION_CONTEXT_DIR, WorkspaceService } from '../storage/workspace.service';
import { listarVideos } from '../projects/midia';
import { contextoDaOrigem } from '../projects/origem-context';
import { descreverVoz } from '../providers/vozes';
import { ArtifactStoreService } from '../storage/artifact-store.service';
import { jobsDaConversa } from '../conversations/jobs-da-conversa';
import { ConversationsService } from '../conversations/conversations.service';
import { infoDeVersao, textoDaVersao } from '../git/versao';
import { bancoDeTesteDisponivel, TEXTO_BANCO_DE_TESTE } from '../common/banco-de-teste';
import { TEXTO_FOTOS, TEXTO_PADRAO_DAS_TELAS, TEXTO_ROTEIRO, TEXTO_SISTEMA_RODANDO } from '../common/exec';
import { VIDEO_QUALITY_POLICY } from '../jobs/video-quality-policy';
import { historicoGit, textoDoRepositorio } from '../git/contexto-git';
import { projectModel } from './step-executor.service';
import { ProjectProfileService } from '../projects/project-profile.service';
import { memoryLine, sortMemory } from './context-builder';
import { sha256 } from '../common/hash';
import { registrarErro } from '../diagnostico/erros';
import { escreverArquivosDaMemoria, gravarNoProjeto } from '../memory/camadas';

const MAX_MEMORIA = 15_000;
const MAX_ARQUIVOS = 300;

/**
 * Responde mensagens da conversa do projeto. Roda no worker, numa CÓPIA DESCARTÁVEL da pasta principal
 * do projeto (com contexto/: padrões da base e conhecimento): a IA lê o que precisar, mas nada do que
 * fizer ali é aproveitado. Sempre com o perfil do projeto e a IA escolhida para ele.
 * Resultado: uma resposta em texto ou um plano (rascunho de job) que só vira trabalho com aprovação.
 */
/** Vídeos que o usuário enviou/editou (modo edição): a IA os referencia por midia/entrada|saida/<arquivo>. */
function textoDosVideos(videos: ReturnType<typeof listarVideos>): string[] {
  const enviados = videos.filter((v) => v.pasta === 'entrada');
  if (!enviados.length) return [];
  const mb = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
  return [
    `Vídeos e áudios (trilha/narração) que o usuário já enviou para EDITAR/MONTAR (use estes caminhos; .wav/.mp3 é trilha ou locução própria, use como áudio na montagem; são ffmpeg, sem Omni e sem custo): ${enviados
      .slice(0, 40)
      .map((v) => `${v.caminho} (${v.nome}, ${mb(v.bytes)})`)
      .join('; ')}. O vídeo editado sai em midia/saida/<nome>.mp4 (fora do git).`,
  ];
}

@Injectable()
export class PlannerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly registry: ProviderRegistry,
    private readonly workspace: WorkspaceService,
    private readonly jobs: JobsService,
    private readonly profiles: ProjectProfileService,
    private readonly artifacts: ArtifactStoreService,
    private readonly conversations: ConversationsService,
  ) {}

  async handle(task: ClaimedTask, workerId: string, signal: AbortSignal): Promise<void> {
    const msg = await this.prisma.conversationMessage.findUnique({
      where: { id: task.messageId! },
      include: { conversation: { include: { project: { include: { area: true } } } } },
    });
    if (!msg || msg.status !== 'PENDENTE') {
      await this.queue.complete(task.id, workerId);
      return;
    }
    // Uma resposta por vez em cada conversa: a mais antiga primeiro (ex.: a entrega de um trabalho chega
    // enquanto a IA ainda responde ao usuário).
    const antes = await this.prisma.conversationMessage.findFirst({
      where: { conversationId: msg.conversationId, status: 'PENDENTE', id: { not: msg.id }, createdAt: { lte: msg.createdAt } },
      orderBy: { createdAt: 'asc' },
    });
    if (antes && (antes.createdAt < msg.createdAt || antes.id < msg.id)) {
      await this.queue.requeue(task.id, workerId, new Date(Date.now() + 5_000), 'espera a resposta anterior da conversa');
      return;
    }
    const project = msg.conversation.project;
    const fail = async (texto: string) => {
      // Só se ainda estiver pendente: o usuário pode ter cancelado a resposta.
      await this.prisma.conversationMessage.updateMany({ where: { id: msg.id, status: 'PENDENTE' }, data: { status: 'ERRO', kind: 'erro', content: texto } });
      await this.queue.complete(task.id, workerId);
    };

    // Limite de gasto do projeto vale também para a conversa (trabalhos + respostas).
    if (project.maxCostUsd !== null) {
      const [jobs, conversa] = await Promise.all([
        this.prisma.job.aggregate({ where: { projectId: project.id }, _sum: { costSpentUsd: true } }),
        this.prisma.conversationMessage.aggregate({ where: { conversation: { projectId: project.id } }, _sum: { costUsd: true } }),
      ]);
      const gasto = Number(jobs._sum.costSpentUsd ?? 0) + Number(conversa._sum.costUsd ?? 0);
      if (gasto >= Number(project.maxCostUsd)) {
        return fail(`O projeto atingiu o limite de gasto (US$ ${gasto.toFixed(2)} de US$ ${Number(project.maxCostUsd).toFixed(2)}). Aumente o limite em Ajustes para continuar.`);
      }
    }

    // A IA escolhida para o projeto conversa e trabalha; o perfil do projeto vale para qualquer uma.
    let providerId = project.provider;
    if (!this.registry.has(providerId)) return fail(`IA desconhecida: ${providerId}`);
    let status = await this.registry.status(providerId, 15_000);
    let trocou = '';
    if (!status.available) {
      // IA reserva do projeto: responde com a próxima conectada em vez de parar.
      const reserva = await trocarParaReserva(this.prisma, this.registry, project.id, providerId).catch(() => null);
      if (reserva) {
        trocou = `(${reserva.anterior} está indisponível; quem respondeu foi ${reserva.nome}, que agora é a IA do projeto.)\n\n`;
        providerId = reserva.id;
        project.provider = reserva.id;
        status = await this.registry.status(providerId, 0);
      }
    }
    if (!status.available) {
      return fail(`A IA deste projeto (${status.label}) não está conectada: ${status.errors.join('; ')}. Conecte em "Conexões" e envie a mensagem de novo.`);
    }

    // Cópia descartável: pasta principal do projeto + contexto/ (padrões da base e conhecimento).
    const tmp = path.join(project.workspacePath, 'conversas-tmp', msg.id);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    try {
      const repo = this.workspace.projectDirs(project.dirKey).repo;
      await runProcess('bash', ['-c', 'git -C "$1" archive main | tar -x -C "$2"', '_', repo, tmp], { cwd: tmp, env: minimalEnv(), timeoutMs: 120_000 });
      this.workspace.prepareSessionContext(project.area.slug, project.dirKey, tmp);
      // A cópia não tem .git: o histórico vai num arquivo (e o prompt explica que "not a git repository" é esperado).
      fs.writeFileSync(path.join(tmp, SESSION_CONTEXT_DIR, 'historico-git.txt'), await historicoGit(repo));
      // Instruções de agente do repositório do projeto: legíveis em contexto/repositorio/, inertes.
      const harness = (await runProcess('bash', ['-c', 'git -C "$1" ls-tree -r --name-only main', '_', repo], { cwd: tmp, env: minimalEnv(), timeoutMs: 60_000 })).stdout
        .split('\n')
        .filter((f) => f && f.split('/').some((seg) => WorkspaceService.HARNESS_FILES.includes(seg)));
      await this.workspace.hideRepoHarness(tmp, harness);
      this.workspace.sanitizeHarnessFiles(tmp);
      // Anexos da conversa (mais recentes primeiro): imagens para ver, documentos já em texto.
      const comAnexos = await this.prisma.conversationMessage.findMany({
        where: { conversationId: msg.conversationId, role: 'USUARIO', NOT: { attachments: { equals: Prisma.DbNull } } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, conversationId: true, attachments: true },
      });
      const anexos = copiarAnexosParaSessao(this.workspace.projectDirs(project.dirKey).root, tmp, comAnexos);
      // Resultados dos trabalhos desta conversa (relatórios, inventários, planos em out/): ficam fora do repositório,
      // mas a IA precisa lê-los para apresentar a entrega e para seguir ("pode fazer a limpeza").
      const resultados = await this.artifacts.copiarResultados(project.id, await jobsDaConversa(this.prisma, msg.conversationId), path.join(tmp, SESSION_CONTEXT_DIR, 'resultados'));

      const profile = await this.profiles.build(project.id);
      const entrega = msg.kind === 'entrega' && msg.jobId ? await this.dadosDaEntrega(msg.jobId, project.dirKey) : null;
      const prompt = await this.buildPrompt(msg.conversationId, msg.id, project, profile.text, anexos, entrega, providerId, resultados);
      // Andamento ao vivo: a última atividade da IA vai para a mensagem (no máximo a cada 3 s), e a tela mostra.
      let ultimaGravacao = 0;
      let pendenteAndamento: string | null = null;
      let gravando: Promise<unknown> | null = null;
      const gravarAndamento = (linha: string) => {
        pendenteAndamento = linha.slice(0, 300);
        if (gravando || Date.now() - ultimaGravacao < 3000) return;
        ultimaGravacao = Date.now();
        const texto = pendenteAndamento;
        pendenteAndamento = null;
        gravando = this.prisma.conversationMessage
          .updateMany({ where: { id: msg.id, status: 'PENDENTE' }, data: { andamento: texto } })
          .catch(() => undefined)
          .finally(() => (gravando = null));
      };
      const result = await this.registry.get(providerId).execute({
        jobId: 'conversa',
        stepId: msg.conversationId,
        attemptId: msg.id,
        instructions: prompt,
        context: '',
        cwd: tmp,
        outputDir: path.join(tmp, 'out'),
        systemPrompt: profile.text,
        mcp: mcpDoProjeto(project.id, { mensagemId: msg.id }),
        timeoutMs: Number(process.env.NIVOO_PLANNER_TIMEOUT_SEC ?? 900) * 1000,
        signal,
        options: {
          maxTurns: Math.min(20,Math.max(1,Number(process.env.NIVOO_PLANNER_MAX_TURNS ?? 20))),
          model: projectModel(project, providerId),
          // Imagens anexadas: quem aceita imagem pela linha de comando (ChatGPT/Codex) recebe-as direto também.
          images: anexos.filter((a) => a.tipo === 'imagem').map((a) => path.join(tmp, a.caminho)),
        },
        onLog: (linha) => gravarAndamento(linha),
      });
      await gravando;
      if (result.interrupted) {
        // Lease perdido: outro worker vai assumir; nada é gravado aqui.
        return;
      }
      this.registry.registrarResultado(providerId, result.exitCode === 0 && !result.resourceUnavailable, result.error); // só o canal de erro, nunca o texto da IA (código e logs do projeto citam 401…)
      // Sem crédito/limite no meio da resposta: se houver IA reserva, a mesma pergunta vai para ela.
      if (result.resourceUnavailable) {
        const reserva = await trocarParaReserva(this.prisma, this.registry, project.id, providerId).catch(() => null);
        if (reserva) {
          await this.prisma.conversationMessage.create({
            data: { conversationId: msg.conversationId, role: 'ASSISTENTE', status: 'PRONTA', kind: 'sistema', content: `${reserva.anterior} ficou indisponível (${(result.error ?? '').slice(0, 200)}). Quem responde agora é ${reserva.nome}, que passou a ser a IA do projeto.` },
          });
          await this.queue.requeue(task.id, workerId, new Date(), 'resposta refeita com a IA reserva');
          return;
        }
      }
      let parsed = extractJson(result.output);
      let kind = 'resposta';
      let content = result.output.trim();
      let plan: Prisma.InputJsonValue | undefined;
      let erro: string | null = null;
      if (result.resourceUnavailable && ehFalhaDeLogin(result.error)) {
        erro = `A ${status.label} recusou o login (o acesso expirou ou foi revogado): ${result.error ?? ''}. Reconecte em "Conexões" ou continue com outra IA.`.trim();
      } else if (result.resourceUnavailable) erro = `IA indisponível no momento (limite ou login): ${result.error ?? ''}`.trim();
      else if (result.exitCode !== 0 && !result.sessionEnded) {
        const tempo = /^timeout após (\d+) ms/.exec(result.error ?? '');
        erro = tempo
          ? `A IA não respondeu em ${Math.round(Number(tempo[1]) / 60000)} minutos (o servidor dela pode estar lento ou sobrecarregado). Envie a mensagem de novo; se repetir, troque a IA do projeto no topo da conversa.`
          : `A IA não conseguiu responder: ${result.error ?? 'erro desconhecido'}`;
      }
      else if (!parsed && !content) {
        erro = result.sessionEnded
          ? 'A IA usou todos os passos desta resposta sem terminar (pedido grande demais para uma resposta). Envie "continue", ou peça por partes.'
          : 'A IA terminou sem responder nada. Envie a mensagem de novo; se repetir, troque a IA do projeto no topo da conversa.';
      } else if (parsed?.tipo === 'plano') {
        try {
          // Quem trabalha é sempre a IA escolhida para o projeto.
          const validado = this.jobs.validatePlan({ ...parsed.job, defaultProvider: providerId });
          // Anexos que o plano coloca no projeto (o sistema copia ao aprovar; só anexos desta conversa).
          const noProjeto = Array.isArray(parsed.job?.anexosNoProjeto)
            ? parsed.job.anexosNoProjeto
                .filter((x: any) => anexos.some((a) => a.caminho === String(x?.anexo ?? '')) && caminhoDoProjeto(x?.para))
                .map((x: any) => ({ anexo: String(x.anexo), para: caminhoDoProjeto(x.para) as string }))
            : [];
          plan = { ...validado, ...(noProjeto.length ? { anexosNoProjeto: noProjeto } : {}) } as unknown as Prisma.InputJsonValue;
          kind = 'plano';
          content = String(parsed.texto ?? 'Plano proposto.');
        } catch (e: any) {
          // Um plano inválido não deve ser devolvido ao usuário para ele depurar JSON.
          // Uma única correção interna, com o erro exato do contrato, e nova validação.
          // Sem executar trabalho nem inventar limiares numéricos.
          const erroInicial = String(e?.response?.message ?? e?.message ?? 'plano inválido').slice(0, 700);
          let reparoErro = erroInicial;
          gravarAndamento('Conferindo o plano: ajustando uma configuração inválida antes de apresentar.');
          try {
            const instrucaoReparo = [
              'Corrija SOMENTE a estrutura do plano JSON anterior. Não execute nada.',
              'O validador do backend rejeitou o plano por: ' + erroInicial,
              'Preserve objetivo, scripts e arquivos aprovados, etapas e seus comandos corretos.',
              'Use apenas valores comprovados. Em METRIC_THRESHOLD, config.value tem de ser um número real',
              'explicitamente derivado do requisito; caso contrário use FILE_EXISTS, ARTIFACT_PRESENT',
              'ou COMMAND com verificação determinística adequada, nunca invente uma métrica.',
              'Não retire critérios importantes nem troque uma checagem semântica por simples existência',
              'para forçar aprovação. Prefira um critério operacional que prove a entrega pretendida.',
              'Responda SOMENTE um bloco JSON completo de tipo plano, com job íntegro.',
              'JSON ANTERIOR:',
              JSON.stringify(parsed).slice(0, 24000),
            ].join('\n');
            const reparo = await this.registry.get(providerId).execute({
              jobId: 'conversa', stepId: msg.conversationId, attemptId: msg.id,
              instructions: instrucaoReparo, context: '', cwd: tmp,
              outputDir: path.join(tmp, 'out'), systemPrompt: profile.text,
              mcp: mcpDoProjeto(project.id, { mensagemId: msg.id }),
              timeoutMs: Math.min(180_000, Number(process.env.NIVOO_PLANNER_TIMEOUT_SEC ?? 900) * 1000),
              signal,
              options: { maxTurns: 3, model: projectModel(project, providerId) },
              onLog: (linha) => gravarAndamento(linha),
            });
            if (reparo.interrupted || signal.aborted) return;
            if (reparo.exitCode !== 0 || reparo.resourceUnavailable) throw new Error(reparo.error ?? 'reparo indisponível');
            const corrigido = extractJson(reparo.output);
            if (corrigido?.tipo !== 'plano' || !corrigido.job) throw new Error('A correção não retornou um plano estruturado');
            const validado = this.jobs.validatePlan({ ...corrigido.job, defaultProvider: providerId });
            const noProjeto = Array.isArray(corrigido.job?.anexosNoProjeto)
              ? corrigido.job.anexosNoProjeto
                  .filter((x: any) => anexos.some((a) => a.caminho === String(x?.anexo ?? '')) && caminhoDoProjeto(x?.para))
                  .map((x: any) => ({ anexo: String(x.anexo), para: caminhoDoProjeto(x.para) as string }))
              : [];
            plan = { ...validado, ...(noProjeto.length ? { anexosNoProjeto: noProjeto } : {}) } as unknown as Prisma.InputJsonValue;
            parsed = corrigido;
            kind = 'plano';
            content = String(corrigido.texto ?? parsed.texto ?? 'Plano conferido e corrigido.');
          } catch (erroReparo: any) {
            reparoErro = String(erroReparo?.response?.message ?? erroReparo?.message ?? 'reparo inválido').slice(0, 700);
            kind = 'resposta';
            content = `A configuração do plano ainda está inválida e não será executada. Erro: ${reparoErro}. A versão anterior foi preservada. O Nivoo tentou uma correção interna, mas não conseguiu validá-la.`;
          }
        }
      } else if (parsed?.tipo === 'resposta') {
        content = String(parsed.texto ?? '');
      } else if (!parsed && /```json|"tipo"\s*:/.test(result.output)) {
        // JSON sem conserto: recupera ao menos o texto da resposta e guarda a resposta original para o diagnóstico.
        const salvo = salvarTextoDaResposta(result.output);
        const antes = result.output.split('```json')[0].trim();
        registrarErro('worker', `resposta da IA com JSON ilegível (conversa ${msg.conversationId}, mensagem ${msg.id}); fim da resposta: ${result.output.slice(-3000)}`);
        content = salvo
          ? `${salvo}\n\n[Parte estruturada da resposta (plano, perguntas ou memória) veio quebrada e ficou de fora. Se faltar o plano, peça "mande o plano de novo".]`
          : `${antes}\n\n[A resposta da IA veio com o plano quebrado (JSON inválido) e não pôde ser lida. Peça "mande o plano de novo".]`.trim();
      }
      if (!erro && Array.isArray(parsed?.memoria)) {
        const guardados = await this.saveMemory(project.id, msg.conversationId, msg.id, parsed.memoria);
        if (guardados.length) content = `${content}\n\nGuardei na memória do projeto: ${guardados.join('; ')}.`;
      }
      const perguntas = erro ? null : normalizarPerguntas(parsed?.perguntas);
      // Perguntas e plano juntos: o plano espera as respostas (senão dá para clicar em "Fazer" antes de responder e o
      // plano não leva as respostas em conta). A IA manda o plano de novo depois que o usuário responder.
      if (perguntas && plan) {
        plan = undefined;
        kind = 'resposta';
        content = `${content}\n\nDepois das suas respostas, eu mando o plano.`.trim();
      }
      // A entrega continua sendo o relatório; se ela traz o plano do que falta, ele vira uma mensagem de plano à parte.
      const planoDaEntrega = msg.kind === 'entrega' && plan ? plan : undefined;
      const gravada = await this.prisma.conversationMessage.updateMany({
        where: { id: msg.id, status: 'PENDENTE' },
        data: {
          status: erro ? 'ERRO' : 'PRONTA',
          kind: erro ? 'erro' : msg.kind === 'entrega' ? 'entrega' : kind,
          content: erro ?? `${trocou}${content || '(sem resposta)'}`,
          plan: planoDaEntrega ? undefined : plan,
          ...(perguntas ? { perguntas: perguntas as unknown as Prisma.InputJsonValue } : {}),
          sessionId: result.sessionId,
          costUsd: result.costUsd ?? 0,
        },
      });
      // Resposta cancelada pelo usuário enquanto a IA trabalhava: o custo da sessão conta mesmo assim.
      if (!gravada.count) await this.prisma.conversationMessage.update({ where: { id: msg.id }, data: { sessionId: result.sessionId, costUsd: result.costUsd ?? 0 } });
      if (gravada.count && !erro && plan) {
        const alvo = planoDaEntrega
          ? (await this.prisma.conversationMessage.create({ data: { conversationId: msg.conversationId, role: 'ASSISTENTE', status: 'PRONTA', kind: 'plano', content: String(parsed?.texto ?? 'Plano do que falta.'), plan: planoDaEntrega } })).id
          : msg.id;
        await this.seguirSozinho(project.id, msg.conversationId, alvo, parsed?.continuacao === true);
      }
      await this.queue.complete(task.id, workerId);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  /**
   * Seguir até o fim: plano que CONTINUA um pedido já feito/aprovado nesta conversa (a próxima parte, ou depois das
   * respostas do usuário) começa sozinho, sem esperar o "Fazer" — se o projeto deixa (Ajustes: "seguir sozinho") e sem
   * passar de NIVOO_SEGUIR_MAX planos seguidos sem nenhuma mensagem do usuário (proteção contra laço).
   */
  private async seguirSozinho(projectId: string, conversationId: string, messageId: string, continuacao: boolean): Promise<void> {
    if (!continuacao) return;
    // Autocorreções de trabalhos que já falharam são sempre manuais: o
    // assistente apresenta o diagnóstico, mas não dispara um novo job sem Fazer.
    const mensagem = await this.prisma.conversationMessage.findUnique({
      where: { id: messageId }, select: { conversationId: true },
    });
    if (mensagem?.conversationId) {
      const ultimaEntrega = await this.prisma.conversationMessage.findFirst({
        where: { conversationId: mensagem.conversationId, kind: 'entrega', jobId: { not: null } },
        orderBy: { createdAt: 'desc' }, select: { jobId: true },
      });
      if (ultimaEntrega?.jobId) {
        const jobAnterior = await this.prisma.job.findUnique({
          where: { id: ultimaEntrega.jobId }, select: { status: true },
        });
        if (jobAnterior?.status === 'BLOQUEADO' || jobAnterior?.status === 'FALHOU') return;
      }
    }
    const projeto = await this.prisma.project.findUnique({ where: { id: projectId }, select: { seguirSozinho: true } });
    if (!projeto?.seguirSozinho) return;
    // Só continua o que o usuário já pediu: precisa existir um plano aprovado por ele nesta conversa.
    const aprovadoPeloUsuario = await this.prisma.conversationMessage.findFirst({ where: { conversationId, approvedAt: { not: null }, NOT: { approvedBy: { startsWith: 'Nivoo' } } } });
    if (!aprovadoPeloUsuario) return;
    const ultimaDoUsuario = await this.prisma.conversationMessage.findFirst({ where: { conversationId, role: 'USUARIO' }, orderBy: { createdAt: 'desc' } });
    const seguidos = await this.prisma.conversationMessage.count({
      where: { conversationId, approvedBy: { startsWith: 'Nivoo' }, ...(ultimaDoUsuario ? { createdAt: { gt: ultimaDoUsuario.createdAt } } : {}) },
    });
    const max = Number(process.env.NIVOO_SEGUIR_MAX ?? 8);
    if (seguidos >= max) {
      await this.prisma.conversationMessage.create({
        data: { conversationId, role: 'ASSISTENTE', status: 'PRONTA', kind: 'sistema', content: `Já foram ${seguidos} etapas seguidas sem você falar nada: este plano espera o seu "Fazer" para continuar.` },
      });
      return;
    }
    await this.conversations.approve(projectId, conversationId, messageId, { decidedBy: 'Nivoo (seguindo o seu pedido)' }).catch(async (e) => {
      await this.prisma.conversationMessage.create({
        data: { conversationId, role: 'ASSISTENTE', status: 'PRONTA', kind: 'sistema', content: `Não consegui começar o próximo plano sozinho (${e?.message ?? e}); clique em "Fazer".` },
      });
    });
  }

  /**
   * Memória automática: decisões, preferências, fatos e pendências ditos na conversa viram memória do
   * projeto (fonte da verdade para todas as conversas e trabalhos seguintes). Deduplicada por conteúdo.
   */
  private async saveMemory(projectId: string, conversationId: string, messageId: string, itens: any[]): Promise<string[]> {
    const mapa: Record<string, 'DECISAO_APROVADA' | 'ARQUITETURA_RESTRICOES' | 'ESPECIFICACAO' | 'PENDENCIA'> = {
      DECISAO: 'DECISAO_APROVADA',
      PREFERENCIA: 'ARQUITETURA_RESTRICOES',
      FATO: 'ESPECIFICACAO',
      PENDENCIA: 'PENDENCIA',
    };
    const guardados: string[] = [];
    for (const it of itens.slice(0, 10)) {
      const category = mapa[String(it?.tipo ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()];
      const titulo = String(it?.titulo ?? '').trim().slice(0, 200);
      const conteudo = String(it?.conteudo ?? it?.texto ?? '').trim().slice(0, 5000);
      if (!category || !titulo || !conteudo) continue;
      // Uma entrada por assunto: o mesmo título com conteúdo novo ATUALIZA (a versão anterior vai para o histórico).
      const gravado = await gravarNoProjeto(this.prisma, {
        projectId, category, title: titulo, content: conteudo, author: 'conversa',
        references: { origem: 'conversa', conversationId, messageId },
      });
      if (!gravado) continue;
      guardados.push(titulo);
    }
    if (guardados.length) await escreverArquivosDaMemoria(this.prisma, projectId);
    return guardados;
  }

  /** O que a IA precisa para apresentar a entrega: o trabalho e os arquivos que ele criou/alterou/apagou. */
  private async dadosDaEntrega(jobId: string, dirKey: string): Promise<string> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, include: { objectives: { orderBy: { version: 'desc' }, take: 1 }, steps: { orderBy: { order: 'asc' } }, criteria: { include: { checks: { orderBy: { createdAt: 'desc' }, take: 1 } } }, attempts: { orderBy: { number: 'desc' }, take: 6 } } });
    if (!job) return '';
    // Trabalho que PAROU (bloqueado/falhou): a IA recebe o erro para DIAGNOSTICAR e PROPOR UM PLANO que conserta.
    if (job.status === 'BLOQUEADO' || job.status === 'FALHOU') {
      const logs = await this.prisma.logEntry.findMany({ where: { jobId }, orderBy: { id: 'desc' }, take: 18 });
      const etapaRuim = job.steps.find((s) => s.status === 'BLOQUEADO' || s.status === 'FALHOU') ?? job.steps[job.steps.length - 1];
      const tentativasDaEtapa = job.attempts.filter((a) => a.stepId === etapaRuim?.id).slice(0, 3);
      return [
        `O TRABALHO PAROU COM ERRO (não concluiu): "${job.title}" — status ${job.status}${job.blockedReason ? ` (${job.blockedReason})` : ''}.`,
        `Objetivo do trabalho: ${job.objectives[0]?.text ?? ''}`,
        `Motivo da parada: ${(job.statusDetail ?? '').replace(/\s+/g, ' ').slice(0, 800) || '(sem detalhe)'}`,
        `Etapa com problema: "${etapaRuim?.title || etapaRuim?.key}" (executor ${etapaRuim?.provider ?? job.defaultProvider}).`,
        ...tentativasDaEtapa.map((a) => `- tentativa #${a.number}: ${a.status}${a.error ? ` — ${a.error.replace(/\s+/g, ' ').slice(0, 400)}` : ''}`),
        ...job.criteria.filter((c) => c.status !== 'APROVADO').map((c) => `- critério "${c.key}" (${c.kind}) ${c.status}: ${c.description.slice(0, 150)}${c.checks[0] ? ` — evidência: ${JSON.stringify(c.checks[0].evidence).slice(0, 300)}` : ''}`),
        `Últimas linhas do log:\n${logs.reverse().map((l) => `${l.level} ${l.source}: ${l.message.replace(/\s+/g, ' ').slice(0, 220)}`).join('\n')}`,
        '',
        'SUA TAREFA AGORA (auto-correção): explique ao usuário, em uma frase simples, o que deu errado; e PROPONHA UM PLANO que',
        'conserta a causa (um rascunho de trabalho novo, como qualquer plano), ajustando o que falhou.',
        'ATENÇÃO: não marque "continuacao": true após falha/bloqueio e não inicie nova execução automática.',
        'Apresente o diagnóstico e aguarde o usuário clicar Fazer antes de gastar tokens novamente.',
        'Se o erro for de algo que só o usuário resolve (falta um arquivo, uma conexão, uma decisão), NÃO',
        'proponha plano: diga o que você precisa dele.',
        'Se este MESMO erro já apareceu numa tentativa de correção anterior (veja a conversa), NÃO repita o mesmo plano: tente',
        'uma abordagem diferente ou, se não houver, peça ajuda ao usuário.',
      ].join('\n');
    }
    const arquivos = job.mergedCommit ? await this.workspace.arquivosDoCommit(dirKey, job.mergedCommit) : [];
    const nome: Record<string, string> = { A: 'novo', M: 'alterado', D: 'apagado', R: 'movido' };
    return [
      `Trabalho concluído e conferido: "${job.title}".`,
      `Objetivo: ${job.objectives[0]?.text ?? ''}`,
      `Arquivos (${arquivos.length}): ${arquivos.slice(0, 80).map((f) => `${f.path} (${nome[f.status] ?? f.status}${f.de ? ` de ${f.de}` : ''})`).join('; ') || 'nenhum arquivo mudou'}`,
      `Resultados gravados pela IA (out/, fora da pasta do projeto; o usuário abre na tela, em "Resultados"; você lê em contexto/resultados/${jobId.slice(0, 8)}/): ${
        (await this.artifacts.resultadosDosTrabalhos(job.projectId, [jobId])).filter((a) => a.name !== 'conferencia-regras.json').map((a) => `${a.name} (${a.sizeBytes} bytes)`).join('; ') || 'nenhum'
      }`,
      'Os resultados são o produto do trabalho tanto quanto os arquivos: apresente-os (o que contêm, os achados e as decisões pendentes).',
      'Conferências que o SISTEMA rodou e passaram:',
      ...job.steps.filter((x) => x.status === 'CONCLUIDO' && x.verifyCommand && x.verifyCommand !== 'true').map((x) => `- etapa "${x.title || x.key}": ${x.verifyCommand!.slice(0, 300)}`),
      ...job.criteria.filter((c) => c.status === 'APROVADO').map((c) => `- critério "${c.key}" (${c.kind}): ${c.description.slice(0, 200)}`),
    ].join('\n');
  }

  private async buildPrompt(conversationId: string, messageId: string, project: { id: string; dirKey: string; gitUrl: string | null; gitBranch: string | null; projetoOrigemId?: string | null; vozNarracao: string; motorNarracao: string; velocidadeNarracao: number; pronunciasNarracao: unknown; modoTrilha: string }, profileText: string, anexos: Array<Anexo & { mensagem: string; caminho: string }> = [], entrega: string | null = null, providerId = '', resultados: string[] = []) {
    const videoDisponivel = this.registry.has('gemini-video') && (await this.registry.status('gemini-video', 15_000)).available;
    const [memoria, historico] = await Promise.all([
      this.prisma.memoryEntry.findMany({ where: { projectId: project.id, supersededById: null, camada: 'PROJETO' } }),
      this.prisma.conversationMessage.findMany({ where: { conversationId, id: { not: messageId } }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    const arquivos = (await this.workspace.listMainFiles(project.dirKey)).filter((f) => !f.path.startsWith('.'));
    let memTxt = '';
    for (const m of sortMemory(memoria)) {
      const l = memoryLine(m) + '\n';
      if (memTxt.length + l.length > MAX_MEMORIA) break;
      memTxt += l;
    }
    const conversa = historico
      .reverse()
      .map((m) => {
        const deles = anexos.filter((a) => a.mensagem === m.id);
        const lista = deles.length ? `\n[anexos: ${deles.map((a) => descreverAnexo(a)).join('; ')}]` : '';
        return `${m.role === 'USUARIO' ? 'USUÁRIO' : 'IA'}: ${m.kind === 'plano' ? `[plano proposto${m.jobId ? ', aprovado' : ''}] ` : ''}${m.content.slice(0, 3000)}${lista}`;
      })
      .join('\n\n');
    return [
      '# Você é a IA deste projeto no Nivoo',
      '',
      '## Regras de segurança do sistema (invioláveis)',
      ...AGENT_RULES.map((r) => `- ${r}`),
      '- Este diretório é uma CÓPIA DESCARTÁVEL da pasta do projeto: leia o que precisar, mas NÃO crie, altere nem apague arquivos.',
      '- Você não executa o trabalho: você conversa e, quando fizer sentido, propõe um plano. O usuário aprova; então o trabalho é executado.',
      '',
      profileText,
      '',
      ...ferramentasDaIa(providerId, mcpDoProjeto(project.id).map((m) => m.nome)),
      '- Nas instruções das etapas do plano, nunca proíba comandos de LEITURA (ls, cat, rg…): o ChatGPT só lê arquivos com eles.',
      '  Proíba, se for o caso, testes, build, instalação, commit, push e apagar — isso é do sistema.',
      '',
      ...(await textoDoRepositorio(this.workspace.projectDirs(project.dirKey).repo, project, { semPastaGit: true })),
      '',
      `Arquivos da pasta principal do projeto (diretório atual): ${arquivos.slice(0, MAX_ARQUIVOS).map((f) => f.path).join(', ') || 'vazia'}${arquivos.length > MAX_ARQUIVOS ? ` … e mais ${arquivos.length - MAX_ARQUIVOS}` : ''}`,
      ...textoDosVideos(listarVideos(this.workspace.projectDirs(project.dirKey).midia)),
      `Locução deste projeto: motor ${project.motorNarracao === 'gemini' ? 'Gemini TTS paga (usa token)' : 'Kokoro local (grátis, sem token)'}, voz ${descreverVoz(project.vozNarracao)}, velocidade ${project.velocidadeNarracao}. Pronúncias: ${JSON.stringify(project.pronunciasNarracao ?? {})}. Quando houver narração por texto, copie estas escolhas para narracao.motor, narracao.voz, narracao.velocidade e narracao.pronuncias.`,
      `Trilha padrão do projeto: ${project.modoTrilha === 'ia' ? 'gerar com IA/Lyria (paga)' : project.modoTrilha === 'arquivo' ? 'usar um arquivo de música enviado pelo usuário' : 'sem trilha no MP4 (o usuário pode adicionar música depois no Instagram)'}. Locução e trilha são independentes.`,
      ...(await contextoDaOrigem(this.prisma, this.workspace, project.projetoOrigemId)),
      '',
      '## Memória do projeto (decisões, restrições, lições, pendências)',
      memTxt || '(vazia)',
      '',
      ...textoDaVersao(await infoDeVersao(this.workspace.projectDirs(project.dirKey).repo).catch(() => null)),
      '',
      '## Conversa até aqui',
      conversa || '(primeira mensagem)',
      '',
      '## Como responder',
      'Fale de forma simples e direta, em português, sem jargão técnico: o usuário não é programador.',
      'Responda perguntas diretamente. Quando houver trabalho a fazer (criar, alterar ou organizar arquivos), proponha um plano.',
      'ESCOPO: se o pedido estiver fora do escopo do projeto ou contrariar as regras da base ou do projeto, NÃO proponha plano:',
      'responda (tipo "resposta") explicando, com educação, por que não pode e o que é possível dentro do projeto.',
      'Termine SEMPRE com UM bloco ```json``` em um destes formatos:',
      '1) {"tipo":"resposta","texto":"..."} — para perguntas, esclarecimentos ou quando faltar informação que BLOQUEIA o trabalho.',
      '2) {"tipo":"plano","texto":"explicação curta para o usuário","continuacao":true|false,"job":{...}} — quando houver trabalho a executar.',
      '   "continuacao": true quando o plano CONTINUA um pedido que o usuário já fez/aprovou nesta conversa (a próxima parte, ou seguir',
      '   depois que ele respondeu as perguntas): o sistema começa sozinho, sem esperar o "Fazer". Pedido novo: false (ele aprova).',
      'PERGUNTAS COM OPÇÕES: quando precisar perguntar algo ao usuário (em qualquer formato, inclusive na entrega), coloque no JSON',
      '"perguntas": [{"pergunta":"texto completo, que se entende sozinho","opcoes":[{"rotulo":"curto (1 a 5 palavras)","descricao":"o que',
      'acontece se escolher"}],"multipla":false}] — de 1 a 4 perguntas, cada uma com 2 a 4 opções; a recomendada PRIMEIRO, com',
      '" (recomendado)" no rótulo. A tela mostra cartões para o usuário clicar (e "Outra" para escrever). No "texto", diga só em uma',
      'frase que precisa das respostas — não repita as perguntas nem as opções no texto.',
      'NUNCA mande "perguntas" e plano na mesma resposta: com pergunta que bloqueia, responda só com as perguntas (tipo "resposta") e',
      'mande o plano depois das respostas (com "continuacao": true, ele começa sozinho). Se nada bloqueia, plano direto, sem perguntas.',
      'PERGUNTE POUCO: o que está claro no pedido, na conversa, na memória ou nos arquivos, faça. Decisão reversível com uma opção',
      'claramente melhor: decida, siga e conte o que decidiu. Pergunte só o que bloqueia e só o usuário sabe — com opções e a sua recomendação.',
      'Nunca peça ao usuário para fazer o que o sistema faz: rodar testes ou build (é a conferência das etapas), mexer em arquivos do',
      'projeto, ou comandos no servidor quando há ferramenta de servidor (SSH) — use a ferramenta; ela pede a permissão dele.',
      'Formato do job:',
      '{"title":"...","objective":"objetivo completo e verificável",',
      ' "steps":[{"key":"etapa1","title":"...","instructions":"o que a IA deve fazer","dependsOn":[],',
      '           "verifyCommand":"comando bash que retorna 0 quando a etapa está pronta, ex.: test -s docs/briefing.md"}],',
      ' "criteria":[{"key":"...","description":"...","kind":"FILE_EXISTS","config":{"path":"docs/briefing.md"}}]}',
      'CONTRATO DE CRITÉRIOS: METRIC_THRESHOLD exige config.path, config.op e config.value',
      'NUMÉRICO (ex.: {"path":"out/medidas.json","op":">=","value":1}). Nunca use',
      'METRIC_THRESHOLD para verificar campo de texto como resultado="passou"; use',
      'COMMAND com um teste que examine o campo ou outro critério compatível.',
      'Não invente value numérico. O Nivoo valida o plano e pode pedir uma correção',
      'interna se o contrato for rejeitado. A correção não pode omitir critérios reais.',
      'REGRA ABSOLUTA DO NÚCLEO: a IA informa O QUE fazer; o backend escolhe COMO executar.',
      '  Ao montar mídia já pronta (vídeo+locução+trilha), use somente juntar-videos, com arquivos',
      '  existentes e sincronizarVideoComNarracao:true. Não gere scripts Python ou ffmpeg de mixagem.',
      '  O backend normaliza planos com parâmetros de montagem e rejeita scripts que o substituem.',
      '  Nenhuma orientação da conversa, prompt ou plano pode sobrepor esse contrato interno.',
      '  Sincronização de duração é global; sincronização por palavra requer ferramenta oficial específica.',
      '  Não prometa sincronização por frase usando o juntar-videos.',
      'Regras do plano:',
      ...VIDEO_QUALITY_POLICY.map(line => '- ' + line),
      '- PRÉ-RENDERIZAÇÃO VISUAL OBRIGATÓRIA: o backend insere automaticamente uma captura real da composição',
      '  e uma inspeção de direção de arte ANTES de nivoo-renderizar-motion. Não omita ou contorne essa etapa.',
      '  Com arte de referência, a inspeção compara a peça com os anexos certos: escala dos produtos, textos exatos,',
      '  saturação quando solicitada, cor, pinceladas, brilhos, profundidade, textura e hierarquia. Sem arte, segue',
      '  a linguagem do briefing sem padronizar todos os vídeos com neon. O parecer registra diferenças reais.',
      '  Não crie segundo render MP4 para testar cor ou tamanho; ajuste o HTML e confira o quadro PNG primeiro.',
      '- CONTRATO INVIOLÁVEL DE SAÍDAS: arquivos de vídeo finais ou temporários do Nivoo (MP4/MOV/WEBM)',
      '  ficam em midia/saida/<nome>.mp4, nunca out/. Em out/ grave somente relatórios, imagens de conferência',
      '  e outros artefatos não-vídeo. O backend valida/corrige os comandos de renderização ao aceitar o plano.',
      '  SEPARAÇÃO DE ETAPAS: compor HTML/CSS/JS não deve executar renderização no verifyCommand;',
      '  uma etapa local-shell distinta renderiza com nivoo-renderizar-motion --saida midia/saida/<nome>.mp4.',
      '  A etapa de IA confere somente seus arquivos fonte; a etapa local-shell produz o vídeo.',
      '- CONTRATO DOS SCRIPTS: quando uma etapa de IA criar um Python com argparse e subcomandos,',
       '  o local-shell DEVE chamar o modo explicitamente: script.py quadros e script.py video,',
       '  nesta ordem quando a montagem depender dos PNGs. Executar apenas script.py causa exit 2.',
       '  Cheque o --help e acrescente todos os argumentos exigidos; não invente opções.',
       '  Ao recuperar trabalho bloqueado, reaproveite scripts, locução B, mídia e marcações',
       '  já existentes. Crie apenas uma etapa de execução corrigida, sem nova criação ou revisão.',
       '  Nunca repita exatamente o mesmo comando que acabou com erro de uso/argumento.',
      '  EXTRAÇÃO DE QUADROS: é PROIBIDO criar filtros FFmpeg select=eq(n,0)+eq(n,1)+...',
      '  com dezenas/centenas de parcelas. Esses filtros podem falhar na compilação com falta de memória.',
      '  Use nivoo-extrair-quadros <video> --pasta out/quadros --indices 0,8,16 --largura 540',
      '  (ou sem --indices para extrair sequência). Esta ferramenta decodifica sequencialmente e',
      '  grava quadro-000000.png etc e quadros.json, sem montar expressões gigantes.',
      '  Se um script recuperado usa o select antigo, REESCREVA essa parte para carregar os quadros',
      '  exportados pela ferramenta antes de chamar a montagem; não repita o mesmo script quebrado.',
       '- Toda etapa executada por IA precisa de verifyCommand (verificação objetiva). O SISTEMA roda a conferência ao fim de cada',
      '  sessão; se falhar, a IA recebe o erro e corrige numa nova sessão, até passar. A IA não roda comandos: quem testa é a conferência.',
      '- CÓDIGO: toda etapa que muda código confere com os TESTES e o BUILD reais do projeto (os scripts que existem no package.json,',
      '  Makefile, pyproject…; confira antes de citar), instalando as dependências quando preciso. Ex.: "npm install && npm test && npm run build".',
      '  Para INSTALAR use "npm install" (ou "yarn"/"pnpm install"), NÃO "npm ci": o "npm ci" exige um package-lock.json commitado e,',
      '  se o projeto não tem o lockfile, ele falha antes de testar. Só use "npm ci" se o package-lock.json estiver na lista de arquivos.',
      '  Nunca deixe teste ou build para o usuário rodar, nem entregue código conferido só por leitura.',
      '  Teste que depende de algo que o servidor do Nivoo não tem (outro banco, outro serviço) fica de fora, e o "texto" diz qual.',
      ...(bancoDeTesteDisponivel() ? TEXTO_BANCO_DE_TESTE : ['- Este servidor não oferece banco de teste: testes que precisam de PostgreSQL ficam de fora (diga quais).']),
      ...TEXTO_SISTEMA_RODANDO,
      ...TEXTO_FOTOS,
      '- IMAGENS INÉDITAS: NÃO prometa gerar fotos/PNG com Codex/Claude CLI se a ferramenta de imagens só devolve prévias ou caminhos fora do workspace. Para um job exigir PNG em um caminho, confirme primeiro uma rota que grave o binário LOCAL nesse caminho. Sem isso, proponha anexar os PNGs pelo chat e uma etapa determinística de cópia/validação; nunca monte plano de geração impossível.',
      ...TEXTO_ROTEIRO,
      ...TEXTO_PADRAO_DAS_TELAS,
      '- PRÉVIA: o usuário vê o site/sistema rodando ao lado da conversa ("Ver o projeto"). Site com index.html e package.json com',
      '  "dev"/"start" são detectados; se o projeto liga de outro jeito (monorepo, outra pasta, comando próprio), inclua no plano',
      '  um nivoo-previa.json na raiz: {"tipo":"servidor","pasta":"apps/web","instalar":"pnpm install","comando":"pnpm dev --port $PORT","caminho":"/"}',
      '  (o sistema ouve em $PORT e recebe o banco de teste) ou {"tipo":"estatico","pasta":"dist"}.',
      '- Não escreva na instrução "não altere nenhum outro arquivo": se a conferência falhar por outra causa (script de teste,',
      '  configuração, dependência), a IA precisa poder corrigir essa causa. Proíba só o que o usuário ou as regras protegem.',
      '- Conferência de documentos: comandos básicos do bash (test, grep, find, wc, ls, cat, head, tail, sed, awk, diff). Não use rg nem jq.',
      '- FAÇA O PEDIDO INTEIRO num plano só (quantas etapas precisar). Não divida em "parte A agora, parte B depois" para esperar o usuário;',
      '  só fica para depois o que depende de uma resposta dele que bloqueia de verdade.',
      '- Arquivos que fazem parte do projeto (estrutura, documentos, código, peças) vão em caminhos normais: depois de',
      '  aprovados pelo verificador ficam na pasta principal e os próximos trabalhos os enxergam.',
      '- out/ é só para evidências e relatórios (viram artefatos com hash; não ficam na pasta principal).',
      '- Critérios: FILE_EXISTS {"path"}, COMMAND {"command"}, ARTIFACT_PRESENT {"name": arquivo em out/},',
      '  METRIC_THRESHOLD {"artifact","path","op","value"}, MANUAL_APPROVAL {} (SÓ quando o usuário pediu para aprovar antes de',
      '  concluir: ele trava o trabalho esperando o clique dele). Visual e usabilidade NÃO são aprovação manual: confira com as',
      '  fotos das telas (nivoo-fotos) e a revisão independente abre as fotos.',
      '- Respeite o perfil do projeto (regras da base, regras do projeto, conhecimento) e a memória.',
      '- Não inclua etapa de revisão das regras: o sistema acrescenta sozinho uma conferência independente no fim.',
      '- No "texto" de um plano, explique em palavras simples o que será feito (sem falar de critérios, JSON ou comandos).',
      '- APAGAR OU MOVER arquivos/pastas do projeto: use esta etapa do sistema (executa direto; o git guarda tudo):',
      '  {"key":"limpar1","title":"Apagar arquivos mortos","provider":"arquivos-projeto","instructions":"por que cada item sai (resumo)",',
      '   "providerOptions":{"remover":["caminho/arquivo.ts","pasta/inteira"],"mover":[{"de":"antigo.md","para":"docs/antigo.md"}]}}',
      '  Sem verifyCommand (o sistema confere). Edição de conteúdo continua em etapas da IA (referências, imports, índices).',
      '  No "texto" do plano diga o que vai sair. Depois de apagar, ajuste referências (imports, índices) numa etapa da IA.',
      ...(videoDisponivel
        ? [
            '- VÍDEO: este projeto pode gerar vídeos com o Google (Gemini Omni Flash). Para isso, use uma etapa assim:',
            '  {"key":"video1","title":"Gerar o vídeo de abertura","provider":"gemini-video","instructions":"descrição COMPLETA do vídeo',
            '   em uma frase longa: cena, personagens, ação, câmera (ex.: travelling lento), luz, estilo, falas entre aspas e sons",',
            '   "providerOptions":{"arquivo":"videos/abertura.mp4","duracaoSeg":8,"proporcao":"16:9","negativo":"o que NÃO deve aparecer",',
            '   "imagem":"caminho opcional de uma imagem do projeto para ser o primeiro quadro",',
            '   "legenda":"texto curto que aparece escrito na tela durante esta cena (a fala ou a frase da cena)",',
            '   "transicao":"fade"}}',
            '  Legenda: em vídeo com várias cenas, escreva a legenda de CADA cena (curta, em português, sem emojis); o sistema grava no',
            '  vídeo completo no tempo certo e salva também o .srt. Transição para a cena seguinte (opcional, padrão "fade"): fade,',
            '  fadeblack (passa pelo preto), fadewhite, dissolve, wipeleft, wiperight, slideleft, slideright, slideup, circleopen,',
            '  circleclose, smoothleft, zoomin ou corte. Se ele não disse, use transição "fade" e sem legenda, e conte no texto (ele muda depois).',
            '  TRILHA DE FUNDO (independente da locução): respeite a preferência do projeto. "sem-trilha" = NÃO inclua trilha (o usuário',
            '  pode escolher uma música depois no Instagram); "arquivo" = use "trilha":{"arquivo":"audio/musica.mp3"}; "ia" = use',
            '  Lyria com "trilha":{"descricao":"estilo, instrumentos, clima, andamento"} (paga). Quando houver trilha: uma música só,',
            '  de ponta a ponta, que abaixa sozinha quando há fala. Coloque na',
            '  PRIMEIRA cena "trilha":{"arquivo":"audio/musica.mp3"} (música do usuário, anexada no chat e posta no projeto com',
            '  "anexosNoProjeto": GRÁTIS) ou "trilha":{"descricao":"estilo, instrumentos, clima, andamento"} (o Google compõe: custa',
            '  cerca de US$ 0,08). Com trilha, o sistema pede cada cena SEM música própria. Nunca gere trilha se a preferência for sem-trilha.',
            '  NARRAÇÃO / LOCUÇÃO (voz por cima do vídeo inteiro): coloque na PRIMEIRA cena, ou na etapa que junta/edita,',
            '  "narracao":{"texto":"o que a voz vai dizer, em português","motor":"kokoro","voz":"pf_dora","velocidade":1,',
            '  "pronuncias":{"Nivoo Dev":"Nívoo Dév"}}. Kokoro é LOCAL, GRÁTIS e não usa token. Use as preferências do projeto. Só use',
      '  EXPERIÊNCIA DE LOCUÇÃO: o usuário descreve o ritmo em PORTUGUÊS NORMAL, não escreve tags técnicas.',
      '  Ex.: "fale mais devagar, faça pausas naturais entre frases, mantenha fluidez".',
      '  Traduza isso para providerOptions.ritmo="calmo" e um único texto completo.',
      '  Ritmos aceitos: calmo (voz mais serena, pausas maiores), natural (padrão), dinamico (mais rápido).',
      '  Não exija velocidade numérica, pausaAposMs, SSML nem [pause:...] no pedido do usuário.',
      '  O backend separa frases completas pelo ponto/interrogação/exclamação e injeta pausas',
      '  do Kokoro internamente; vírgulas permanecem DENTRO da frase, sem cortar o áudio.',
      '  Só inclua velocidade e pausaAposMs quando o usuário pedir controle técnico explícito.',
      '  PRÉVIA DE LOCUÇÃO SEM VÍDEO: use provider "gerar-narracao" (executor registrado do Kokoro).',
      '  providerOptions: {"arquivo":"out/previa-locucao.mp3","voz":"pf_dora","velocidade":0.95,',
      '  "trechos":[{"texto":"É hoje","intencao":"chamada","pausaAposMs":260},',
      '  {"texto":"Você vai ficar de fora dessa","intencao":"pergunta"}]}.',
      '  Critério {"key":"previa-mp3","kind":"ARTIFACT_PRESENT",',
      '  "description":"Prévia de locução gerada","config":{"name":"previa-locucao.mp3"}}.',
      '  Não use um conector fictício, nem juntar-videos para gerar somente áudio.',
      '  Entregue o MP3 para o usuário ouvir; a aprovação da voz precede qualquer MP4.',
      '  REFINAR EXPRESSIVIDADE SEM MUDAR O RITMO: se a voz soar informativa no CTA, ofereça',
      '  DUAS prévias MP3: A preserva o roteiro atual, B usa um fechamentoAlternativo curto.',
      '  Exemplo de providerOptions: {"texto":"É hoje! Black na sua quinta-feira! Das sete às nove da noite,',
      '  dois sabores especiais em promoção! Peça agora a sua pizza e aproveite!",',
      '  "ritmo":"calmo","fechamentoAlternativo":"Aproveite essa promoção e peça já a sua pizza!"}.',
      '  Ambas são sintetizadas INTEIRAS, com mesma voz/velocidade/pausas; não unir gravações.',
      '  Não afirme que Kokoro obedece a comandos de emoção: escolha o melhor resultado por escuta.',
      '  Não gere MP4 nem altere o encerramento aprovado sem a escolha explícita do usuário.',
      '  LOCUÇÃO CONTÍNUA: Kokoro deve receber o texto completo em UMA síntese por padrão.',
      '  Não divida em MP3s por frase e não some pausas artificiais com apad/concat.',
      '  Para pausa PRECISA, o Kokoro-FastAPI reconhece [pause:0.35s] no próprio input;',
      '  em narracao.trechos, pausaAposMs vira [pause:Ns] NA MESMA síntese, não concat de MP3.',
      '  Use velocidade GLOBAL 0.85 como início de teste para locução mais calma; não acelerar.',
      '  IMPORTANTE: pausas configuradas são ADICIONAIS à pausa natural da pontuação.',
      '  Não programe 300–450ms extras: isso gerou intervalos reais de 650–760ms.',
      '  Nos ritmos calmo/natural/dinamico o backend calibra pequenas pausas adicionais.',
      '  Prefira ritmo + texto completo, sem pausaAposMs explícito. Nunca pause dentro de pergunta.',
      '  A pontuação do texto também orienta pausas naturais (vírgulas, pontos, exclamação).',
      '  A versão instalada do Kokoro-FastAPI precisa reconhecer os marcadores; se os ler como',
      '  texto falado, interrompa o teste e corrija a compatibilidade do serviço, não repita sessões.',
      '  Não prometa controle de emoção/pitch que Kokoro não oferece. A velocidade é GLOBAL.',
      '  Para um CTA que não soe como pergunta afirmada, prefira convite direto:',
      '  "Peça agora a sua pizza e aproveite!" (somente se o usuário aprovar mudar o texto).',
      '  DIREÇÃO DE VOZ KOKORO: para publicidade use narracao.trechos (roteiro único):',
      '  "narracao":{"motor":"kokoro","voz":"pf_dora","velocidade":0.95,"trechos":[',
      '  {"texto":"É hoje","intencao":"chamada","velocidade":0.95,"pausaAposMs":260},',
      '  {"texto":"Black na sua quinta-feira","intencao":"destaque","pausaAposMs":200},',
      '  {"texto":"Você vai ficar de fora dessa","intencao":"pergunta","velocidade":0.94}]}',
      '  NÃO DIVIDA uma pergunta no meio: "E você, vai ficar de fora dessa?" é um único trecho',
      '  de intencao pergunta. A pausa após "você" é a vírgula, sem criar MP3 isolado de "E você".',
      '  Segmentar apenas em frases inteiras: quebrar uma oração muda o contexto e pode mudar o sotaque.',
      '  O motor gera cada frase separada, aplica pontuação de intenção e insere pausa precisa na união local.',
      '  A intenção NÃO é um comando mágico de emoção/pitch; teste a voz. Acentos ortográficos são pronúncia,',
      '  não controle de emoção; não injete instruções que o sintetizador possa ler em voz alta.',
      '  Faça primeiro a locução dirigida, depois sincronize o vídeo com a duração real da voz,',
      '  SEM legendas nem música quando o usuário pedir só narração.',
            '  "motor":"gemini" e uma voz Gemini quando o usuário selecionar explicitamente a opção paga —',
            '  ou "narracao":{"arquivo":"audio/locucao.mp3"} para uma voz que o usuário já gravou e pôs no projeto (GRÁTIS). A voz entra',
            '  em PRIMEIRO plano e o fundo (cenas + trilha) abaixa sozinho enquanto ela fala e volta nos silêncios. Escolha a voz com',
            '  e, se quiser, "volumeFundoSobVoz":0.35 (0–1: quanto do fundo fica sob a voz). Com locução separada, gere as cenas do Omni',
            '  com semAudio:true; a montagem descarta qualquer som residual das cenas e coloca a voz local depois.',
            '  Juntar de novo com o MESMO texto reaproveita a locução já gerada, sem pagar outra. Narração é a VOZ falada; legenda é o texto escrito na tela — dá para usar as duas.',
            '  Tudo da montagem (juntar, transição, legenda, trilha, narração, volume) é feito pelo servidor, sem IA e sem custo; só gerar',
            '  cena e gerar música usa o Google. Kokoro não gera música: ele faz apenas locução. Prefira sempre o caminho sem custo quando ele atender.',
            '  ECONOMIA DO GEMINI: o roteiro, a estrutura, a divisão em cenas, o texto das legendas/narração e o código do motion são SEU',
            '  trabalho (a IA deste projeto) — não gastam a chave do Gemini. O Gemini (caro) entra SÓ para GERAR a mídia: vídeo (Omni),',
            '  música (Lyria). A locução Kokoro é local. Monte tudo primeiro e deixe as chamadas ao Gemini só para vídeo e, se escolhido, música.',
            '  Proporção: "16:9" (horizontal) ou "9:16" (vertical, para celular/stories). Cada vídeo é cobrado por segundo pelo Google:',
            '  diga no "texto" quantos vídeos e quantos segundos serão. Imagem anexada no chat como primeiro quadro: coloque-a no projeto',
            '  com "anexosNoProjeto" e use o mesmo caminho em "imagem". Não precisa de verifyCommand: o sistema confere o arquivo.',
            '  O Google gera de 3 a 15 s por vez (duracaoSeg de 3 a 15): para um vídeo maior, uma etapa por cena (videos/<nome>/cena-01.mp4, cena-02.mp4…) e o',
            '  SISTEMA acrescenta sozinho a etapa final que junta as cenas, na ordem, em videos/<nome>/<nome>-completo.mp4 (não crie essa etapa).',
            '  As cenas são unidas com meio segundo de fusão. Para o som não "pular" entre elas: descreva o MESMO ambiente sonoro e a',
            '  mesma trilha em todas as cenas (ex.: "trilha acústica suave e constante, som ambiente de cozinha"), e termine falas e',
            '  efeitos fortes antes do último segundo da cena (o fim de cada cena se mistura com o começo da seguinte).',
            '  Para JUNTAR DE NOVO cenas que já existem no projeto (sem gerar e sem pagar de novo; ex.: "junte as cenas de novo",',
            '  "refaça a montagem", ou depois de refazer só uma cena), use uma etapa do sistema:',
            '  {"key":"juntar","title":"Juntar as cenas no vídeo completo","provider":"juntar-videos","instructions":"junta as cenas na ordem",',
            '   "providerOptions":{"cenas":["videos/<nome>/cena-01.mp4","videos/<nome>/cena-02.mp4"],"arquivo":"videos/<nome>/<nome>-completo.mp4",',
            '   "legendas":["legenda da cena 1","legenda da cena 2"],"transicoes":["fade"],"narracao":{"texto":"...","motor":"kokoro","voz":"pf_dora","velocidade":1},"volumeCenas":0}}',
            '  (opcionais; volumeCenas 0–1 abaixa o som que veio nas cenas — 0 deixa só a trilha, útil quando as cenas já têm música',
            '  própria e não têm fala; com fala, abaixar demais some com a fala).',
            '  VÍDEO PRONTO (o usuário já editou/cortou em outro lugar e só quer SOM): use o vídeo inteiro como ÚNICA cena',
            '  ("cenas":["midia/entrada/<arquivo>"]) e some "trilha" e/ou "narracao". NÃO corte em pedaços nem junte as versões curtas.',
            '  Faça SÓ a etapa "juntar-videos" — NÃO crie etapa de "conferir/validar os arquivos" com local-shell nem com ffprobe:',
            '  a própria etapa juntar-videos já avisa com clareza se faltar uma cena, trilha ou narração. Os vídeos enviados estão',
            '  em midia/ENTRADA (nunca midia/saida, que é só a saída). O resultado vai para midia/saida/<nome>.mp4.',
            '  Critério do resultado: use FILE_EXISTS com o caminho do arquivo (ex.: {"kind":"FILE_EXISTS","config":{"path":"midia/saida/<nome>.mp4"}}).',
            '  NUNCA use um critério COMMAND com ffprobe/test em midia/... (a mídia fica fora do git e o comando não a acha); o FILE_EXISTS acha.',
            '  O vídeo pode nem ter áudio próprio (prévia muda) — tudo bem, a música/voz viram a trilha. O sistema deixa o vídeo do',
            '  TAMANHO DO ÁUDIO: se a narração passar do vídeo, segura o último quadro até a fala acabar (nunca corta pela metade).',
            '  Quando houver NARRAÇÃO (voz), a legenda é OPCIONAL; se usar, deixe CURTA (poucas palavras), nunca a fala inteira na tela.',
            '  EDIÇÃO (vídeos que o usuário JÁ ENVIOU, sem gerar com o Omni): a MESMA etapa "juntar-videos" edita. Os vídeos enviados',
            '  estão listados acima com o caminho midia/entrada/<arquivo> — use ESSES caminhos em "cenas", na ordem desejada, e o',
            '  "arquivo" final em midia/saida/<nome>.mp4 (a mídia fica fora do git). Para RECORTAR/ACELERAR cada clipe:',
            '  "cortes":[{"inicio":1.5,"fim":8},{"velocidade":2}] (alinhado com "cenas"; inicio/fim em segundos, velocidade 0.25–8;',
            '  null ou {} = clipe inteiro). Reordenar = mudar a ordem de "cenas". Também valem legendas, transicoes e trilha.',
            '  Tudo isso (cortar, juntar, transição, legenda, trilha, acelerar) é ffmpeg no servidor: SEM Omni e SEM custo. Só use o',
            '  Omni para gerar um trecho NOVO quando o usuário pedir de verdade; para "editar o que já tenho", nunca gere com o Omni.',
            '  A IA "VER" o vídeo e SUGERIR cortes: primeiro uma etapa de sistema (provider "local-shell") que roda',
            '  nivoo-analisar-video midia/entrada/<arquivo> --pasta out/analise/<nome> (extrai 1 quadro/s e aponta trechos escuros,',
            '  silêncios e cortes de cena — ffmpeg, grátis); depois uma etapa de IA que ABRE os quadros out/analise/<nome>/quadro-*.jpg',
            '  e o resumo.md e escreve out/analise/<nome>/sugestoes.md com cortes concretos (tempo). Mostre as sugestões; só edite de',
            '  verdade (juntar-videos com cortes) depois que o usuário aprovar. Ex. das duas etapas:',
            '  {"key":"analisar","provider":"local-shell","instructions":"nivoo-analisar-video midia/entrada/<arq> --pasta out/analise/<nome>","verifyCommand":"test -s out/analise/<nome>/resumo.md"},',
            '  {"key":"sugerir","instructions":"Abra out/analise/<nome>/resumo.md e os quadros e escreva out/analise/<nome>/sugestoes.md com cortes.","verifyCommand":"test -s out/analise/<nome>/sugestoes.md"}',
            '  PADRÃO VISUAL PARA CAMPANHAS: o cartaz de referência NÃO deve ser animado com',
            '  retângulos pretos para revelar recortes do conteúdo. Faça um inventário de fundo,',
            '  logo, fotografias, PNGs transparentes, textos e ornamentos. Preserve arquivos originais.',
            '  Reconstrua o que faltar em HTML/CSS/SVG coerente com a marca (cor, forma, fonte, traço),',
            '  sem prometer PNG fotorrealista sem gerador de imagens com gravação local validada.',
            '  Componha PRIMEIRO o quadro final legível com cada elemento independente em sua camada.',
            '  Só depois anime posição, escala e opacidade, com tempos separados. Fundo original íntegro.',
            '  PROIBIDOS blocos pretos opacos, recortes de texto do pôster, textos escondidos sob máscaras,',
            '  conteúdo cortado e resultado que só fica legível nos últimos segundos.',
            '  Examine os quadros de 8%, 30%, 58%, 85% e final antes de aprovar a animação.',
            '  MOTION DESIGN (animação de código, SEM Omni e SEM custo de vídeo): para abertura, título animado, lower-third, logo,',
            '  explicação com texto e formas em movimento. A IA escreve a animação em motion/<nome>/index.html (HTML/CSS/JS, um',
            '  arquivo, sem internet; declare a duração em window.__motionSegundos e, no fim, window.__motionFim=true). Uma etapa de',
            '  sistema (provider "local-shell") renderiza para vídeo:',
            '  {"key":"render","provider":"local-shell","instructions":"nivoo-renderizar-motion motion/<nome> --saida midia/saida/<nome>.mp4 --segundos 15 --tamanho 1920x1080","verifyCommand":"true"}.',
            '  ATENÇÃO AO RENDERIZADOR: nivoo-renderizar-motion só aceita --saida midia/saida/<nome>.mp4.',
            '  Nunca use --saida out/<nome>.mp4, mesmo para gerar quadros de conferência: a etapa falhará.',
            '  Para inspecionar um quadro, use como entrada do ffmpeg o MP4 em midia/saida/ e grave',
            '  somente as imagens de evidência em out/ (ex.: ffmpeg -i midia/saida/<nome>.mp4 -frames:v 1 out/quadro.png).',
      '  QUADROS DE CONFERÊNCIA PÓS-RENDER: não encarregue o agente de IA de extrair PNGs de um MP4',
      '  que fica na mídia permanente. O backend agora detecta os quadros quadro-08/30/58/85/final.png',
      '  exigidos no verifyCommand, usa ffprobe/ffmpeg e os cria antes de abrir a sessão revisora.',
      '  Evite etapa extra de IA só para extrair quadros: a IA deve INSPECIONAR os arquivos já gerados.',
      '  Quando o usuário pedir vídeo com SOMENTE VOZ natural sincronizada: NÃO acelere a voz, não use',
      '  música, não gere legendas e não encurte a locução para caber numa duração arbitrária.',
      '  Utilize juntar-videos com UMA cena, volumeCenas:0 e sincronizarVideoComNarracao:true;',
      '  o executor ajusta a duração da IMAGEM à duração real da voz, preservando o timbre.',
      '  Dê preferência ao Kokoro em velocidade 0.90–1.0, voz feminina quando solicitada;',
      '  caso o roteiro esteja longo ou curto demais, ajuste o roteiro/pausas e respeite o tempo',
      '  necessário para a fala, não acrescente 9 segundos de silêncio digital no final.',
      '  Uma nova narração ou mudança de ritmo em vídeo APROVADO deve usar juntar-videos com uma única',
      '  cena existente, cortes:[{velocidade:1.15}], narracao com voz e texto, volumeCenas:0, SEM trilha.',
      '  Grave em novo MP4 sem sobrescrever o aprovado e ajuste a locução à duração real resultante.',
            '  NÃO execute renderização no verifyCommand de uma etapa de IA que apenas compõe HTML.',
            '  Crie uma etapa local-shell de renderização antes de avaliar a imagem ou o vídeo.',
            '  Um verifyCommand é gravado no plano: o agente não pode corrigi-lo só criando out/conferencia.sh.',
            '  Verificações determinísticas devem usar comandos aceitos e caminhos existentes desde o planejamento.',
            '  Depois dá para somar MÚSICA de fundo, NARRAÇÃO (voz), LEGENDA e juntar com outras cenas na etapa juntar-videos (cenas:["midia/saida/<nome>.mp4"]).',
            '  Prefira Motion Design (barato) ao Omni quando o pedido é animação/apresentação; o Omni é para filmagem realista.',
          ]
        : []),
      ...(resultados.length
        ? [
            '- RESULTADOS dos trabalhos desta conversa (relatórios, inventários, planos que a IA gravou em out/; ficam fora da pasta',
            '  do projeto) estão para leitura em contexto/resultados/<id do trabalho>/. LEIA-OS quando o assunto for o resultado:',
            ...resultados.slice(0, 60).map((r) => `  - ${SESSION_CONTEXT_DIR}/resultados/${r}`),
            '  Num plano que continua um trabalho anterior (ex.: executar a limpeza proposta), as etapas também recebem esses arquivos',
            '  em contexto/resultados/ — cite o caminho na instrução da etapa.',
          ]
        : []),
      '- Anexos do chat ficam em contexto/anexos/ (leitura). Para colocar um anexo DENTRO do projeto (ex.: o logo',
      '  enviado vira public/logo.png), inclua no job "anexosNoProjeto":[{"anexo":"contexto/anexos/<id>/<arquivo>","para":"public/logo.png"}]:',
      '  o sistema copia o arquivo antes de o trabalho começar. Nunca tente recriar uma imagem escrevendo o arquivo.',
      '',
      '## Memória do projeto (obrigatório)',
      'Em qualquer dos dois formatos, inclua "memoria": [...] SÓ com o que precisa ser lembrado para sempre neste projeto:',
      'decisões CONCRETAS do usuário, preferências e regras que ele expressou, fatos do projeto que ele informou e pendências combinadas.',
      'Formato: {"tipo":"DECISAO|PREFERENCIA|FATO|PENDENCIA","titulo":"assunto curto e estável","conteudo":"frase completa e autossuficiente"}.',
      'O título é o ASSUNTO (ex.: "Banco de dados", "Tom das peças"): para mudar algo já guardado, use EXATAMENTE o mesmo título',
      'da memória acima com o conteúdo novo — o sistema atualiza o item (não cria outro). Uma pendência resolvida: mesmo título,',
      'conteúdo dizendo como foi resolvida.',
      'NÃO guarde: andamento ou resumo de trabalho, o que a IA fez ou vai fazer, planos, suposições suas, dúvidas, o que já está',
      'na memória com o mesmo sentido, nem detalhes que estão nos arquivos do projeto. Na dúvida, não guarde. Lista vazia é o normal.',
      '',
      ...(entrega
        ? [
            '## AGORA: apresente a ENTREGA do trabalho que acabou de terminar (o usuário ainda não viu o resultado)',
            entrega,
            'Leia os arquivos novos/alterados e os resultados acima e responda em linguagem simples:',
            '1) O que foi feito (poucas linhas) e como foi conferido (as conferências que o SISTEMA rodou estão acima; não diga',
            '   que nada foi testado se uma conferência rodou testes).',
            '2) Onde está: os caminhos exatos dos arquivos principais (o usuário abre pela tela clicando neles).',
            '   Vídeo: o resultado é o vídeo COMPLETO (…-completo.mp4, com player e "baixar" na conversa); cite as cenas só como peças.',
            '3) SE FALTA PARTE DO PEDIDO do usuário (veja a conversa e o objetivo) e nada bloqueia: NÃO pare. Responda com',
            '   {"tipo":"plano","continuacao":true,...} com o plano do que falta: o sistema começa sozinho. Se falta uma resposta do',
            '   usuário que bloqueia, NÃO mande plano: só as perguntas (tipo "resposta"); o plano vem depois que ele responder.',
            '4) Perguntas: SÓ o que bloqueia e só o usuário decide — no campo "perguntas" (cartões com opções). Nada de pedir para ele rodar',
            '   testes, build, comandos ou atualizar o servidor quando o sistema pode fazer isso (conferências e ferramenta SSH).',
            '   Se tudo foi feito e não há bloqueio: só o resumo, sem perguntas. Pedido totalmente concluído: {"tipo":"resposta"}.',
          ]
        : [
      '## Mensagem atual do usuário',
      ...(await (async () => {
        const atual = await this.prisma.conversationMessage.findFirst({ where: { conversationId, role: 'USUARIO' }, orderBy: { createdAt: 'desc' } });
        const deles = atual ? anexos.filter((a) => a.mensagem === atual.id) : [];
        return [
          atual?.content || '(sem texto: o usuário só enviou anexos)',
          ...(deles.length
            ? ['', 'Anexos desta mensagem (LEIA/VEJA cada um antes de responder; imagens: abra o arquivo com a sua ferramenta de leitura):', ...deles.map((a) => `- ${descreverAnexo(a)}`)]
            : []),
        ];
      })()),
          ]),
    ].join('\n');
  }
}

/**
 * Objeto JSON que começa em `inicio` (um "{"), lido pela estrutura (chaves, aspas, escapes) — não pela cerca ```: um
 * bloco de código DENTRO do texto da resposta (ex.: comandos do servidor) não corta o JSON. Conserta o que as IAs
 * costumam mandar: quebra de linha e tabulação soltas dentro do texto. Devolve o texto do objeto ou null.
 */
function objetoJsonEm(texto: string, inicio: number): string | null {
  let prof = 0;
  let emTexto = false;
  let escape = false;
  let saida = '';
  for (let i = inicio; i < texto.length; i++) {
    const c = texto[i];
    if (emTexto) {
      if (escape) {
        escape = false;
        saida += c;
      } else if (c === '\\') {
        escape = true;
        saida += c;
      } else if (c === '"') {
        emTexto = false;
        saida += c;
      } else if (c === '\n') saida += '\\n';
      else if (c === '\r') saida += '\\r';
      else if (c === '\t') saida += '\\t';
      else saida += c;
      continue;
    }
    if (c === '"') emTexto = true;
    else if (c === '{') prof++;
    else if (c === '}') {
      prof--;
      if (prof === 0) return saida + c;
    }
    saida += c;
  }
  return null;
}

function tentar(json: string | null): any | null {
  if (!json) return null;
  for (const v of [json, json.replace(/,\s*([}\]])/g, '$1')]) {
    try {
      const o = JSON.parse(v);
      // Só a resposta principal ({"tipo":"resposta"|"plano"}); um item de memória ({"tipo":"FATO"}) não é a resposta.
      if (o && typeof o === 'object' && (o.tipo === undefined || o.tipo === 'resposta' || o.tipo === 'plano')) return o;
    } catch {
      /* próxima tentativa */
    }
  }
  return null;
}

/**
 * O JSON final da resposta da IA ({"tipo":...}): do ÚLTIMO ```json para trás; depois o último {"tipo" solto; por fim
 * o texto inteiro. Null se nenhum der certo.
 */
export function extractJson(text: string): any | null {
  const posicoes: number[] = [];
  for (const m of text.matchAll(/```json\s*/g)) posicoes.push(m.index! + m[0].length);
  for (const ini of posicoes.reverse()) {
    const abre = text.indexOf('{', ini);
    if (abre < 0) continue;
    const o = tentar(objetoJsonEm(text, abre));
    if (o) return o;
  }
  for (const m of [...text.matchAll(/\{\s*"tipo"\s*:\s*"(resposta|plano)"/g)].reverse()) {
    const o = tentar(objetoJsonEm(text, m.index!));
    if (o) return o;
  }
  const inteiro = text.trim();
  return inteiro.startsWith('{') ? tentar(objetoJsonEm(inteiro, 0)) : null;
}

/** JSON quebrado sem conserto: ao menos o "texto" da resposta, para o usuário não ficar sem nada. */
export function salvarTextoDaResposta(text: string): string | null {
  const m = /"texto"\s*:\s*"((?:[^"\\]|\\.)*)"/s.exec(text);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1].replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`);
  } catch {
    return m[1];
  }
}

/** Perguntas com opções vindas da IA, validadas: 1 a 4 perguntas, 2 a 4 opções cada (texto curto). */
export function normalizarPerguntas(bruto: unknown): Array<{ pergunta: string; opcoes: Array<{ rotulo: string; descricao: string }>; multipla: boolean }> | null {
  if (!Array.isArray(bruto)) return null;
  const lista = bruto
    .slice(0, 4)
    .map((q: any) => {
      const pergunta = String(q?.pergunta ?? q?.texto ?? '').trim().slice(0, 1000);
      const opcoes = (Array.isArray(q?.opcoes) ? q.opcoes : [])
        .slice(0, 6)
        .map((o: any) => (typeof o === 'string' ? { rotulo: o, descricao: '' } : { rotulo: String(o?.rotulo ?? o?.label ?? ''), descricao: String(o?.descricao ?? o?.description ?? '') }))
        .map((o: { rotulo: string; descricao: string }) => ({ rotulo: o.rotulo.trim().slice(0, 160), descricao: o.descricao.trim().slice(0, 500) }))
        .filter((o: { rotulo: string }) => o.rotulo);
      return { pergunta, opcoes, multipla: q?.multipla === true };
    })
    .filter((q) => q.pergunta && q.opcoes.length >= 2);
  return lista.length ? lista : null;
}
