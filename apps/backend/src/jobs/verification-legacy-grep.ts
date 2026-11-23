/**
 * Compatibilidade para planos antigos que usavam grep -q com alternativas
 * de nomes de recurso (ex.: digest\|imageId\|sha256). São marcadores
 * semânticos; diferença entre "digest" e "Digest" não representa ausência.
 *
 * Restrição deliberada: apenas "test -f ARQUIVO && grep -q 'ident1\|ident2' ARQUIVO".
 * Nunca altera uma conferência com testes/builds/comandos adicionais.
 * Só pode ser usada APÓS a conferência original falhar e precisa executar
 * a conferência ajustada de verdade (não presume aprovação).
 */
export function conferenciaGrepAlternativasLegada(comando: string): string | null {
  const formaSimples = /^\s*test\s+-f\s+['"]?[A-Za-z0-9._/-]+['"]?\s*&&\s*grep\s+-q\s+['"][A-Za-z0-9_\\|]+['"]\s+['"]?[A-Za-z0-9._/-]+['"]?\s*$/;
  if (!formaSimples.test(comando)) return null;
  const alternativas = /\bgrep\s+-q\s+(['"])([A-Za-z_][A-Za-z0-9_]*(?:\\\|[A-Za-z_][A-Za-z0-9_]*)+)\1(?=\s)/;
  if (!alternativas.test(comando)) return null;
  return comando.replace(alternativas, full => full.replace('grep -q', 'grep -qi'));
}
