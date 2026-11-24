import type { Skill } from '../skills';

export const INTEGRATION_SKILL:Skill={
  id:'software-integracoes',domain:'software',description:'Integrações entre sistemas, contratos, eventos e recuperação',
  source:'https://github.com/NVIDIA/skills/tree/71e61c7209cb4ca64cba247a7d20a5438b30aef5/skills/nemo-relay-instrument-typed-wrappers',
  action:'Leia os contratos reais dos dois lados e o adaptador existente. Preserve tipos, autenticação, efeitos e compatibilidade sem duplicar operações.',
  body:[
    'Identifique origem, destino, versão da API/SDK, adaptador responsável e consumidores internos. Leia documentação oficial disponível, contratos, configuração e testes reais. Não invente endpoints, escopos, parâmetros ou respostas; informe lacunas essenciais.',
    'Separe transporte, conversão de dados e regra de negócio conforme a arquitetura existente. Valide dados na fronteira externa; traduza formatos em adaptadores tipados quando o domínio tiver contrato estável. Preserve campos, precisão, unidades, nulos e semântica exigidos pelos consumidores. Não descarte extensões necessárias à compatibilidade.',
    'Preserve autenticação e escopos existentes. Trate expiração, renovação concorrente, revogação e autorização conforme o protocolo. Não exponha tokens, assinaturas, cookies ou credenciais em logs, URLs, fixtures ou contexto. Não amplie permissões para passar testes.',
    'Em webhooks e eventos, valide origem, assinatura sobre os bytes exigidos pelo protocolo, esquema, identidade e proteção contra repetição quando suportada. Confirme recebimento e processamento conforme o contrato real. Use persistência, deduplicação e reentrega existentes; não presuma ordem ou entrega exatamente uma vez.',
    'Em timeout ou interrupção após envio, o efeito remoto pode ter ocorrido. Diferencie falha definitiva, transitória e resultado incerto. Use chave de idempotência ou consulta de reconciliação realmente suportada. Não repita cobrança, envio, criação ou alteração não idempotente às cegas. Respeite Retry-After, limites e política existente. HTTP 2xx não garante sucesso de negócio; valide a resposta e o estado do recurso.',
    'Em sincronização e paginação, preserve cursor, escopo, filtros, ordenação e checkpoint. Não avance cursor antes da persistência exigida. Trate páginas vazias, repetidas, resultados parciais e registros alterados durante a sincronização sem inventar garantias.',
    'Para compatibilidade, leia produtores e consumidores, versionamento, formatos e casos de erro. Em streaming preserve fragmentos, identidade, cancelamento e sinal de término. Registre começo, conclusão ou falha com correlação e metadados sanitizados usando a observabilidade existente.',
    'Ajuste testes de contrato com fixtures sintéticas representativas e testes de integração no ambiente autorizado quando disponível. Exercite sucesso, resposta inválida, autenticação recusada, repetição e falha após envio quando pertinentes. Distinga mock, teste de contrato e operação real. Não produza efeitos externos reais apenas para testar sem autorização específica.',
    'Use a mesma sessão produtiva e a conferência técnica existente. Não instale NeMo Relay, nem acrescente middleware, fila, API, revisor ou infraestrutura por causa desta Skill. Preserve os contratos não solicitados.',
  ].join('\n'),
};

type Focus='contratos'|'autenticacao'|'eventos'|'recuperacao'|'sincronizacao'|'streaming';
type Facet={id:Focus;match:RegExp;rule:string};
const FACETS:readonly Facet[]=[
  {id:'contratos',match:/\b(?:apis?|endpoints?|contratos?|schemas?|payloads?|dtos?|codecs?|serializ\w*|adaptadores?|adapters?|sdks?|vers(?:ao|oes)|rest|graphql|grpc|compatibil\w*)\b/,rule:'Contratos: leia origem, destino, versão, adaptador e consumidores; valide campos nas fronteiras e preserve dados e erros necessários. Não invente formato ou endpoint.'},
  {id:'autenticacao',match:/\b(?:oauth\w*|tokens?|credenciais?|autenticac\w*|autorizac\w*|api key|apikey|refresh|escopos?|scopes?|jwt|assinaturas?|hmac|certificados?)\b/,rule:'Autenticação: siga o protocolo e os escopos autorizados; trate expiração, revogação e renovação concorrente. Não exponha credenciais, assinaturas ou cookies.'},
  {id:'eventos',match:/\b(?:webhooks?|eventos?|events?|callbacks?|notificac\w*|reentrega|outbox|inbox|assinaturas?|hmac)\b/,rule:'Eventos/webhooks: valide origem, assinatura e identidade conforme o protocolo; preserve deduplicação, persistência e confirmação. Não presuma ordem, entrega única ou sucesso de processamento.'},
  {id:'recuperacao',match:/\b(?:idempotenc\w*|duplic\w*|retry|retries|retry-after|timeouts?|falh\w*|erros?|repetic\w*|tentativas?|reconciliac\w*|rate limit|429|503|cobrancas?|pagamentos?)\b/,rule:'Recuperação: classifique falha e resultado incerto; confirme o efeito remoto antes de repetir operação não idempotente. Use limites, Retry-After e reconciliação realmente suportados.'},
  {id:'sincronizacao',match:/\b(?:sincroniz\w*|paginac\w*|cursores?|cursor|checkpoints?|polling|importac\w*|exportac\w*|incremental)\b/,rule:'Sincronização: siga cursor, filtros, ordenação, persistência e checkpoint reais. Trate resultados parciais e não avance antes da confirmação exigida.'},
  {id:'streaming',match:/\b(?:streaming|streams?|sse|websockets?|fragmentos?|chunks?|cancel\w*|correlac\w*|trace id)\b/,rule:'Streaming: preserve identidade, fragmentos, término e cancelamento. Use correlação e logs sanitizados existentes, sem modificar o resultado do consumidor.'},
];
const normalize=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/_/g,' ');

/** Detect integration work, not the existence of a provider or its capability. */
export function integrationIntent(text:string):boolean{
  const t=normalize(text);
  return /\b(?:integrac\w*|webhooks?|oauth\w*|api externa|apis externas|api rest|graphql|grpc|idempotenc\w*|contratos? de api|sdks?|websockets?|sse|adaptadores? de api|provider codec|sincronizacao entre sistemas)\b/.test(t)
    || /\b[\w./-]+\.(?:provider|adapter|webhook|client|codec|integration)\.[cm]?[jt]sx?\b/.test(t)
    || /\b(?:integrar|conectar|sincronizar|consumir)\b.{0,100}\b(?:api|gateway|provedor|sistema|servico externo|marketplace)\b/.test(t);
}
export function integrationFocus(text:string):Focus[]{
  const t=normalize(text);
  return FACETS.filter(f=>f.match.test(t)).map(f=>f.id);
}
export function integrationEngineeringContext(phase:'planner'|'execution',text:string):string[]{
  const ids=new Set(integrationFocus(text));
  return [
    '## Engenharia de integrações — contratos e efeitos reais',
    phase==='planner'
      ? 'No plano, identifique sistemas, versões, contratos reais, adaptador responsável, efeito esperado e falhas relevantes. Escolha testes de contrato e integração existentes; não invente capacidades ou credenciais nem autorize efeitos externos por inferência.'
      : 'Na etapa atual, leia produtor, adaptador, consumidor, documentação e testes pertinentes. Implemente conversão e validação na fronteira responsável; preserve campos, efeitos e contratos. Confirme o resultado real, não apenas o status HTTP.',
    ...FACETS.filter(f=>ids.has(f.id)).map(f=>'- '+f.rule),
    'Use fixtures sintéticas e ambientes de teste autorizados. Diferencie mock, teste de contrato e integração real; se faltar acesso externo necessário, declare o limite. Não acrescente provedor, serviço, sessão ou revisão automática por causa desta orientação.',
  ];
}
