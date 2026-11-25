import { planFpsResume } from './planner/fps-resume';
import { validatedPlannerJob } from './planner/validated-job';
import { mcpDoProjeto } from '../mcp/mcp';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { copiarAnexosParaSessao } from '../conversations/attachments';
import { ehFalhaDeLogin,tipoDe } from '../accounts/connections';
import { softwareInterfaceEnabled } from '../specialties/scope';
import { GOLDFISH_SKILL,goldfishRequest,goldfishProviderSupported,goldfishReviewPrompt,goldfishReviewOutcome } from '../specialties/software/goldfish';
import { SKILLS_VERSION,skillContext } from '../specialties/skills';
import { AGENT_RULES } from '../security/policy';
import { trocarParaReserva } from '../projects/mover-trabalho';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { minimalEnv, runProcess } from '../common/exec';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { ClaimedTask, QueueService } from '../queue/queue.service';
import { SESSION_CONTEXT_DIR, WorkspaceService } from '../storage/workspace.service';
import { ArtifactStoreService } from '../storage/artifact-store.service';
import { jobsDaConversa } from '../conversations/jobs-da-conversa';
import { ConversationsService } from '../conversations/conversations.service';
import { historicoGit } from '../git/contexto-git';
import { projectModel } from '../providers/project-model';
import { buildPlannerPrompt } from './planner/prompt';
import { extractJson,salvarTextoDaResposta,normalizarPerguntas } from './planner/response';
import { ProjectProfileService } from '../projects/project-profile.service';
import { registrarErro } from '../diagnostico/erros';
import { escreverArquivosDaMemoria, gravarNoProjeto } from '../memory/camadas';


/**
 * Responde mensagens da conversa do projeto. Roda no worker, numa CÓPIA DESCARTÁVEL da pasta principal
 * do projeto (com contexto/: padrões da base e conhecimento): a IA lê o que precisar, mas nada do que
 * fizer ali é aproveitado. Sempre com o perfil do projeto e a IA escolhida para ele.
 * Resultado: uma resposta em texto ou um plano (rascunho de job) que só vira trabalho com aprovação.
 */
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
    // Telemetria do planejamento: registrada no journalctl -u nivoo-worker.
    // Sem prompt, resposta, caminho privado ou chave de API no log.
    const entrouNoWorkerMs = Date.now();
    const registrarTempo = (evento: string, extras: Record<string, string | number | boolean | null | undefined> = {}) => {
      const agora = Date.now();
      console.info('[NIVOO_PLANO_TEMPO] ' + JSON.stringify({
        instante: new Date(agora).toISOString(),
        mensagemId: msg.id,
        conversaId: msg.conversationId,
        projetoId: msg.conversation.project.id,
        enviadaEm: msg.createdAt.toISOString(),
        desdeEnvioMs: Math.max(0, agora - msg.createdAt.getTime()),
        desdeEntradaWorkerMs: Math.max(0, agora - entrouNoWorkerMs),
        evento,
        ...extras,
      }));
    };
    registrarTempo('worker_recebeu', { tipo: msg.kind ?? 'normal' });
    // Uma resposta por vez em cada conversa: a mais antiga primeiro (ex.: a entrega de um trabalho chega
    // enquanto a IA ainda responde ao usuário).
    const antes = await this.prisma.conversationMessage.findFirst({
      where: { conversationId: msg.conversationId, status: 'PENDENTE', id: { not: msg.id }, createdAt: { lte: msg.createdAt } },
      orderBy: { createdAt: 'asc' },
    });
    if (antes && (antes.createdAt < msg.createdAt || antes.id < msg.id)) {
      registrarTempo('aguarda_resposta_anterior');
      await this.queue.requeue(task.id, workerId, new Date(Date.now() + 5_000), 'espera a resposta anterior da conversa');
      return;
    }
    const project = msg.conversation.project;
    const fail = async (texto: string) => {
      // Só se ainda estiver pendente: o usuário pode ter cancelado a resposta.
      registrarTempo('erro_antes_ou_sem_execucao', {
        codigo: texto.includes('limite de gasto') ? 'LIMITE_INTERNO' : texto.includes('não está conectada') ? 'PROVEDOR_INDISPONIVEL' : 'PREPARACAO',
      });
      await this.prisma.conversationMessage.updateMany({ where: { id: msg.id, status: 'PENDENTE' }, data: { status: 'ERRO', kind: 'erro', content: texto, completedAt: new Date() } });
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

    // Explicit Goldfish request only: no reviewer is added to normal planning or jobs.
    let goldfishScope:string|null=null;
    // Explicit FPS-only recovery is a deterministic continuation, not a
    // request for a language model to invent another assembly plan.
    if(msg.kind!=='entrega'){
      const userMessage=await this.prisma.conversationMessage.findFirst({
        where:{conversationId:msg.conversationId,role:'USUARIO',createdAt:{lte:msg.createdAt}},
        orderBy:{createdAt:'desc'},select:{content:true},
      });
      goldfishScope=goldfishRequest(userMessage?.content??'');
      if(goldfishScope!==null){
        if(!softwareInterfaceEnabled(project.area))return fail('A revisão independente está disponível apenas em projetos de software.');
        if(!goldfishScope)return fail('Informe o alvo da revisão: /goldfish docs/arquitetura.md ou /goldfish seguido da especificação a analisar.');
        if(!goldfishProviderSupported(tipoDe(project.provider)))return fail('Revisão independente indisponível nesta conexão: use Claude com modo restrito de leitura. Codex e Gemini ainda não têm isolamento validado para Goldfish. Nenhum provedor foi trocado.');
      }
      const recovery=goldfishScope===null?await planFpsResume(this.prisma,this.workspace,project,msg.conversationId,userMessage?.content??''):null;
      if(recovery){
        const plan=this.jobs.validatePlan({...recovery,defaultProvider:project.provider},project.area) as unknown as Prisma.InputJsonValue;
        const saved=await this.prisma.conversationMessage.updateMany({
          where:{id:msg.id,status:'PENDENTE'},
          data:{status:'PRONTA',kind:'plano',content:'Vou recuperar a composição do trabalho anterior e renderizar somente na taxa de quadros solicitada. O vídeo anterior será preservado.',plan,completedAt:new Date(),costUsd:0},
        });
        if(saved.count)await this.seguirSozinho(project.id,msg.conversationId,msg.id,true);
        await this.queue.complete(task.id,workerId);
        return;
      }
    }

    // A IA escolhida para o projeto conversa e trabalha; o perfil do projeto vale para qualquer uma.
    let providerId = project.provider;
    if (!this.registry.has(providerId)) return fail(`IA desconhecida: ${providerId}`);
    const iniciouStatusMs = Date.now();
    registrarTempo('consulta_status_inicio', { provedor: providerId });
    let status = await this.registry.status(providerId, 15_000);
    registrarTempo('consulta_status_fim', {
      provedor: providerId,
      duracaoMs: Date.now() - iniciouStatusMs,
      disponivel: status.available,
      limite429: status.errors.some((x) => /(?:HTTP\s*429|Too Many Requests)/i.test(x)),
    });
    let trocou = '';
    if (!status.available && goldfishScope===null) {
      // IA reserva do projeto: responde com a próxima conectada em vez de parar.
      const reserva = await trocarParaReserva(this.prisma, this.registry, project.id, providerId).catch(() => null);
      if (reserva) {
        trocou = `(${reserva.anterior} está indisponível; quem respondeu foi ${reserva.nome}, que agora é a IA do projeto.)\n\n`;
        providerId = reserva.id;
        project.provider = reserva.id;
        status = await this.registry.status(providerId, 0);
        registrarTempo('status_reserva', { provedor: providerId, disponivel: status.available });
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
      let revision='main';
      if(goldfishScope!==null){
        const rev=await runProcess('git',['-C',repo,'rev-parse','--verify','main^{commit}'],{cwd:tmp,env:minimalEnv(),timeoutMs:60_000});
        revision=rev.stdout.trim();
        if(rev.exitCode!==0||!/^[a-f0-9]{40,64}$/.test(revision))return fail('Não foi possível identificar a revisão da pasta principal para análise independente.');
        const snapshot=await runProcess('bash',['-c','set -o pipefail; git -C "$1" archive "$3" | tar -x -C "$2"','_',repo,tmp,revision],{cwd:tmp,env:minimalEnv(),timeoutMs:120_000});
        if(snapshot.exitCode!==0)return fail('Não foi possível preparar o snapshot para análise independente.');
        // Exclude any accidentally versioned session state in the disposable copy.
        for(const name of ['.nivoo','out'])fs.rmSync(path.join(tmp,name),{recursive:true,force:true});
      }else{
        await runProcess('bash', ['-c', 'git -C "$1" archive main | tar -x -C "$2"', '_', repo, tmp], { cwd: tmp, env: minimalEnv(), timeoutMs: 120_000 });
      }
      this.workspace.prepareSessionContext(project.area.slug, project.dirKey, tmp);
      // A cópia não tem .git: o histórico vai num arquivo (e o prompt explica que "not a git repository" é esperado).
      if(goldfishScope===null)fs.writeFileSync(path.join(tmp, SESSION_CONTEXT_DIR, 'historico-git.txt'), await historicoGit(repo));
      // Instruções de agente do repositório do projeto: legíveis em contexto/repositorio/, inertes.
      const harness = (await runProcess('bash', ['-c', 'git -C "$1" ls-tree -r --name-only "$2"', '_', repo, revision], { cwd: tmp, env: minimalEnv(), timeoutMs: 60_000 })).stdout
        .split('\n')
        .filter((f) => f && f.split('/').some((seg) => WorkspaceService.HARNESS_FILES.includes(seg)));
      await this.workspace.hideRepoHarness(tmp, harness);
      this.workspace.sanitizeHarnessFiles(tmp);
      // Anexos da conversa (mais recentes primeiro): imagens para ver, documentos já em texto.
      const comAnexos = goldfishScope!==null?[]:await this.prisma.conversationMessage.findMany({
        where: { conversationId: msg.conversationId, role: 'USUARIO', NOT: { attachments: { equals: Prisma.DbNull } } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, conversationId: true, attachments: true },
      });
      const anexos = copiarAnexosParaSessao(this.workspace.projectDirs(project.dirKey).root, tmp, comAnexos);
      // Resultados dos trabalhos desta conversa (relatórios, inventários, planos em out/): ficam fora do repositório,
      // mas a IA precisa lê-los para apresentar a entrega e para seguir ("pode fazer a limpeza").
      const resultados = goldfishScope!==null?[]:await this.artifacts.copiarResultados(project.id, await jobsDaConversa(this.prisma, msg.conversationId), path.join(tmp, SESSION_CONTEXT_DIR, 'resultados'));

      const profile = await this.profiles.build(project.id);
      const entrega = msg.kind === 'entrega' && msg.jobId ? await this.dadosDaEntrega(msg.jobId, project.dirKey) : null;
      const prompt = goldfishScope!==null
        ? goldfishReviewPrompt(goldfishScope,revision,AGENT_RULES,skillContext([GOLDFISH_SKILL],tmp))
        : await buildPlannerPrompt(this.prisma,this.workspace,this.registry,{conversationId:msg.conversationId,messageId:msg.id,messageCreatedAt:msg.createdAt,project,profileText:profile.text,anexos,entrega,providerId,resultados,worktree:tmp},ids=>registrarTempo('skills_selecionadas',{provedor:providerId,skillsVersion:SKILLS_VERSION,skillIds:ids.join(', '),quantidade:ids.length}));
      if(goldfishScope!==null)registrarTempo('goldfish_inicio',{provedor:providerId,skillsVersion:SKILLS_VERSION,skill:GOLDFISH_SKILL.id,revisao:revision});
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
      // Registrar quando a execução pelo provedor foi SOLICITADA.
      // Se um erro de configuração ocorrer antes, startedAt permanece null.
      await this.prisma.conversationMessage.updateMany({
        where: { id: msg.id, status: 'PENDENTE', startedAt: null },
        data: { startedAt: new Date() },
      });
      const iniciouIaMs = Date.now();
      registrarTempo('ia_chamada_inicio', { provedor: providerId, preparacaoMs: iniciouIaMs - entrouNoWorkerMs, promptBaseCaracteres:prompt.length,perfilCaracteres:profile.text.length });
      const result = await this.registry.get(providerId).execute({
        jobId: 'conversa',
        stepId: msg.conversationId,
        attemptId: msg.id,
        instructions: prompt,
        context: '',
        cwd: tmp,
        outputDir: path.join(tmp, 'out'),
        systemPrompt: profile.text,
        mcp: goldfishScope!==null?[]:mcpDoProjeto(project.id, { mensagemId: msg.id }),
        timeoutMs: Number(process.env.NIVOO_PLANNER_TIMEOUT_SEC ?? 900) * 1000,
        signal,
        options: {
          maxTurns: Math.min(20,Math.max(1,Number(process.env.NIVOO_PLANNER_MAX_TURNS ?? 20))),
          model: projectModel(project, providerId),
          ...(goldfishScope!==null?{readOnlyReview:true}:{}),
          // Imagens anexadas: quem aceita imagem pela linha de comando (ChatGPT/Codex) recebe-as direto também.
          images: anexos.filter((a) => a.tipo === 'imagem').map((a) => path.join(tmp, a.caminho)),
        },
        onLog: (linha) => gravarAndamento(linha),
      }).catch((e: unknown) => {
        registrarTempo('ia_chamada_excecao', { provedor: providerId, duracaoMs: Date.now() - iniciouIaMs, tipo: e instanceof Error ? e.name : 'erro' });
        throw e;
      });
      registrarTempo('ia_chamada_fim', {
        provedor: providerId,
        duracaoMs: Date.now() - iniciouIaMs,
        codigoSaida: result.exitCode,
        recursoIndisponivel: !!result.resourceUnavailable,
        erroHttp: /\bHTTP\s*(\d{3})\b/i.exec(String(result.error ?? ''))?.[1] ?? null,
        respostaCaracteres: result.output?.length ?? 0,
        tokensEntrada: result.inputTokens ?? 0,
        tokensSaida: result.outputTokens ?? 0,
      });
      await gravando;
      if (result.interrupted) {
        // Lease perdido: outro worker vai assumir; nada é gravado aqui.
        return;
      }
      this.registry.registrarResultado(providerId, result.exitCode === 0 && !result.resourceUnavailable, result.error); // só o canal de erro, nunca o texto da IA (código e logs do projeto citam 401…)
      if(goldfishScope!==null){
        // Review output is data only: no plan, memory, repair, auto-start or fallback.
        const outcome=goldfishReviewOutcome(result);
        const saved=await this.prisma.conversationMessage.updateMany({where:{id:msg.id,status:'PENDENTE'},data:{
          status:outcome.ok?'PRONTA':'ERRO',kind:outcome.ok?'resposta':'erro',content:outcome.text,
          sessionId:result.sessionId,costUsd:result.costUsd??0,completedAt:new Date(),
        }});
        if(!saved.count)await this.prisma.conversationMessage.update({where:{id:msg.id},data:{sessionId:result.sessionId,costUsd:result.costUsd??0}});
        registrarTempo('goldfish_fim',{provedor:providerId,sucesso:outcome.ok,gravada:saved.count>0,custoUsd:result.costUsd??0});
        await this.queue.complete(task.id,workerId);
        return;
      }
      // Sem crédito/limite no meio da resposta: se houver IA reserva, a mesma pergunta vai para ela.
      if (result.resourceUnavailable) {
        const reserva = await trocarParaReserva(this.prisma, this.registry, project.id, providerId).catch(() => null);
        if (reserva) {
          registrarTempo('reencaminhada_para_reserva', { provedorAnterior: providerId, proximoProvedor: reserva.id });
          await this.prisma.conversationMessage.create({
            data: { conversationId: msg.conversationId, role: 'ASSISTENTE', status: 'PRONTA', kind: 'sistema', content: `${reserva.anterior} ficou indisponível (${(result.error ?? '').slice(0, 200)}). Quem responde agora é ${reserva.nome}, que passou a ser a IA do projeto.` },
          });
          await this.queue.requeue(task.id, workerId, new Date(), 'resposta refeita com a IA reserva');
          return;
        }
      }
      let parsed = extractJson(result.output);
      registrarTempo('resposta_interpretada', { tipo: parsed?.tipo ?? (parsed ? 'json_sem_tipo' : 'sem_json'), temPlano: !!parsed?.job });
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
        registrarTempo('validacao_plano_inicio', { etapas: Array.isArray(parsed.job?.steps) ? parsed.job.steps.length : 0 });
        try {
          // Quem trabalha é sempre a IA escolhida para o projeto.
          plan = validatedPlannerJob(this.jobs,parsed,providerId,project.area,anexos);
          registrarTempo('validacao_plano_aprovada');
          kind = 'plano';
          content = String(parsed.texto ?? 'Plano proposto.');
        } catch (e: any) {
          // Um plano inválido não deve ser devolvido ao usuário para ele depurar JSON.
          // Uma única correção interna, com o erro exato do contrato, e nova validação.
          // Sem executar trabalho nem inventar limiares numéricos.
          const erroInicial = String(e?.response?.message ?? e?.message ?? 'plano inválido').slice(0, 700);
          registrarTempo('validacao_plano_reprovada', { tipoErro: e?.name ?? 'erro', motivoCodigo: /local-shell|renderizar-motion/.test(erroInicial) ? 'RENDER_MOTION' : 'OUTRA_VALIDACAO' });
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
              JSON.stringify(parsed),
            ].join('\n');
            const iniciouReparoMs = Date.now();
            registrarTempo('reparo_ia_inicio', { provedor: providerId });
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
            registrarTempo('reparo_ia_fim', {
              provedor: providerId,
              duracaoMs: Date.now() - iniciouReparoMs,
              codigoSaida: reparo.exitCode,
              recursoIndisponivel: !!reparo.resourceUnavailable,
              erroHttp: /\bHTTP\s*(\d{3})\b/i.exec(String(reparo.error ?? ''))?.[1] ?? null,
              respostaCaracteres: reparo.output?.length ?? 0,
              tokensEntrada: reparo.inputTokens ?? 0,
              tokensSaida: reparo.outputTokens ?? 0,
            });
            if (reparo.interrupted || signal.aborted) return;
            if (reparo.exitCode !== 0 || reparo.resourceUnavailable) throw new Error(reparo.error ?? 'reparo indisponível');
            const corrigido = extractJson(reparo.output);
            registrarTempo('reparo_json_interpretado', { tipo: corrigido?.tipo ?? 'sem_json', temPlano: !!corrigido?.job });
            if (corrigido?.tipo !== 'plano' || !corrigido.job) throw new Error('A correção não retornou um plano estruturado');
            plan = validatedPlannerJob(this.jobs,corrigido,providerId,project.area,anexos);
            registrarTempo('reparo_plano_aprovado');
            parsed = corrigido;
            kind = 'plano';
            content = String(corrigido.texto ?? parsed.texto ?? 'Plano conferido e corrigido.');
          } catch (erroReparo: any) {
            reparoErro = String(erroReparo?.response?.message ?? erroReparo?.message ?? 'reparo inválido').slice(0, 700);
            registrarTempo('reparo_plano_falhou', { tipoErro: erroReparo?.name ?? 'erro', motivoCodigo: reparoErro.includes('não retornou um plano estruturado') ? 'JSON_NAO_E_PLANO' : 'OUTRO_ERRO' });
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
          completedAt: new Date(),
        },
      });
      // Resposta cancelada pelo usuário enquanto a IA trabalhava: o custo da sessão conta mesmo assim.
      registrarTempo('resposta_gravada', {
        gravada: gravada.count > 0,
        status: erro ? 'ERRO' : 'PRONTA',
        tipo: kind,
        custoUsd: result.costUsd ?? 0,
      });
      if (!gravada.count) await this.prisma.conversationMessage.update({ where: { id: msg.id }, data: { sessionId: result.sessionId, costUsd: result.costUsd ?? 0 } });
      if (gravada.count && !erro && plan) {
        const alvo = planoDaEntrega
          ? (await this.prisma.conversationMessage.create({ data: { conversationId: msg.conversationId, role: 'ASSISTENTE', status: 'PRONTA', kind: 'plano', content: String(parsed?.texto ?? 'Plano do que falta.'), plan: planoDaEntrega, completedAt: new Date() } })).id
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
    // Uma montagem de vídeo é uma entrega final, não a autorização para
    // criar e executar outra montagem automaticamente depois do resultado.
    const ultimaAprovacao = await this.prisma.conversationMessage.findFirst({
      where: { conversationId, jobId: { not: null }, approvedAt: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { jobId: true },
    });
    if (ultimaAprovacao?.jobId) {
      const anterior = await this.prisma.job.findUnique({
        where: { id: ultimaAprovacao.jobId },
        include: { steps: { select: { provider: true } } },
      });
      if (anterior?.status === 'CONCLUIDO' && anterior.steps.some(s => s.provider === 'juntar-videos')) return;
    }
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
    if (job.status === 'BLOQUEADO' || job.status === 'FALHOU' || job.status === 'AGUARDANDO_RECURSO') {
      const logs = await this.prisma.logEntry.findMany({ where: { jobId }, orderBy: { id: 'desc' }, take: 18 });
      const etapaRuim = job.steps.find((s) => ['BLOQUEADO', 'FALHOU', 'AGUARDANDO_RECURSO'].includes(s.status)) ?? job.steps[job.steps.length - 1];
      const tentativasDaEtapa = job.attempts.filter((a) => a.stepId === etapaRuim?.id).slice(0, 3);
      return [
        `${job.status === 'AGUARDANDO_RECURSO' ? 'O TRABALHO AGUARDA UM RECURSO/ARQUIVO (não foi concluído)' : 'O TRABALHO PAROU COM ERRO (não concluiu)'}: "${job.title}" — status ${job.status}${job.blockedReason ? ` (${job.blockedReason})` : ''}.`,
        `Objetivo do trabalho: ${job.objectives[0]?.text ?? ''}`,
        `Motivo da parada: ${(job.statusDetail ?? '').replace(/\s+/g, ' ').slice(0, 800) || '(sem detalhe)'}`,
        `Etapa com problema: "${etapaRuim?.title || etapaRuim?.key}" (executor ${etapaRuim?.provider ?? job.defaultProvider}).`,
        ...tentativasDaEtapa.map((a) => `- tentativa #${a.number}: ${a.status}${a.error ? ` — ${a.error.replace(/\s+/g, ' ').slice(0, 400)}` : ''}`),
        ...job.criteria.filter((c) => c.status !== 'APROVADO').map((c) => `- critério "${c.key}" (${c.kind}) ${c.status}: ${c.description.slice(0, 150)}${c.checks[0] ? ` — evidência: ${JSON.stringify(c.checks[0].evidence).slice(0, 300)}` : ''}`),
        `Últimas linhas do log:\n${logs.reverse().map((l) => `${l.level} ${l.source}: ${l.message.replace(/\s+/g, ' ').slice(0, 220)}`).join('\n')}`,
        '',
        'SUA TAREFA AGORA (retomada): explique a causa, mas NÃO proponha criar outro trabalho só para corrigir uma etapa bloqueada.',
        'O mesmo job guarda checkpoints e etapas concluídas. Use o botão Continuar do trabalho existente DEPOIS de corrigir a causa.',
        'Em montagem bloqueada por TRILHA_NAO_LOCALIZADA, o Nivoo já procura o nome original nos uploads e artefatos do projeto.',
        'Se não encontrou: informe qual áudio original falta, quais candidatos constam do diagnóstico e que o usuário precisa',
        'enviar ou identificar a trilha correta; NÃO invente um novo nome de MP3 e NÃO gere outra composição 3D.',
        'Em erro técnico de script, o worker cria reparos na própria execução antes da terceira repetição idêntica.',
        'Se atingiu a terceira repetição do mesmo erro, explique o impedimento específico, sem mandar fazer três tentativas idênticas.',
        'Não marque "continuacao": true e não inicie outra execução automática após um bloqueio real sem recurso/correção.',
        'Só proponha trabalho NOVO quando houver objetivo realmente novo; não repita composição, vídeo, testes e custos já concluídos.',
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

}

export { extractJson,salvarTextoDaResposta,normalizarPerguntas } from './planner/response';
