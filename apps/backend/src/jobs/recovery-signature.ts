import { sha256 } from '../common/hash';

/** Cada erro tem identidade própria: problemas diferentes não esgotam a mesma cota. */
export interface FalhaParaRecuperacao {
  key: string;
  kind: string;
  evidence: Record<string, unknown>;
}
export interface AssinaturaFalha {
  hash: string;
  descricao: string;
}
export const MARCADOR_RECUPERACAO = 'NIVOO_RECOVERY_SIGNATURES_V1:';
export const MAX_OCORRENCIAS_MESMA_FALHA = 3;

function normalizar(texto: string): string {
  return texto
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\/worktrees\/[0-9a-f-]{36}/gi, '/worktrees/<job>')
    // FFmpeg/Remotion usam diretórios temporários com nomes aleatórios.
    // A mesma falha não pode virar "erro novo" só porque o tmp mudou.
    .replace(/\/tmp\/nivoo-[a-z0-9._-]+/gi, '/tmp/nivoo-<temporario>')
    .replace(/\b(?:tentativa|attempt)\s*#?\s*\d+\b/gi, 'tentativa <n>')
    .replace(/\b(?:pid|processo)\s*[:=#-]?\s*\d+\b/gi, 'processo <pid>')
    .replace(/\b\d{2}\/\d{2}\/\d{4},?\s*\d{2}:\d{2}:\d{2}\b/g, '<horario>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function sinalDoComando(evidence: Record<string, unknown>): string {
  const saida = [evidence.stdout, evidence.stderr]
    .filter((v): v is string => typeof v === 'string').join('\n');
  const linhas = saida.replace(/\u001b\[[0-9;]*m/g, '')
    .split(/\r?\n/).map(normalizar)
    .filter((linha) => linha && !/\[versionhelper\]|git (?:describe|tag --list) falhou/.test(linha));
  const diagnostico = linhas.filter((linha) =>
    /\b(?:fail(?:ed|ure)?|error|assertionerror|expected|received|not ok|exception|cannot|reprovad[oa]|falhou|falha:)\b|[✗❌]/i.test(linha),
  );
  // Identidade inclui o comando e seu erro, não apenas o mesmo exitCode.
  const motivo = diagnostico.length
    ? [...new Set(diagnostico)].slice(-10).join('\n')
    : linhas.slice(-8).join('\n');
  return [
    normalizar(String(evidence.comando ?? '')),
    'exit=' + String(evidence.exitCode ?? '?'),
    'timeout=' + String(Boolean(evidence.timeout)),
    normalizar(String(evidence.erro ?? evidence.spawnError ?? '')),
    motivo.slice(-1800),
  ].join('|');
}

export function assinaturasDasFalhas(falhas: FalhaParaRecuperacao[], violacoes: string[] = []): AssinaturaFalha[] {
  const resultado: AssinaturaFalha[] = [];
  for (const falha of falhas) {
    if (falha.key === 'conferencia-regras' && violacoes.length > 0) {
      for (const violacao of violacoes) {
        const descricao = normalizar(violacao);
        if (descricao) resultado.push({
          hash: sha256([falha.key, 'violacao', descricao].join('|')),
          descricao: violacao.slice(0, 240),
        });
      }
      continue;
    }
    const evidencia = falha.evidence ?? {};
    const sinal = falha.kind === 'COMMAND'
      ? sinalDoComando(evidencia)
      : normalizar(JSON.stringify(evidencia));
    resultado.push({
      hash: sha256([falha.key, falha.kind, sinal].join('|')),
      descricao: falha.kind === 'COMMAND'
        ? [falha.key, sinal.slice(-220)].join(': ')
        : [falha.key, sinal.slice(0, 220)].join(': '),
    });
  }
  return [...new Map(resultado.map((falha) => [falha.hash, falha])).values()];
}

/** Marcadores criados pelo motor, sem confundir o nome do critério com a causa. */
export function historicoDeFalhas(steps: Array<{ key: string; instructions: string }>): Map<string, number> {
  const contagem = new Map<string, number>();
  for (const step of steps) {
    if (!/^correcao-criterios-\d+$/.test(step.key)) continue;
    const marker = step.instructions.match(/^NIVOO_RECOVERY_SIGNATURES_V1:([a-f0-9,]+)$/m);
    if (!marker) continue; // correções antigas sem assinatura não são presumidas iguais
    for (const hash of new Set(marker[1].split(',').filter((v) => /^[a-f0-9]{64}$/.test(v)))) {
      contagem.set(hash, (contagem.get(hash) ?? 0) + 1);
    }
  }
  return contagem;
}

/** Na terceira detecção do MESMO defeito, não abrir outra sessão para ele. */
export function recorrenciasDasFalhas(
  steps: Array<{ key: string; instructions: string }>,
  falhas: AssinaturaFalha[],
): Array<AssinaturaFalha & { ocorrencias: number }> {
  const historico = historicoDeFalhas(steps);
  return falhas.map((falha) => ({
    ...falha,
    ocorrencias: (historico.get(falha.hash) ?? 0) + 1,
  }));
}

/** Para verificações de uma mesma etapa: erros distintos podem ser corrigidos
 * sequencialmente; a terceira ocorrência do mesmo erro interrompe o ciclo. */
export function assinaturaErroDaEtapa(erro: string, comando = ''): string {
  return assinaturasDasFalhas([{
    key: 'falha-da-etapa',
    kind: 'COMMAND',
    evidence: { comando, exitCode: 1, timeout: false, stdout: erro.slice(0, 5000) },
  }])[0].hash;
}

export function repeticoesDoMesmoErro(
  errosAnteriores: Array<string | null>,
  erroAtual: string,
  comando = '',
): number {
  const assinatura = assinaturaErroDaEtapa(erroAtual, comando);
  return errosAnteriores.filter((erro) =>
    typeof erro === 'string' && erro.trim() && assinaturaErroDaEtapa(erro, comando) === assinatura,
  ).length;
}
