import * as fs from 'node:fs';
import * as path from 'node:path';
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
      '2. Examine TODAS as mudanças listadas em "Mudanças feitas por este trabalho" e os arquivos alterados. Se existir out/telas/',
      '   (fotos das telas tiradas pela conferência, computador e celular), ABRA as fotos: layout quebrado, texto cortado ou',
      '   sobreposto, botão fora do lugar, tela em branco ou que não cabe no celular é violação (diga qual tela e o que está errado).',
      '   Confira as fotos CONTRA as regras de interface do modelo do projeto, quando houver (em contexto/base/, ex.: no Studio',
      '   Workflow, doctrine/disciplines/visual-interface-quality.md: composição, densidade, cortes, camadas, estados, ícones).',
      '   Evidência de INTERAÇÃO (foco, digitação, Enter, carregando, erro, rede lenta) é a dos roteiros executados pela conferência:',
      '   out/telas-interativas/relatorio.md (nivoo-roteiros/*.json) e out/telas-interativas/scripts.md (scripts nivoo-roteiros/*.cjs|*.mjs).',
      '   Se faltar e o trabalho mexeu em interação, é violação concreta: "falta roteiro de <fluxo> em nivoo-roteiros/". Teste em outra',
      '   pasta não roda na conferência: a violação diz para movê-lo para nivoo-roteiros/. Nunca pergunte ao usuário como rodar testes.',
      '3. Aponte cada violação: regra descumprida, algo fora do escopo, informação inventada, item pedido que faltou,',
      '   sobra deixada para trás (código morto, arquivo esquecido, documentação desatualizada).',
      '4. Corrija você mesmo as violações que puder, sem ampliar o trabalho. Sobra para apagar (código morto, arquivo esquecido):',
      '   liste em .nivoo/remover.txt (um caminho por linha; o sistema apaga ao fim da sessão) e ajuste as referências.',
      `5. Grave ${RULE_REVIEW_REPORT} assim: {"conforme": true|false, "violacoes": ["o que ainda viola e por quê"], "perguntas": [{"pergunta": "...", "opcoes": ["resposta possível 1", "resposta possível 2"]}], "corrigido": ["o que você corrigiu"], "observacoes": "..."}`,
      '   "conforme" só pode ser true se não restar NENHUMA violação. Violação é algo que a IA consegue corrigir no trabalho.',
      '   Uma dúvida que SÓ O USUÁRIO responde (uma decisão dele que não está em nenhuma fonte) NÃO é violação: vai em',
      '   "perguntas" e não impede "conforme": true. ANTES de perguntar, procure a resposta: a conversa do pedido',
      '   (contexto/conversa-do-pedido.md), a memória (.nivoo/memoria.md), out/respostas-do-usuario.md e os entregáveis.',
      '   O que está lá não é pergunta. Cada pergunta vem com 2 a 4 respostas possíveis em "opcoes" (a mais provável primeiro),',
      '   curtas e concretas, para o usuário só escolher.',
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

export interface PerguntaDaRevisao {
  pergunta: string;
  opcoes: string[];
}

export interface RevisaoLida {
  conforme: boolean | null;
  violacoes: string[];
  perguntas: PerguntaDaRevisao[];
  observacoes: string;
  aceitaPor?: string;
}

const lista = (x: unknown): string[] => (Array.isArray(x) ? x.map((y) => (typeof y === 'string' ? y : JSON.stringify(y))).filter(Boolean) : typeof x === 'string' && x.trim() ? [x] : []);

/** Relatório da revisão (out/conferencia-regras.json) + perguntas de out/perguntas-ao-usuario.md; null se não houver. */
/** Texto que diz que NÃO há pergunta (ex.: "Nenhuma pergunta em aberto nesta etapa"), sem nenhuma pergunta de fato. */
export function semPergunta(texto: string): boolean {
  if (texto.includes('?')) return false;
  return /(nenhuma|\bsem\b|não há|nao ha|não existe|nao existe|\bnada\b)[^.\n]{0,40}(pergunta|dúvida|duvida|pendência de decisão)/i.test(texto) || !/\S/.test(texto);
}

export function lerRevisao(worktree: string): RevisaoLida | null {
  let r: any;
  try {
    r = JSON.parse(fs.readFileSync(path.join(worktree, RULE_REVIEW_REPORT), 'utf8'));
  } catch {
    return null;
  }
  const perguntas: PerguntaDaRevisao[] = (Array.isArray(r?.perguntas) ? r.perguntas : typeof r?.perguntas === 'string' ? [r.perguntas] : [])
    .map((p: any) => (typeof p === 'string' ? { pergunta: p, opcoes: [] } : { pergunta: String(p?.pergunta ?? p?.texto ?? JSON.stringify(p)), opcoes: lista(p?.opcoes) }))
    .filter((p: PerguntaDaRevisao) => p.pergunta.trim() && !semPergunta(p.pergunta))
    .map((p: PerguntaDaRevisao) => ({ pergunta: p.pergunta.slice(0, 3000), opcoes: p.opcoes.map((o) => o.slice(0, 500)).slice(0, 6) }));
  try {
    // O arquivo de perguntas da IA só vira pergunta se tiver pergunta de verdade ("Nenhuma pergunta em aberto" não é).
    const md = fs.readFileSync(path.join(worktree, 'out', 'perguntas-ao-usuario.md'), 'utf8').trim();
    const corpo = md.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n').trim();
    if (corpo && !semPergunta(corpo)) perguntas.push({ pergunta: corpo.slice(0, 6000), opcoes: [] });
  } catch {
    /* sem arquivo de perguntas */
  }
  return {
    conforme: typeof r?.conforme === 'boolean' ? r.conforme : null,
    violacoes: lista(r?.violacoes).map((v) => v.slice(0, 1500)).slice(0, 40),
    perguntas: perguntas.slice(0, 40),
    observacoes: String(r?.observacoes ?? '').slice(0, 3000),
    ...(r?.aceitoPeloUsuario?.por ? { aceitaPor: String(r.aceitoPeloUsuario.por) } : {}),
  };
}

/** O usuário aceita o trabalho mesmo com a revisão dizendo "não conforme": fica registrado quem aceitou e o quê. */
export function aceitarRevisao(worktree: string, por: string): void {
  const arq = path.join(worktree, RULE_REVIEW_REPORT);
  let r: any = {};
  try {
    r = JSON.parse(fs.readFileSync(arq, 'utf8'));
  } catch {
    /* sem relatório: registra só a aceitação */
  }
  const novo = {
    ...r,
    conforme: true,
    violacoes: [],
    aceitoPeloUsuario: { por, em: new Date().toISOString(), conformeAntes: r?.conforme ?? null, violacoesAceitas: lista(r?.violacoes), perguntasAbertas: Array.isArray(r?.perguntas) ? r.perguntas : [] },
  };
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, JSON.stringify(novo, null, 2));
}

/**
 * Conferências das etapas de trabalho (testes, build, fotos…), para rodar DE NOVO depois de uma correção ou de uma
 * resposta do usuário: sem isso, a IA mexia no código depois da revisão e nada rodava os testes outra vez (a etapa de
 * correção conferia só "true"). Ignora a revisão, as próprias correções/respostas e conferências vazias.
 */
export function conferenciasDasEtapas(steps: Array<{ key: string; verifyCommand: string | null }>): string[] {
  const vistos = new Set<string>();
  const lista: string[] = [];
  for (const s of steps) {
    if (s.key === RULE_REVIEW_STEP || /^(correcao-criterios|resposta-usuario)-/.test(s.key)) continue;
    const c = (s.verifyCommand ?? '').trim();
    if (!c || c === 'true' || c === ':' || vistos.has(c)) continue;
    vistos.add(c);
    lista.push(`( ${c} )`);
  }
  // Telas: com nivoo-previa.json, liga o sistema, fotografa e roda os roteiros de interação (sem prévia, não faz nada).
  if (!lista.some((c) => c.includes('nivoo-conferir-telas'))) lista.push('( nivoo-conferir-telas --se-houver )');
  return lista;
}
