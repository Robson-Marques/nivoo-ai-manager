import type { AttemptStatus } from '@prisma/client';
import type { ExecutionResult } from '../../providers/provider.interface';

/** Result semantics independent of the queue and persistence. */
export function normalizeSessionResult(result:ExecutionResult,isAi:boolean){
    // Sessão de IA que esgotou o tempo = sessão encerrada (não falha): confere, salva o que foi feito e continua
    // numa nova sessão. Antes contava como falha: sem conferência, sem checkpoint, e dois tempos esgotados seguidos
    // bloqueavam o trabalho como "repetição improdutiva".
    if (isAi && !result.interrupted && !result.resourceUnavailable && /^timeout após \d+ ms/.test(result.error ?? '')) {
      result = { ...result, sessionEnded: true, stopReason: result.stopReason ?? 'tempo da sessão esgotado' };
    }
    // O agente terminou a sessão normalmente (ou por limite de turnos)? Guardado antes da verificação.
    const sessionClosedNormally = !result.interrupted && !result.resourceUnavailable && (result.exitCode === 0 || !!result.sessionEnded);

  return {result,sessionClosedNormally};
}
export function classifyExecutionResult(result:ExecutionResult,isAi:boolean,verified:boolean,sessionClosedNormally:boolean): { attemptStatus: AttemptStatus; result: ExecutionResult } {
    // Classificação: interrupção, limite do provedor, sucesso verificado, fim de sessão sem concluir, falha.
    const attemptStatus: AttemptStatus = result.interrupted
      ? 'INTERROMPIDA'
      : result.resourceUnavailable
        ? 'RECURSO_INDISPONIVEL'
        : result.exitCode === 0 && verified
          ? 'SUCESSO'
          : isAi && sessionClosedNormally && result.sessionEnded
            ? 'SESSAO_ENCERRADA'
            : 'FALHA';
    if (attemptStatus === 'SESSAO_ENCERRADA' && !result.error) {
      result = { ...result, error: `sessão encerrada (${result.stopReason ?? 'sem motivo'}) sem concluir a etapa` };
    }

  return {attemptStatus,result};
}
