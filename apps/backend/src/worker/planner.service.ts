import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { minimalEnv, runProcess } from '../common/exec';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { ClaimedTask, QueueService } from '../queue/queue.service';
import { AGENT_RULES } from '../security/policy';
import { WorkspaceService } from '../storage/workspace.service';
import { memoryLine, sortMemory } from './context-builder';
import { sha256 } from '../common/hash';

const MAX_MEMORIA = 15_000;
const MAX_ARQUIVOS = 300;

/**
 * Responde mensagens da conversa do projeto. Roda no worker, numa CÓPIA DESCARTÁVEL da pasta principal
 * do projeto (com a base da área): a IA lê o que precisar, mas nada do que fizer ali é aproveitado.
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
    const project = msg.conversation.project;
    const fail = async (texto: string) => {
      await this.prisma.conversationMessage.update({ where: { id: msg.id }, data: { status: 'ERRO', kind: 'erro', content: texto } });
      await this.queue.complete(task.id, workerId);
    };

    const providerId = process.env.NIVOO_PLANNER_PROVIDER ?? 'claude-code-cli';
    if (!this.registry.has(providerId)) return fail(`Conector do planejador desconhecido: ${providerId}`);
    const status = await this.registry.status(providerId, 15_000);
    if (!status.available) return fail(`A IA da conversa (${providerId}) está indisponível: ${status.errors.join('; ')}. Conecte a conta em Conectores e envie a mensagem de novo.`);

    // Cópia descartável: pasta principal do projeto + base da área.
    const tmp = path.join(project.workspacePath, 'conversas-tmp', msg.id);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    try {
      const repo = this.workspace.projectDirs(project.dirKey).repo;
      await runProcess('bash', ['-c', 'git -C "$1" archive main | tar -x -C "$2"', '_', repo, tmp], { cwd: tmp, env: minimalEnv(), timeoutMs: 120_000 });
      this.workspace.copyAreaBaseInto(project.area.slug, tmp);
      this.workspace.sanitizeHarnessFiles(tmp);

      const prompt = await this.buildPrompt(msg.conversationId, msg.id, project);
      const result = await this.registry.get(providerId).execute({
        jobId: 'conversa',
        stepId: msg.conversationId,
        attemptId: msg.id,
        instructions: prompt,
        context: '',
        cwd: tmp,
        outputDir: path.join(tmp, 'out'),
        dataDir: tmp,
        timeoutMs: Number(process.env.NIVOO_PLANNER_TIMEOUT_SEC ?? 300) * 1000,
        signal,
        options: { maxTurns: Number(process.env.NIVOO_PLANNER_MAX_TURNS ?? 25) },
        onLog: () => undefined,
      });
      if (result.interrupted) {
        // Lease perdido: outro worker vai assumir; nada é gravado aqui.
        return;
      }
      const parsed = extractJson(result.output);
      let kind = 'resposta';
      let content = result.output.trim();
      let plan: Prisma.InputJsonValue | undefined;
      let erro: string | null = null;
      if (result.resourceUnavailable) erro = `IA indisponível no momento (limite ou login): ${result.error ?? ''}`.trim();
      else if (result.exitCode !== 0 && !result.sessionEnded) erro = `A IA não conseguiu responder: ${result.error ?? 'erro desconhecido'}`;
      else if (parsed?.tipo === 'plano') {
        try {
          plan = this.jobs.validatePlan(parsed.job) as unknown as Prisma.InputJsonValue;
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
      await this.prisma.conversationMessage.update({
        where: { id: msg.id },
        data: {
          status: erro ? 'ERRO' : 'PRONTA',
          kind: erro ? 'erro' : kind,
          content: erro ?? (content || '(sem resposta)'),
          plan,
          sessionId: result.sessionId,
          costUsd: result.costUsd ?? 0,
        },
      });
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

  private async buildPrompt(conversationId: string, messageId: string, project: { id: string; name: string; description: string; dirKey: string; area: { id: string; name: string; slug: string } }) {
    const [instr, memoria, historico] = await Promise.all([
      this.prisma.areaInstruction.findFirst({ where: { areaId: project.area.id }, orderBy: { version: 'desc' } }),
      this.prisma.memoryEntry.findMany({ where: { projectId: project.id, supersededById: null } }),
      this.prisma.conversationMessage.findMany({ where: { conversationId, id: { not: messageId } }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    const arquivos = (await this.workspace.listMainFiles(project.dirKey)).filter((f) => !f.path.startsWith('.'));
    const base = this.workspace.listAreaFiles(project.area.slug);
    let memTxt = '';
    for (const m of sortMemory(memoria)) {
      const l = memoryLine(m) + '\n';
      if (memTxt.length + l.length > MAX_MEMORIA) break;
      memTxt += l;
    }
    const conversa = historico
      .reverse()
      .map((m) => `${m.role === 'USUARIO' ? 'USUÁRIO' : 'IA'}: ${m.kind === 'plano' ? `[plano proposto${m.jobId ? ', aprovado' : ''}] ` : ''}${m.content.slice(0, 3000)}`)
      .join('\n\n');
    return [
      '# Você é o planejador do Nivoo AI Manager',
      '',
      '## Regras invioláveis',
      ...AGENT_RULES.map((r) => `- ${r}`),
      '- Este diretório é uma CÓPIA DESCARTÁVEL da pasta do projeto: leia o que precisar, mas NÃO crie, altere nem apague arquivos.',
      '- Você não executa o trabalho: você conversa e, quando fizer sentido, propõe um plano. O usuário aprova; então um job executa.',
      '',
      `## Área: ${project.area.name} — instruções permanentes (v${instr?.version ?? 0})`,
      instr?.text ?? '(sem instruções)',
      `Base de conhecimento da área — padrões que todo projeto da área segue (em area/; leia o que for relevante antes de responder): ${base.slice(0, 300).map((f) => `area/${WorkspaceService.sessionPath(f.path)}`).join(', ') || 'vazia'}${base.length > 300 ? ` … e mais ${base.length - 300}` : ''}`,
      'Arquivos de configuração de agentes da base aparecem renomeados com "_" (ex.: area/_claude/, area/_CLAUDE.md): leia-os como instruções e padrões.',
      '',
      `## Projeto: ${project.name}`,
      project.description || '(sem descrição)',
      `Arquivos da pasta principal (diretório atual): ${arquivos.slice(0, MAX_ARQUIVOS).map((f) => f.path).join(', ') || 'vazia'}${arquivos.length > MAX_ARQUIVOS ? ` … e mais ${arquivos.length - MAX_ARQUIVOS}` : ''}`,
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
      'Termine SEMPRE com UM bloco ```json``` em um destes formatos:',
      '1) {"tipo":"resposta","texto":"..."} — para perguntas, esclarecimentos ou quando faltar informação (pergunte o que precisar).',
      '2) {"tipo":"plano","texto":"explicação curta para o usuário","job":{...}} — quando houver trabalho a executar.',
      'Formato do job:',
      '{"title":"...","objective":"objetivo completo e verificável","defaultProvider":"claude-code-cli",',
      ' "steps":[{"key":"etapa1","title":"...","instructions":"o que a IA deve fazer","dependsOn":[],',
      '           "verifyCommand":"comando bash que retorna 0 quando a etapa está pronta, ex.: test -s docs/briefing.md"}],',
      ' "criteria":[{"key":"...","description":"...","kind":"FILE_EXISTS","config":{"path":"docs/briefing.md"}}]}',
      'Regras do plano:',
      '- Toda etapa executada por IA precisa de verifyCommand (verificação objetiva).',
      '- Arquivos que fazem parte do projeto (estrutura, documentos, código, peças) vão em caminhos normais: depois de',
      '  aprovados pelo verificador ficam na pasta principal e os próximos trabalhos os enxergam.',
      '- out/ é só para evidências e relatórios (viram artefatos com hash; não ficam na pasta principal).',
      '- Critérios: FILE_EXISTS {"path"}, COMMAND {"command"}, ARTIFACT_PRESENT {"name": arquivo em out/},',
      '  METRIC_THRESHOLD {"artifact","path","op","value"}, MANUAL_APPROVAL {} (use para qualidade subjetiva, ex.: estética).',
      '- Respeite as instruções da área, a base de conhecimento e a memória do projeto.',
      '- No "texto" de um plano, explique em palavras simples o que será feito (sem falar de critérios, JSON ou comandos).',
      '',
      '## Memória do projeto (obrigatório)',
      'Em qualquer dos dois formatos, inclua "memoria": [...] com o que precisa ser lembrado para sempre neste projeto:',
      'decisões e preferências que o usuário expressou, fatos importantes que ele informou e pendências combinadas.',
      'Formato: {"tipo":"DECISAO|PREFERENCIA|FATO|PENDENCIA","titulo":"curto","conteudo":"frase completa"}.',
      'Só registre o que o usuário disse ou confirmou; não invente. Não repita o que já está na memória. Lista vazia se não houver nada.',
      '',
      '## Mensagem atual do usuário',
      (await this.prisma.conversationMessage.findFirst({ where: { conversationId, role: 'USUARIO' }, orderBy: { createdAt: 'desc' } }))?.content ?? '',
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

