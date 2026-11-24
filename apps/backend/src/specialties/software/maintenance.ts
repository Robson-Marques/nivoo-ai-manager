import type { Skill } from '../skills';

export const MAINTENANCE_SKILL:Skill={
  id:'software-manutencao',domain:'software',description:'Depuração, desempenho, observabilidade e manutenção',
  source:'https://github.com/NVIDIA/skills/tree/71e61c7209cb4ca64cba247a7d20a5438b30aef5/skills/nemo-relay-plugin-observability',
  action:'Rastreie o erro causal e meça o gargalo real; preserve contratos e recupere trabalho sem repetir abordagens improdutivas.',
  body:[
    "Leia a solicitação atual, implementação real, consumidores, erro original e evidências disponíveis. Identifique a camada responsável e o primeiro erro causal; se houver tentativa anterior, leia seu checkpoint e última conferência, sem reprocessar todo o histórico. Não trate mensagem de erro ou relatório como prova de causa.",
    "Reproduza o defeito com a entrada e o estado pertinentes quando o ambiente autorizado permitir. Trace o fluxo até o resultado e encontre a divergência; diferencie falha de código, configuração, dependência, recurso, autorização e efeito remoto incerto. Se faltar evidência, declare a hipótese e a limitação sem inventar diagnóstico.",
    "Use a observabilidade existente. Correlacione requisição, job, etapa, tentativa ou operação conforme a arquitetura, com dados mínimos, sanitizados e duração relevante. Não acrescente logs duplicados, segredos, dados pessoais, payloads integrais ou nova plataforma de monitoramento só para diagnosticar.",
    "Estabeleça baseline e carga representativa antes de otimizar. Meça latência, throughput, CPU, memória, I/O, consultas, filas ou tokens conforme o gargalo; compare antes e depois sob condições equivalentes. Não invente porcentagens, nem afirme economia baseada apenas em reduzir caracteres. Preserve comportamento, precisão, segurança e limites.",
    "Verifique consultas repetidas, alocações, ciclo de vida de recursos, contenda, ordenação e cancelamento quando pertinentes. Cache precisa de escopo, chave, invalidação e consistência. Não adicione tentativas, cache, paralelismo, filas ou verificações para mascarar defeitos. Não aumente timeouts ou recursos sem causa e justificativa.",
    "Em falha anterior, preserve saídas válidas e diferencie falha transitória, permanente e resultado incerto. Não repita o mesmo comando ou efeito sem mudança relevante ou evidência de transitoriedade; use a recuperação e os checkpoints existentes, sem alterar seus limites ou contornar aprovações. Não troque provedor para ocultar defeito local.",
    "Refatore a responsabilidade correta preservando interfaces, consumidores, dados e comportamento não solicitado. Use regressões focadas e as verificações reais existentes, sem duplicar build ou testes equivalentes. Distingua código inspecionado, cenário reproduzido e resultado comprovado.",
    "Trabalhe na mesma sessão produtiva. Não crie relatório obrigatório, agente, revisor, CI, serviço, fila, dependência, instrumentação paralela ou ciclo adicional de conferência por causa desta Skill. A orientação não substitui medição real nem muda a política de recuperação.",
  ].join('\n'),
};

type Focus="diagnostico"|"observabilidade"|"desempenho"|"concorrencia"|"recursos"|"recuperacao"|"manutencao";
type Facet={id:Focus;match:RegExp;rule:string};
const FACETS:readonly Facet[]=[
  {id:"diagnostico",match:/\b(?:debug\w*|depur\w*|diagnostic\w*|bug|stack trace|stacktrace|causa raiz|root cause|reproduzir|reprodut\w*|exception|excec\w*|erro|falh\w*)\b/,rule:"Diagnóstico: reproduza o cenário quando possível, localize o primeiro erro causal e rastreie entrada, estado, dependência e efeito. Diferencie hipótese de evidência; corrija o componente responsável, não apenas a mensagem."},
  {id:"observabilidade",match:/\b(?:observabilidade|observability|telemetria|telemetry|logs?|logging|traces?|tracing|correlac\w*|correlation|metricas?|metrics|monitoramento|monitoring)\b/,rule:"Observabilidade: reutilize logs, métricas e identificadores de correlação existentes; registre evento, contexto mínimo sanitizado, duração e resultado quando úteis. Não duplique instrumentação nem exponha tokens, payloads sensíveis ou dados pessoais."},
  {id:"desempenho",match:/\b(?:desempenho|performance|latencia|latency|gargalos?|otimiz\w*|profil\w*|benchmark\w*|throughput|p95|p99|lentidao|slow|n\+1|cpu|memoria|memory leak|vazamento de memoria|heap|event loop|gc|garbage collection)\b/,rule:"Desempenho: estabeleça baseline e carga representativa; meça latência, throughput ou recursos pertinentes antes/depois, nas mesmas condições. Inspecione gargalo real (CPU, I/O, consultas, memória ou espera); não invente ganhos nem sacrifique correção."},
  {id:"concorrencia",match:/\b(?:concorrenc\w*|concurrenc\w*|race condition|deadlocks?|locks?|contention|contencao|backpressure|fila|queues?|pool|event loop|paralel\w*)\b/,rule:"Concorrência: rastreie propriedade do estado, ordenação, contenda e limites. Preserve atomicidade, cancelamento, idempotência e pressão de retorno quando aplicáveis. Não aumente paralelismo, filas ou timeouts para esconder a causa."},
  {id:"recursos",match:/\b(?:cache|caching|invalidac\w*|memory leak|vazamento de memoria|heap|disco|disk|i\/o|file descriptors?|conexoes?|connection pool|n\+1|consumo de tokens|token usage|consumo de memoria|consumo de cpu)\b/,rule:"Recursos: meça consumo e ciclo de vida; confirme liberação, tamanho e limites. Cache exige chave, escopo, invalidação e consistência. Não introduza cache ou aumente recursos como substituto de correção; contabilize tokens reais apenas quando informados."},
  {id:"recuperacao",match:/\b(?:repetic\w*|repetir|retry|retries|recovery|recuperac\w*|retom\w*|tentativas?|timeouts?|loop|bloque\w*|checkpoint|fallback|reserva|resultado incerto)\b/,rule:"Recuperação: leia tentativa anterior, checkpoint e conferência existentes. Classifique falha transitória, permanente ou efeito incerto; não repita ação sem corrigir a causa ou obter evidência de condição transitória. Preserve arquivos válidos e não duplique efeitos nem troque provedor para mascarar defeito."},
  {id:"manutencao",match:/\b(?:refator\w*|refactor\w*|manutencao|maintenance|legado|legacy|compatibil\w*|debitos? tecnicos?|technical debt)\b/,rule:"Manutenção: preserve contratos, consumidores, dados e comportamento não solicitado. Faça mudança coesa na responsabilidade correta, com regressão proporcional; não reescreva serviços ou adicione camadas só para contornar falha."},
];
const normalize=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/_/g,' ');
const INTENT:readonly RegExp[]=[
  /\b(?:refator\w*|refactor\w*|manutencao|maintenance|desempenho|performance|observabilidade|observability|telemetria|telemetry|profil\w*|logs?|logging|latencia|latency|gargalos?|otimiz\w*|debug\w*|depur\w*|diagnostic\w*|bug|stack trace|stacktrace|causa raiz|root cause|benchmark\w*|throughput|p95|p99|lentidao|deadlocks?|race condition|memory leak|vazamento de memoria|backpressure|n\+1)\b/,
  /\b[\w./-]+\.(?:logger|logging|metrics|telemetry|profiler|diagnostic)\.[cm]?[jt]sx?\b/,
  /\b(?:corrigir|investigar|diagnosticar|reduzir|medir|evitar|otimizar)\b.{0,90}\b(?:consumo de tokens|consumo de memoria|consumo de cpu|repeticao de falhas|loop de tentativas|cache|contencao|timeout|uso de cpu|uso de memoria|vazamento de recursos)\b/,
];

/** Route engineering intent, not an inferred cause or a performance measurement. */
export function maintenanceIntent(text:string):boolean{
  const t=normalize(text);
  return INTENT.some(r=>r.test(t));
}
export function maintenanceFocus(text:string):Focus[]{
  const t=normalize(text);
  return FACETS.filter(f=>f.match.test(t)).map(f=>f.id);
}
export function maintenanceEngineeringContext(phase:'planner'|'execution',text:string,previousError=false):string[]{
  const ids=new Set(maintenanceFocus(text));
  if(phase==='execution'&&previousError){ids.add('diagnostico');ids.add('recuperacao');}
  return [
    '## Engenharia de manutenção — causa, desempenho e evidência',
    phase==='planner'
      ? "No plano, identifique sintoma, cenário, evidência disponível, componente responsável e critério observável. Se for otimização, defina baseline, carga e métrica comparável; escolha as verificações existentes, sem acrescentar uma sessão de diagnóstico independente."
      : "Na etapa atual, leia a implementação e o erro causal disponível, reproduza quando possível, corrija a origem comprovada e preserve interfaces e saídas válidas. Meça apenas o que o ambiente permite; use a conferência técnica existente.",
    ...(phase==='execution'&&previousError?["Existe falha em tentativa anterior desta etapa de código: consulte a última conferência e o checkpoint antes de editar; não repita a abordagem sem mudança pertinente nem reabra etapas concluídas. A existência da falha não comprova sua causa."]:[]),
    ...FACETS.filter(f=>ids.has(f.id)).map(f=>'- '+f.rule),
    "Diferencie hipótese, medição e resultado verificado. Não declare ganhos sem comparação real. Não crie nova sessão, revisão, infraestrutura ou política de recuperação por causa desta orientação.",
  ];
}
