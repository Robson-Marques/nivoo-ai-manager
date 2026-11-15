import { caminhoDoProjeto } from '../common/path-guard';
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
import { WorkspaceService } from '../storage/workspace.service';
import { projectModel } from './step-executor.service';
import { ProjectProfileService } from '../projects/project-profile.service';
import { memoryLine, sortMemory } from './context-builder';
import { sha256 } from '../common/hash';

const MAX_MEMORIA = 15_000;
const MAX_ARQUIVOS = 300;

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

      const profile = await this.profiles.build(project.id);
      const entrega = msg.kind === 'entrega' && msg.jobId ? await this.dadosDaEntrega(msg.jobId, project.dirKey) : null;
      const prompt = await this.buildPrompt(msg.conversationId, msg.id, project, profile.text, anexos, entrega);
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
        timeoutMs: Number(process.env.NIVOO_PLANNER_TIMEOUT_SEC ?? 900) * 1000,
        signal,
        options: {
          maxTurns: Number(process.env.NIVOO_PLANNER_MAX_TURNS ?? 25),
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
      const parsed = extractJson(result.output);
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
      else if (parsed?.tipo === 'plano' && msg.kind === 'entrega') {
        // A entrega é sempre um relatório (o plano novo vem depois das respostas do usuário).
        content = String(parsed.texto ?? '');
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
          kind = 'resposta';
          content = `${String(parsed.texto ?? '')}\n\n[O plano proposto não passou na validação: ${e?.response?.message ?? e?.message}. Peça para a IA ajustar.]`.trim();
        }
      } else if (parsed?.tipo === 'resposta') {
        content = String(parsed.texto ?? '');
      }
      if (!erro && Array.isArray(parsed?.memoria)) {
        const guardados = await this.saveMemory(project.id, msg.conversationId, msg.id, parsed.memoria);
        if (guardados.length) content = `${content}\n\nGuardei na memória do projeto: ${guardados.join('; ')}.`;
      }
      const gravada = await this.prisma.conversationMessage.updateMany({
        where: { id: msg.id, status: 'PENDENTE' },
        data: {
          status: erro ? 'ERRO' : 'PRONTA',
          kind: erro ? 'erro' : msg.kind === 'entrega' ? 'entrega' : kind,
          content: erro ?? `${trocou}${content || '(sem resposta)'}`,
          plan,
          sessionId: result.sessionId,
          costUsd: result.costUsd ?? 0,
        },
      });
      // Resposta cancelada pelo usuário enquanto a IA trabalhava: o custo da sessão conta mesmo assim.
      if (!gravada.count) await this.prisma.conversationMessage.update({ where: { id: msg.id }, data: { sessionId: result.sessionId, costUsd: result.costUsd ?? 0 } });
      await this.queue.complete(task.id, workerId);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
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
      const hash = sha256(`${category}|${titulo.toLowerCase()}|${conteudo.toLowerCase()}`);
      const existe = await this.prisma.memoryEntry.findFirst({ where: { projectId, supersededById: null, references: { path: ['memoryHash'], equals: hash } } });
      if (existe) continue;
      await this.prisma.memoryEntry.create({
        data: {
          projectId,
          category,
          title: titulo,
          content: conteudo,
          references: { origem: 'conversa', conversationId, messageId, memoryHash: hash },
          author: 'conversa',
        },
      });
      guardados.push(titulo);
    }
    return guardados;
  }

  /** O que a IA precisa para apresentar a entrega: o trabalho e os arquivos que ele criou/alterou/apagou. */
  private async dadosDaEntrega(jobId: string, dirKey: string): Promise<string> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, include: { objectives: { orderBy: { version: 'desc' }, take: 1 } } });
    if (!job) return '';
    const arquivos = job.mergedCommit ? await this.workspace.arquivosDoCommit(dirKey, job.mergedCommit) : [];
    const nome: Record<string, string> = { A: 'novo', M: 'alterado', D: 'apagado', R: 'movido' };
    return [
      `Trabalho concluído e conferido: "${job.title}".`,
      `Objetivo: ${job.objectives[0]?.text ?? ''}`,
      `Arquivos (${arquivos.length}): ${arquivos.slice(0, 80).map((f) => `${f.path} (${nome[f.status] ?? f.status}${f.de ? ` de ${f.de}` : ''})`).join('; ') || 'nenhum arquivo mudou'}`,
    ].join('\n');
  }

  private async buildPrompt(conversationId: string, messageId: string, project: { id: string; dirKey: string }, profileText: string, anexos: Array<Anexo & { mensagem: string; caminho: string }> = [], entrega: string | null = null) {
    const videoDisponivel = this.registry.has('gemini-video') && (await this.registry.status('gemini-video', 15_000)).available;
    const [memoria, historico] = await Promise.all([
      this.prisma.memoryEntry.findMany({ where: { projectId: project.id, supersededById: null } }),
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
      `Arquivos da pasta principal do projeto (diretório atual): ${arquivos.slice(0, MAX_ARQUIVOS).map((f) => f.path).join(', ') || 'vazia'}${arquivos.length > MAX_ARQUIVOS ? ` … e mais ${arquivos.length - MAX_ARQUIVOS}` : ''}`,
      '',
      '## Memória do projeto (decisões, restrições, lições, pendências)',
      memTxt || '(vazia)',
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
      '1) {"tipo":"resposta","texto":"..."} — para perguntas, esclarecimentos ou quando faltar informação (pergunte o que precisar).',
      '2) {"tipo":"plano","texto":"explicação curta para o usuário","job":{...}} — quando houver trabalho a executar.',
      'Formato do job:',
      '{"title":"...","objective":"objetivo completo e verificável",',
      ' "steps":[{"key":"etapa1","title":"...","instructions":"o que a IA deve fazer","dependsOn":[],',
      '           "verifyCommand":"comando bash que retorna 0 quando a etapa está pronta, ex.: test -s docs/briefing.md"}],',
      ' "criteria":[{"key":"...","description":"...","kind":"FILE_EXISTS","config":{"path":"docs/briefing.md"}}]}',
      'Regras do plano:',
      '- Toda etapa executada por IA precisa de verifyCommand (verificação objetiva).',
      '- verifyCommand e critérios COMMAND: use só comandos básicos do bash (test, grep, find, wc, ls, cat, head, tail, sed, awk, diff).',
      '  NUNCA rg, jq, python, node, npm ou outro programa que talvez não esteja instalado.',
      '- Arquivos que fazem parte do projeto (estrutura, documentos, código, peças) vão em caminhos normais: depois de',
      '  aprovados pelo verificador ficam na pasta principal e os próximos trabalhos os enxergam.',
      '- out/ é só para evidências e relatórios (viram artefatos com hash; não ficam na pasta principal).',
      '- Critérios: FILE_EXISTS {"path"}, COMMAND {"command"}, ARTIFACT_PRESENT {"name": arquivo em out/},',
      '  METRIC_THRESHOLD {"artifact","path","op","value"}, MANUAL_APPROVAL {} (use para qualidade subjetiva, ex.: estética).',
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
            '   "imagem":"caminho opcional de uma imagem do projeto para ser o primeiro quadro"}}',
            '  Proporção: "16:9" (horizontal) ou "9:16" (vertical, para celular/stories). Cada vídeo é cobrado por segundo pelo Google:',
            '  diga no "texto" quantos vídeos e quantos segundos serão. Imagem anexada no chat como primeiro quadro: coloque-a no projeto',
            '  com "anexosNoProjeto" e use o mesmo caminho em "imagem". Não precisa de verifyCommand: o sistema confere o arquivo.',
            '  O Google gera de 3 a 15 s por vez (duracaoSeg de 3 a 15): para um vídeo maior, uma etapa por cena (videos/<nome>/cena-01.mp4, cena-02.mp4…) e o',
            '  SISTEMA acrescenta sozinho a etapa final que junta as cenas, na ordem, em videos/<nome>/<nome>-completo.mp4 (não crie essa etapa).',
          ]
        : []),
      '- Anexos do chat ficam em contexto/anexos/ (leitura). Para colocar um anexo DENTRO do projeto (ex.: o logo',
      '  enviado vira public/logo.png), inclua no job "anexosNoProjeto":[{"anexo":"contexto/anexos/<id>/<arquivo>","para":"public/logo.png"}]:',
      '  o sistema copia o arquivo antes de o trabalho começar. Nunca tente recriar uma imagem escrevendo o arquivo.',
      '',
      '## Memória do projeto (obrigatório)',
      'Em qualquer dos dois formatos, inclua "memoria": [...] com o que precisa ser lembrado para sempre neste projeto:',
      'decisões e preferências que o usuário expressou, fatos importantes que ele informou e pendências combinadas.',
      'Formato: {"tipo":"DECISAO|PREFERENCIA|FATO|PENDENCIA","titulo":"curto","conteudo":"frase completa"}.',
      'Só registre o que o usuário disse ou confirmou; não invente. Não repita o que já está na memória. Lista vazia se não houver nada.',
      '',
      ...(entrega
        ? [
            '## AGORA: apresente a ENTREGA do trabalho que acabou de terminar (o usuário ainda não viu o resultado)',
            entrega,
            'Leia os arquivos novos/alterados acima e responda em linguagem simples:',
            '1) O que foi feito (poucas linhas).',
            '2) Onde está: os caminhos exatos dos arquivos principais (o usuário abre pela tela clicando neles).',
            '   Vídeo: o resultado é o vídeo COMPLETO (…-completo.mp4, com player e "baixar" na conversa); cite as cenas só como peças.',
            '3) Se o resultado tiver decisões, dúvidas, riscos ou itens que dependem do usuário (ex.: um documento com pendências),',
            '   LISTE TODAS como perguntas numeradas — cada uma com as opções e a SUA recomendação — e peça a resposta',
            '   (ex.: "1. C5 — página de teste de iconografia: (a) apagar (b) manter. Recomendo (a) porque…").',
            '4) O próximo passo sugerido. Não proponha plano agora: espere as respostas. Use {"tipo":"resposta"}.',
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

/** Último bloco ```json``` da resposta (ou o texto inteiro, se for JSON). */
export function extractJson(text: string): any | null {
  const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  const candidates = blocks.length ? [blocks[blocks.length - 1][1]] : [text];
  for (const c of candidates) {
    try {
      return JSON.parse(c.trim());
    } catch {
      /* não é JSON */
    }
  }
  return null;
}

