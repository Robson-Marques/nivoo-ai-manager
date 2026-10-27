/**
 * Política de execução.
 * - Ações destrutivas exigem aprovação explícita (Approval ACAO_DESTRUTIVA).
 * - Operações financeiras reais são proibidas nesta versão (não aprováveis).
 */

export interface PolicyVerdict {
  allowed: boolean;
  requiresApproval: boolean;
  forbidden: boolean;
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

const FINANCIAL: Array<[RegExp, string]> = [
  [/\b(send|place|submit|route)[_\s-]?order\b/i, 'envio de ordem'],
  [/\b(enviar|executar|colocar)\s+ordem\b/i, 'envio de ordem'],
  [/\bordem\s+real\b|\bconta\s+real\b|\breal\s+account\b|\blive\s+trading\b/i, 'operação em conta real'],
  [/\b(order_send|ordersend|mt5\.order_send|OrderSend)\b/, 'API de envio de ordens (MetaTrader)'],
  [/\b(broker|corretora)\s*(api|login|credencial)/i, 'acesso à corretora'],
  [/\b(transfer|withdraw|saque|transfer[eê]ncia|pix)\b.*\b(R\$|BRL|USD|valor)\b/i, 'movimentação financeira'],
];

export function evaluatePolicy(text: string): PolicyVerdict {
  const reasons: string[] = [];
  let forbidden = false;
  let requiresApproval = false;
  for (const [re, why] of FINANCIAL) {
    if (re.test(text)) {
      forbidden = true;
      reasons.push(`PROIBIDO: ${why}`);
    }
  }
  for (const [re, why] of DESTRUCTIVE) {
    if (re.test(text)) {
      requiresApproval = true;
      reasons.push(`DESTRUTIVO: ${why}`);
    }
  }
  return { allowed: !forbidden && !requiresApproval, requiresApproval, forbidden, reasons };
}

/** Regras fixas incluídas em todo prompt enviado a agentes de IA. */
export const AGENT_RULES = [
  'Você está executando dentro de um workspace isolado. Não acesse arquivos fora do diretório atual.',
  'É PROIBIDO executar operações financeiras reais, enviar ordens, acessar corretoras ou contas reais.',
  'Não execute ações destrutivas (remoções recursivas, git push --force, reset --hard, DROP).',
  'Não altere a branch main. Trabalhe apenas na branch atual.',
  'Você NÃO decide se o trabalho está concluído: o backend verifica critérios e evidências.',
  'Grave resultados verificáveis (dados, código, parâmetros, métricas) no diretório indicado em NIVOO_OUTPUT_DIR.',
];
