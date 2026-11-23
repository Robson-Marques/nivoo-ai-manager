import { Injectable } from '@nestjs/common';
import { execFileSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { listarConexoes } from '../accounts/connections';
import { mcpDoProjeto } from '../mcp/mcp';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderRegistry } from '../providers/provider-registry.service';
import { lerErros, redigir } from './erros';

const corte = (t: unknown, n: number) => {
  const s = String(t ?? '').trim();
  return s.length > n ? `…${s.slice(-n)}` : s;
};
const bloco = (t: unknown, n = 1500) => {
  const s = corte(t, n);
  return s ? `\n\`\`\`\n${s.replace(/```/g, "'''")}\n\`\`\`` : ' (vazio)';
};

/**
 * Relatórios de diagnóstico para colar no suporte: tudo o que é preciso para entender um problema de uma vez
 * (em vez de tentativa e erro), sempre sem segredos (tokens, chaves, senhas são apagados).
 */
@Injectable()
export class DiagnosticoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistry,
  ) {}

  private versao(): string {
    try {
      const raiz = path.resolve(__dirname, '..', '..', '..', '..');
      return execFileSync('git', ['-c', 'safe.directory=*', '-C', raiz, 'log', '-1', '--format=%h (%cI) %s'], { encoding: 'utf8', timeout: 5000 }).trim();
    } catch {
      return 'desconhecida';
    }
  }

  private async ias(ids: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const id of [...new Set(ids)].filter((x) => this.registry.has(x))) {
      const s = await this.registry.status(id, 60_000).catch((e) => ({ id, label: id, available: false, version: undefined, errors: [String(e?.message ?? e)] }) as any);
      out.push(`- ${s.label} (\`${id}\`): ${s.available ? 'disponível' : 'INDISPONÍVEL'}${s.version ? ` · versão ${s.version}` : ''}${s.errors?.length ? ` · ${s.errors.join('; ')}` : ''}`);
    }
    return out;
  }

  /** Diagnóstico de um trabalho: etapas, tentativas (erro, término, saída), conferências, log, IAs e ferramentas. */
  async doTrabalho(projectId: string, jobId: string): Promise<string> {
    const job = await this.prisma.job.findFirstOrThrow({
      where: { id: jobId, projectId },
      include: {
        project: true,
        steps: { orderBy: { order: 'asc' } },
        attempts: { orderBy: { number: 'desc' }, take: 40 },
        criteria: { include: { checks: { orderBy: { createdAt: 'desc' }, take: 1 } } },
        approvals: { where: { status: 'PENDENTE' } },
        objectives: { orderBy: { version: 'desc' }, take: 1 },
      },
    });
    const logs = await this.prisma.logEntry.findMany({ where: { jobId }, orderBy: { id: 'desc' }, take: 150 });
    const ssh = await this.prisma.sshPedido.findMany({ where: { jobId }, orderBy: { createdAt: 'desc' }, take: 10 });
    const p = job.project;
    const L: string[] = [];
    L.push(`# Diagnóstico do trabalho "${job.title}"`, '');
    L.push(`- Gerado em: ${new Date().toISOString()} · Nivoo ${this.versao()} · servidor ${os.hostname()} · Node ${process.version}`);
    L.push(`- Projeto: ${p.name} (\`${p.id}\`) · IA do projeto: \`${p.provider}\` · modelos: ${JSON.stringify(p.aiModels)} · reserva: ${JSON.stringify(p.aiReserva ?? [])} · Git: ${p.gitUrl ? `${p.gitUrl} (${p.gitBranch}, envio automático ${p.gitAutoPush ? 'ligado' : 'desligado'})` : 'não ligado'}`);
    // O banco contabiliza activeSeconds quando a tentativa termina. O diagnóstico soma a tentativa ativa
    // apenas para exibição, sem alterar o acumulado nem contar tempo de pausa.
    const sessaoAtiva = job.status === 'EXECUTANDO' ? job.attempts.find(a => a.status === 'EXECUTANDO') : null;
    const segundosEmAndamento = sessaoAtiva ? Math.max(0, Math.floor((Date.now() - sessaoAtiva.startedAt.getTime()) / 1000)) : 0;
    L.push(`- Trabalho \`${job.id}\`: **${job.status}**${job.blockedReason ? ` · motivo: ${job.blockedReason}` : ''} · criado ${job.createdAt.toISOString()} · tempo ativo ${job.activeSeconds + segundosEmAndamento}s${sessaoAtiva ? ' (inclui sessão ativa)' : ''} · gasto US$ ${job.costSpentUsd}${sessaoAtiva ? ' (parcial; sessão ativa ainda não contabilizada)' : ''}`);
    L.push(`- Limites: sessões/etapa ${job.maxSessionsPerStep || 'sem limite'} · tentativas/etapa ${job.maxAttemptsPerStep} · tempo ${job.maxDurationSec || 'sem limite'}s · tempo por sessão ${job.stepTimeoutSec}s · gasto ${Number(job.maxCostUsd) || 'sem limite'}`);
    if (job.statusDetail) L.push('', '## Motivo da parada', bloco(job.statusDetail, 3000));
    L.push('', '## Objetivo', bloco(job.objectives[0]?.text, 2000));
    L.push('', '## Etapas');
    for (const s of job.steps) {
      const n = job.attempts.filter((a) => a.stepId === s.id).length;
      L.push(`- **${s.key}** "${s.title}" · ${s.status} · IA/executor \`${s.provider ?? job.defaultProvider}\` · ${n} tentativa(s)${s.statusDetail ? ` · ${corte(s.statusDetail, 300)}` : ''}`);
      if (s.verifyCommand) L.push(`  - conferência da etapa: \`${corte(s.verifyCommand, 400)}\``);
    }
    L.push('', `## Tentativas (as ${Math.min(job.attempts.length, 12)} mais recentes de ${job.attempts.length})`);
    for (const a of job.attempts.slice(0, 12)) {
      const s = job.steps.find((x) => x.id === a.stepId);
      L.push('', `### #${a.number} · ${s?.key ?? '?'} · \`${a.provider}\` · ${a.status} · término ${a.stopReason ?? '?'} · turnos ${a.numTurns ?? '?'} · ${a.startedAt.toISOString()}${a.endedAt ? ` → ${a.endedAt.toISOString()}` : ''} · US$ ${a.costUsd}`);
      if (a.error) L.push(`Erro:${bloco(a.error, 1500)}`);
      if (a.output) L.push(`Fim da resposta da IA:${bloco(a.output, 1200)}`);
      L.push(`Arquivos mudaram nesta sessão: ${a.treeBefore && a.treeAfter ? (a.treeBefore !== a.treeAfter ? 'sim' : 'não') : '?'} · notas registradas: ${a.notesIngested ?? 0}`);
    }
    if (job.criteria.length) {
      L.push('', '## Critérios finais');
      for (const c of job.criteria) {
        const ch = c.checks[0];
        L.push(`- **${c.key}** (${c.kind}) ${c.status}: ${c.description}${ch ? ` · evidência: ${corte(JSON.stringify(ch.evidence), 500)}` : ''}`);
      }
    }
    if (job.approvals.length) L.push('', '## Aprovações pendentes', ...job.approvals.map((x) => `- ${x.kind}: ${x.description}`));
    if (ssh.length) L.push('', '## Comandos SSH pedidos', ...ssh.map((x) => `- ${x.createdAt.toISOString()} ${x.servidorNome}: \`${corte(x.comando, 200)}\` → ${x.status}${x.exitCode !== null ? ` (código ${x.exitCode})` : ''}`));
    L.push('', '## IAs e executores usados', ...(await this.ias([p.provider, job.defaultProvider, ...job.steps.map((s) => s.provider ?? job.defaultProvider), ...(Array.isArray(p.aiReserva) ? (p.aiReserva as string[]) : [])])));
    const mcp = mcpDoProjeto(p.id).map((m) => m.nome);
    L.push('', `## Ferramentas MCP do projeto: ${mcp.length ? mcp.join(', ') : 'nenhuma'}`);
    L.push('', `## Log do trabalho (últimas ${logs.length} linhas, da mais antiga para a mais nova)`, bloco(
      logs.reverse().map((l) => `${l.createdAt.toISOString().slice(11, 19)} ${l.level.padEnd(5)} ${l.source}: ${l.message.replace(/\s+/g, ' ').slice(0, 400)}`).join('\n'),
      30_000,
    ));
    const erros = lerErros(200).filter((e) => (e.mensagem ?? '').includes(jobId)).slice(-10);
    if (erros.length) L.push('', '## Erros do sistema ligados a este trabalho', ...erros.map((e) => `- ${e.em} [${e.origem}] ${e.mensagem}${e.detalhe ? bloco(e.detalhe, 1500) : ''}`));
    return redigir(L.join('\n'));
  }

  /** Diagnóstico do sistema: versão, worker, fila, IAs, trabalhos parados recentes e últimos erros. */
  async doSistema(): Promise<string> {
    const L: string[] = [];
    L.push('# Diagnóstico do sistema Nivoo', '');
    L.push(`- Gerado em: ${new Date().toISOString()} · Nivoo ${this.versao()} · servidor ${os.hostname()} (${os.type()} ${os.release()}) · Node ${process.version} · memória livre ${Math.round(os.freemem() / 1024 / 1024)} MB`);
    const workers = await this.prisma.workerHeartbeat.findMany({ orderBy: { lastSeenAt: 'desc' }, take: 5 });
    L.push('', '## Worker (processa trabalhos e respostas)');
    if (!workers.length) L.push('- NENHUM worker registrado');
    for (const w of workers) {
      const seg = Math.round((Date.now() - w.lastSeenAt.getTime()) / 1000);
      L.push(`- ${w.id} (${w.hostname}, pid ${w.pid}): ${seg < 60 ? 'NO AR' : `sem sinal há ${seg}s`} · iniciado ${w.startedAt.toISOString()}`);
    }
    const fila = await this.prisma.queueTask.groupBy({ by: ['type', 'status'], _count: true });
    L.push('', '## Fila', ...fila.map((f) => `- ${f.type} ${f.status}: ${f._count}`));
    const presas = await this.prisma.queueTask.findMany({ where: { status: { in: ['DEAD', 'RUNNING'] } }, orderBy: { updatedAt: 'desc' }, take: 10 });
    if (presas.length) L.push('', '## Tarefas mortas ou rodando', ...presas.map((t) => `- ${t.type} ${t.status} · trabalho ${t.jobId ?? '-'} · tentativas ${t.claims} · ${t.updatedAt.toISOString()}${t.lastError ? ` · ${corte(t.lastError, 300)}` : ''}`));
    L.push('', '## Conexões de IA', ...(await this.ias(listarConexoes().map((c) => c.id))));
    const parados = await this.prisma.job.findMany({ where: { status: { in: ['BLOQUEADO', 'FALHOU'] } }, orderBy: { updatedAt: 'desc' }, take: 10, include: { project: { select: { name: true } } } });
    L.push('', '## Trabalhos parados recentes', ...(parados.length ? parados.map((j) => `- ${j.updatedAt.toISOString()} · ${j.project.name} · "${j.title}" (\`${j.id}\`) · ${j.status} ${j.blockedReason ?? ''}: ${corte(j.statusDetail, 300)}`) : ['- nenhum']));
    const erros = lerErros(40);
    L.push('', `## Últimos erros do sistema (${erros.length})`, ...(erros.length ? erros.map((e) => `- ${e.em} [${e.origem}] ${e.mensagem}${e.detalhe ? bloco(e.detalhe, 800) : ''}`) : ['- nenhum']));
    return redigir(L.join('\n'));
  }
}
