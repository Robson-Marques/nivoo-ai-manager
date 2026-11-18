/**
 * Política de execução: ações destrutivas exigem aprovação explícita do usuário (Approval ACAO_DESTRUTIVA).
 */

export interface PolicyVerdict {
  allowed: boolean;
  requiresApproval: boolean;
  reasons: string[];
}

const DESTRUCTIVE: Array<[RegExp, string]> = [
  [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive|-r)\b/i, 'remoção recursiva de arquivos (rm -r)'],
  [/\bgit\s+push\b[^\n]*(--force|-f\b|--mirror|--delete)/i, 'git push forçado/remoção remota'],
  [/\bgit\s+reset\s+--hard\b/i, 'git reset --hard'],
  [/\bgit\s+clean\s+-[a-z]*f/i, 'git clean -f'],
  [/\bgit\s+(branch|tag)\s+-D\b/, 'remoção de branch/tag'],
  [/\bgit\s+push\b[^\n]*\b(main|master)\b/i, 'push para main/master'],
  [/\b(drop|truncate)\s+(table|database|schema)\b/i, 'DROP/TRUNCATE em banco de dados'],
  [/\bdelete\s+from\b/i, 'DELETE em banco de dados'],
  [/\bmkfs(\.\w+)?\b|\bdd\s+if=/i, 'formatação/escrita em dispositivo'],
  [/\bchmod\s+-R\s+777\b/i, 'chmod -R 777'],
  [/\bshred\b/i, 'shred'],
];

export function evaluatePolicy(text: string): PolicyVerdict {
  const reasons: string[] = [];
  let requiresApproval = false;
  for (const [re, why] of DESTRUCTIVE) {
    if (re.test(text)) {
      requiresApproval = true;
      reasons.push(`DESTRUTIVO: ${why}`);
    }
  }
  return { allowed: !requiresApproval, requiresApproval, reasons };
}

/** Regras fixas incluídas em todo prompt enviado a agentes de IA. */
export const AGENT_RULES = [
  'Você está executando dentro de um workspace isolado. Não acesse arquivos fora do diretório atual.',
  'Não execute ações destrutivas (remoções recursivas, git push --force, reset --hard, DROP).',
  'Não altere a branch main. Trabalhe apenas na branch atual.',
  'Você NÃO decide se o trabalho está concluído: o backend verifica critérios e evidências.',
  'Relatórios e evidências vão no diretório indicado em NIVOO_OUTPUT_DIR (out/); o trabalho em si vai nos caminhos normais do projeto.',
  'Quando pedir que o usuário execute ou copie um comando, escreva o comando sozinho em um bloco Markdown cercado por ```bash e ```. Nunca esconda comandos entre aspas ou no meio de um parágrafo; um bloco por conjunto que pode ser copiado e colado de uma vez.',
];
