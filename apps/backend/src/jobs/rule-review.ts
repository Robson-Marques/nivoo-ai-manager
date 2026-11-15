/**
 * Conferência das regras ("a trava"): todo trabalho feito por IA termina com uma sessão SEPARADA, sem a
 * memória da sessão que fez o trabalho, que compara as mudanças com o perfil do projeto (regras da base,
 * regras do projeto, conhecimento, memória) e com o objetivo. Ela pode corrigir violações; o trabalho só é
 * dado como pronto quando o relatório diz "conforme" — verificado pelo backend, não pela IA.
 */
export const RULE_REVIEW_STEP = 'conferencia-regras';
export const RULE_REVIEW_REPORT = 'out/conferencia-regras.json';

const CHECK = `python3 -c "import json,sys; d=json.load(open('${RULE_REVIEW_REPORT}')); sys.exit(0 if d.get('conforme') is True and not d.get('violacoes') else 1)"`;

/**
 * Conferência da ETAPA de revisão: o relatório existe e diz conforme true ou false. Revisar é o papel dela; se ela
 * aponta violações, quem corrige é a IA do projeto (etapa de correção criada pelo critério final), não outra rodada
 * da revisora — antes, "não conforme" fazia a revisora repetir sessão após sessão até parar o trabalho.
 */
export const RULE_REVIEW_STEP_CHECK = `python3 -c "import json,sys; d=json.load(open('${RULE_REVIEW_REPORT}')); sys.exit(0 if isinstance(d.get('conforme'), bool) else 1)"`;

export function ruleReviewStep(dependsOn: string[], provider: string) {
  return {
    key: RULE_REVIEW_STEP,
    title: 'Conferência das regras do projeto',
    provider,
    dependsOn,
    instructions: [
      'Você é um REVISOR independente. Você não fez este trabalho; confira-o com rigor.',
      '1. Leia o perfil do projeto (regras da base, regras do projeto, materiais em contexto/), a memória e o objetivo.',
      '2. Examine TODAS as mudanças listadas em "Mudanças feitas por este trabalho" e os arquivos alterados.',
      '3. Aponte cada violação: regra descumprida, algo fora do escopo, informação inventada, item pedido que faltou,',
      '   sobra deixada para trás (código morto, arquivo esquecido, documentação desatualizada).',
      '4. Corrija você mesmo as violações que puder, sem ampliar o trabalho.',
      `5. Grave ${RULE_REVIEW_REPORT} assim: {"conforme": true|false, "violacoes": ["o que ainda viola e por quê"], "corrigido": ["o que você corrigiu"], "observacoes": "..."}`,
      '   "conforme" só pode ser true se não restar NENHUMA violação. Na dúvida, false e explique.',
    ].join('\n'),
    verifyCommand: RULE_REVIEW_STEP_CHECK,
  };
}

export const RULE_REVIEW_CRITERION = {
  key: RULE_REVIEW_STEP,
  description: 'Conferência independente: o resultado segue as regras da base e do projeto',
  kind: 'COMMAND' as const,
  config: { command: CHECK },
};
