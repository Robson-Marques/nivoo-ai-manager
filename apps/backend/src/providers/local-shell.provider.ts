import { Injectable } from '@nestjs/common';
import { minimalEnv, PASTA_FERRAMENTAS, runProcess } from '../common/exec';
import { erroDeComandoLocal } from '../jobs/executor-priority';
import { AiProvider, ExecutionRequest, ExecutionResult, ProviderStatus } from './provider.interface';

/**
 * Executor determinístico de comandos (bash) no workspace do job.
 * NÃO é um modelo de IA: roda comandos e validações (etapas determinísticas).
 */
@Injectable()
export class LocalShellProvider implements AiProvider {
  readonly id = 'local-shell';
  readonly label = 'Executor local (bash) — não-IA';
  readonly kind = 'executor' as const;

  async checkAvailability(): Promise<ProviderStatus> {
    const r = await runProcess('bash', ['--version'], { cwd: process.cwd(), env: minimalEnv(), timeoutMs: 5000 });
    const ok = r.exitCode === 0;
    return {
      id: this.id,
      label: this.label,
      kind: this.kind,
      available: ok,
      installed: ok,
      authenticated: true,
      version: ok ? r.stdout.split('\n')[0] : undefined,
      limits: { observacao: 'limitado por stepTimeoutSec e orçamento de tempo do job' },
      capabilities: ['executar-comandos', 'validacao'],
      errors: ok ? [] : [r.spawnError ?? r.stderr],
      checkedAt: new Date().toISOString(),
      isAi: false,
    };
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    const invalido = erroDeComandoLocal(req.instructions);
    if (invalido) {
      req.onLog(invalido, 'ERROR');
      return { exitCode: 2, output: '', error: invalido };
    }
    const r = await runProcess('bash', ['-e', '-o', 'pipefail', '-c', req.instructions], {
      cwd: req.cwd,
      env: minimalEnv({
        NIVOO_JOB_ID: req.jobId,
        NIVOO_STEP_ID: req.stepId,
        NIVOO_ATTEMPT_ID: req.attemptId,
        NIVOO_OUTPUT_DIR: req.outputDir,
        // Ferramentas do Nivoo (nivoo-analisar-video, nivoo-fotos…) no PATH e a pasta de mídia do projeto.
        PATH: `${PASTA_FERRAMENTAS}:${process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin'}`,
        ...(req.projectMediaDir ? { NIVOO_MIDIA_DIR: req.projectMediaDir } : {}),
      }),
      timeoutMs: req.timeoutMs,
      signal: req.signal,
      onSpawn: req.onSpawn,
      onStdout: (c) => c.split('\n').filter(Boolean).forEach((l) => req.onLog(l)),
      onStderr: (c) => c.split('\n').filter(Boolean).forEach((l) => req.onLog(l, 'WARN')),
    });
    const output = r.stdout + (r.stderr ? `\n[stderr]\n${r.stderr}` : '');
    if (r.aborted) return { exitCode: -1, output, interrupted: true, error: 'interrompido' };
    if (r.timedOut) return { exitCode: -1, output, error: `timeout após ${req.timeoutMs} ms` };
    if (r.spawnError) return { exitCode: -1, output, error: r.spawnError, resourceUnavailable: true };
    const mensagem = r.exitCode === 0 ? undefined : 
      `Comando local falhou (exit ${r.exitCode ?? -1}): ${(r.stderr || r.stdout || '').trim().slice(-1800) || req.instructions.slice(0, 200)}`;
    return { exitCode: r.exitCode ?? -1, output, error: mensagem };
  }
}
