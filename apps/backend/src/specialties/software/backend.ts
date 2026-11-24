import type { Skill } from '../skills';

export const BACKEND_SKILL:Skill={
  id:'software-backend',domain:'software',description:'Serviços, APIs, regras de negócio e processamento assíncrono',
  source:'https://github.com/NVIDIA/skills/tree/71e61c7209cb4ca64cba247a7d20a5438b30aef5/skills/fastgen-develop',
  action:'Trace a operação da entrada à saída e seus erros; implemente a regra na camada responsável, preservando contratos e efeitos reais.',
  body:[
    'Leia primeiro o componente responsável e seus consumidores, o modelo de dados, os contratos e testes pertinentes. Use a arquitetura e linguagem reais, sem impor NestJS, ORM, microserviços ou outra tecnologia.',
    'Na entrada, valide tipos, formatos, limites, dados obrigatórios e contexto de autorização. No serviço, aplique invariantes, decisões de negócio e transições explícitas. Na persistência, preserve integridade e atomicidade onde necessário. Na saída, mantenha o contrato público, inclusive respostas de erro. Não replique a regra em controllers, workers e clientes.',
    'Não confunda função chamada com resultado obtido: dados consultados devem participar da decisão quando exigido pelo negócio. Não encerre a operação antes de confirmar o efeito contratado. Preserve distinção entre ausente, vazio, indisponível, falha parcial e sucesso.',
    'Em operações assíncronas, identifique dono, dependências, estado persistido, confirmação, limites de concorrência e recuperação. Trate reentrega, duplicidade, cancelamento, perda de lease e falha entre efeito e confirmação conforme o mecanismo existente; não prometa exactly-once sem garantia real.',
    'Classifique falha transitória e permanente. Repita somente operações seguras e somente quando houver política explícita. Não engula exceções, simule sucesso, troque provedor para esconder defeito nem adicione loop de recuperação sem causa. Preserve contexto causal e não exponha segredos.',
    'Use transações e concorrência compatíveis com a persistência existente, sem manter transação aberta durante chamadas externas demoradas. Não crie infraestrutura nova quando um mecanismo existente atende. Preserve contratos de consumidores e efeitos de retomada.',
    'Durante a mesma sessão produtiva, implemente casos normal, inválido, falha relevante e repetição quando aplicável. Atualize testes reais do projeto; a conferência técnica já prevista executa os comandos. Não substitua comportamento por relatório, grep ou existência de arquivo, nem acrescente revisão de IA.',
  ].join('\n'),
};

type Focus='entrada'|'negocio'|'assincrono'|'estados'|'concorrencia'|'falhas';
type Facet={id:Focus;match:RegExp;rule:string};
const FACETS:readonly Facet[]=[
  {id:'entrada',match:/\b(?:apis?|endpoints?|controllers?|routes?|rotas?|handlers?|dto|http|rest|graphql|grpc|validac\w*|serializ\w*)\b/,rule:'Entrada/saída: leia o handler, DTO/schema e serviço efetivos; preserve status, campos e compatibilidade, inclusive rejeição de entrada inválida. Não introduza uma nova rota paralela.'},
  {id:'negocio',match:/\b(?:regras? de negocio|servicos? de negocio|calcular|calculo|comiss\w*|pagamentos?|faturamento|descontos?|diagnostico do cliente|decisao|decidir|use cases?|casos? de uso)\b/,rule:'Regra de negócio: explicite a condição, os dados que influenciam a decisão, a ação e o resultado. Implemente a decisão no dono da regra; não consulte dados apenas para exibir informação.'},
  {id:'assincrono',match:/\b(?:workers?|filas?|queues?|jobs?|consumidores?|consumers?|eventos?|events?|agend\w*|scheduler|cron|outbox|dead letter|dlq)\b/,rule:'Assíncrono: siga produtor, consumidor, persistência e confirmação; preserve idempotência, reentrega, ordenação quando exigida e encerramento. Não crie segunda fila nem confirme antes do efeito.'},
  {id:'estados',match:/\b(?:estados?|status|transic\w*|state machine|maquina de estados|cancel\w*|retom\w*|paus\w*|checkpoints?|leases?)\b/,rule:'Estados: confira transições permitidas, dono da mudança, pré-condições e persistência. Diferencie solicitado, executando, concluído e falhou; preserve retomada e impeça transições concorrentes inválidas.'},
  {id:'concorrencia',match:/\b(?:concorrencia|concurrency|race condition|corrida|locks?|deadlocks?|atomic\w*|transacoes?|idempotenc\w*|duplic\w*|paralel\w*|leases?)\b/,rule:'Concorrência: identifique o recurso compartilhado, a janela de corrida e a garantia real de atomicidade. Use o mecanismo existente; trate repetição e falha entre efeito e confirmação sem perder dados.'},
  {id:'falhas',match:/\b(?:erros?|falh\w*|excec\w*|exceptions?|timeouts?|retry|retries|tentativas?|repetic\w*|indispon\w*|fallback)\b/,rule:'Falhas: preserve a causa e o retorno contratado; separe erro de validação, transitório, permanente e resultado incerto. Não converta falha em sucesso nem repita efeito não idempotente às cegas.'},
];

const normalize=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/_/g,' ');

/** Task routing only; it does not prove that any named component exists. */
export function backendIntent(text:string):boolean{
  const t=normalize(text);
  return /\b(?:backend|controllers?|endpoints?|nestjs|express|fastapi|django|laravel|servicos? de negocio|regras? de negocio|workers?|filas?|queues?|concorrencia|state machine|maquina de estados|use cases?|casos? de uso|server side|handlers? de api)\b/.test(t)
    || /\b[\w./-]+\.(?:controller|service|worker|handler|resolver|repository|use-case|consumer|queue)\.[cm]?[jt]sx?\b/.test(t)
    || /\b(?:implementar|corrigir|criar|alterar|ajustar|refatorar|desenvolver)\b.{0,100}\b(?:api|rota http|transicao de estado|processamento assincrono|regra de calculo|validacao no servidor)\b/.test(t);
}
export function backendFocus(text:string):Focus[]{
  const t=normalize(text);
  return FACETS.filter(f=>f.match.test(t)).map(f=>f.id);
}

/** Compact, task-dependent instructions for the existing prompt, not another
 * call, job, check, or approval. The full specialist stays in its SKILL.md. */
export function backendEngineeringContext(phase:'planner'|'execution',text:string):string[]{
  const ids=new Set(backendFocus(text));
  return [
    '## Engenharia de backend — operação real',
    phase==='planner'
      ? 'No plano, descreva o comportamento observável e os contratos afetados, com os casos de erro pertinentes. Agrupe mudanças que dependem do mesmo contrato. Escolha a conferência real já disponível no projeto; não use apenas existência de arquivo como prova de funcionalidade.'
      : 'Na etapa atual, leia a implementação inteira pertinente e seus consumidores, trace o caminho entrada → decisão → efeito → resposta e corrija no dono da responsabilidade. Preserve efeitos reais e contratos; a conferência existente executa os testes.',
    ...FACETS.filter(f=>ids.has(f.id)).map(f=>'- '+f.rule),
    'Não crie serviços, filas, revisores ou verificações independentes apenas para seguir esta orientação. Use o framework e as ferramentas autorizadas pelo projeto.',
  ];
}
