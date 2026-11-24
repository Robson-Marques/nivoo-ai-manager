import type { Skill } from '../skills';

export const DATA_SKILL:Skill={
  id:'software-dados',domain:'software',description:'Modelagem, persistência, migrações e desempenho de dados',
  action:'Trace a origem, modelo, consultas e consumidores dos dados; preserve integridade, migrações e isolamento do ambiente de teste.',
  body:[
    'Leia o schema efetivo, histórico de migrações, modelos e consumidores das consultas. Identifique o banco, ORM e versões reais pelo projeto; não presuma Prisma ou PostgreSQL. Preserve chaves, relações, cardinalidade, nulabilidade, restrições e semântica dos dados.',
    'Modele a regra de negócio na camada responsável; preserve integridade referencial, unicidade e validação também no banco quando aplicável. Diferencie nulo, ausência, zero e valor padrão. Para valores monetários e datas, preserve precisão, unidade, fuso e convenções existentes.',
    'Em alterações de esquema, trate instalações novas e bancos já existentes: ordene expansão, preenchimento e restrição conforme necessário, considere bloqueios, compatibilidade do código e reversibilidade. Não edite migrações já aplicadas nem use reset, DROP ou alteração destrutiva de produção como atalho.',
    'Use transações e níveis de isolamento adequados à operação real. Evite lost update, duplicidade e leitura inconsistente; confira a garantia efetiva de locks e restrições. Não mantenha transação aberta durante chamadas externas demoradas. Trate rollback e repetição de forma compatível com a regra.',
    'Em consultas, selecione apenas os dados necessários, preserve filtros de autorização e escopo, ordenação determinística e paginação. Identifique N+1, cardinalidade, índices e custo de escrita. Não crie índice ou cache sem motivo; use plano de execução e medições quando disponíveis no ambiente de teste.',
    'Use parâmetros do driver/ORM e não concatene valores fornecidos pelo usuário em SQL. Proteja credenciais, não copie dados pessoais de produção para fixtures e não registre payloads sensíveis. Teste com dados sintéticos representativos, incluindo restrições, falhas, repetição e transições de migração pertinentes.',
    'No Nivoo, use o PostgreSQL descartável já disponibilizado à conferência somente quando compatível com o projeto. A presença de configuração não comprova conectividade. Não exponha as variáveis de conexão ao agente, não conecte produção para testar e não invente outro banco, serviço ou credencial. Se o recurso necessário não estiver disponível, declare a limitação.',
    'Ajuste os testes existentes, incluindo migração de esquema anterior e preservação de registros quando pertinente. A conferência técnica executa os comandos reais. Não substitua teste de persistência por existência de schema ou relatório, nem acrescente sessão independente de revisão.',
  ].join('\n'),
};

type Focus='modelagem'|'migracoes'|'transacoes'|'consultas'|'integridade'|'isolamento';
type Facet={id:Focus;match:RegExp;rule:string};
const FACETS:readonly Facet[]=[
  {id:'modelagem',match:/\b(?:modelagem|schemas?|esquemas?|entidades?|relacionamentos?|cardinalidade|orm|prisma|models?|tabelas?|colunas?)\b/,rule:'Modelagem: leia o schema, modelos e consumidores existentes; preserve tipos, cardinalidade, precisão, defaults e semântica dos dados.'},
  {id:'migracoes',match:/\b(?:migrac\w*|migrations?|alembic|flyway|liquibase|backfill|alter table|ddl)\b/,rule:'Migrações: preserve histórico aplicado e dados existentes; considere ordem de implantação, preenchimento de registros antigos, locks e compatibilidade. Exercite evolução do esquema no banco de teste, não reset de produção.'},
  {id:'transacoes',match:/\b(?:transac\w*|transactions?|rollback|commit de banco|atomic\w*|concorrencia|locks?|deadlocks?|isolamento transacional|idempotenc\w*|lost update)\b/,rule:'Transações: identifique invariantes, concorrência e a fronteira atômica real; confirme rollback e repetição quando pertinentes. Evite efeitos externos dentro de transação longa.'},
  {id:'consultas',match:/\b(?:consultas?|queries|query|select|indices|indice|indexes?|indexacao|n\+1|paginac\w*|explain|performance|desempenho|join|joins|agregac\w*)\b/,rule:'Consultas: preserve escopo, filtros e ordenação/paginação; verifique N+1 e custo dos índices. Use dados representativos e medições no ambiente adequado, sem alegar ganho não medido.'},
  {id:'integridade',match:/\b(?:integridade|restric\w*|constraints?|unicidade|unique|foreign key|chaves? (?:estrangeiras?|primarias?)|duplic\w*|nullable|nullability|precisao|decimal|consistencia)\b/,rule:'Integridade: preserve restrições, chaves e semântica de nulos, unidades e valores. Exercite dados inválidos, duplicados e referências ausentes; não relaxe invariantes para passar testes.'},
  {id:'isolamento',match:/\b(?:banco de teste|testes? de integracao|fixtures?|seed|dados de teste|producao|credenciais?|database url|postgresql de teste)\b/,rule:'Ambiente: use apenas conexões de teste autorizadas e fixtures sintéticas. Não passe credenciais ao agente nem use produção como substituto de infraestrutura indisponível.'},
];
const normalize=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/_/g,' ');

/** Routing only, not a declaration that a particular database is installed. */
export function dataIntent(text:string):boolean{
  const t=normalize(text);
  return /\b(?:banco de dados|banco de teste|postgres(?:ql)?|mysql|mariadb|sqlite|mongodb|prisma|orm|sql|migrac\w*|migrations?|transacoes?|schema|modelagem de dados|integridade referencial|alembic|flyway|liquibase)\b/.test(t)
    || /\b[\w./-]+\.(?:prisma|sql)\b/.test(t)
    || /\b(?:criar|alterar|corrigir|ajustar|otimizar|implementar)\b.{0,100}\b(?:consulta|query|indice de banco|persistencia|transacao|chave estrangeira)\b/.test(t);
}
export function dataFocus(text:string):Focus[]{
  const t=normalize(text);
  return FACETS.filter(f=>f.match.test(t)).map(f=>f.id);
}
export function dataEngineeringContext(phase:'planner'|'execution',text:string,testDbConfigured:boolean):string[]{
  const ids=new Set(dataFocus(text));
  return [
    '## Engenharia de dados — persistência real',
    phase==='planner'
      ? 'No plano, identifique o schema e a tecnologia reais, os consumidores afetados e o comportamento verificável. Para mudança de persistência, inclua teste de dados e migração pertinente na conferência existente, sem criar revisão independente.'
      : 'Na etapa atual, leia os modelos, migrações e consultas pertinentes por inteiro, acompanhe seus consumidores e preserve dados e contratos. Implemente a mudança na camada responsável e ajuste os testes reais.',
    ...FACETS.filter(f=>ids.has(f.id)).map(f=>'- '+f.rule),
    testDbConfigured
      ? 'O Nivoo tem configuração de PostgreSQL descartável para a conferência: use-a apenas se compatível com o projeto; disponibilidade efetiva depende da conexão. As variáveis de conexão pertencem ao executor, não ao agente.'
      : 'O PostgreSQL descartável do Nivoo não está configurado. Use somente outro ambiente de teste já autorizado e compatível, se houver; caso contrário informe quais testes ficam sem execução. Nunca use produção como alternativa.',
    'Não invente comandos, credenciais ou resultados. Não crie outro serviço ou uma sessão de IA somente para esta orientação.',
  ];
}
