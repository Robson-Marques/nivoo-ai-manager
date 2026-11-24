import type { Skill } from '../skills';

export const QUALITY_SKILL:Skill={
  id:'software-qualidade',domain:'software',description:'Qualidade de software, compilação, tipagem e testes',
  source:'https://github.com/NVIDIA/skills/tree/71e61c7209cb4ca64cba247a7d20a5438b30aef5/skills/mcore-testing',
  action:'Leia os comandos e critérios reais, corrija a causa e preserve testes e build necessários sem repetir verificações equivalentes.',
  body:[
    "Leia manifestos, configurações de compilação, scripts de teste, lockfiles, código e consumidores reais. Identifique linguagem, versão, diretório do pacote, pré-requisitos e resultado esperado; não invente comandos, flags ou executores. Planeje as verificações que comprovam os critérios existentes.",
    "Separe inspeção estática, sintaxe, tipagem, compilação, testes unitários, integração e execução real. A passagem de uma camada não implica sucesso das demais. Um build bem-sucedido não prova comportamento funcional; um teste simulado não prova integração real.",
    "Corrija a origem de erros de sintaxe, tipos, imports, geração de código e configuração preservando interfaces e semântica. Não desative strict, lint, testes, asserções, exclusões ou validações para obter aprovação; alterações legítimas de configuração devem ter justificativa técnica.",
    "Use os comandos reais do projeto e a conferência técnica existente. Leia os scripts encadeados: se o comando de testes já compila exatamente o alvo exigido, não repita o mesmo build. Preserve verificações independentes, alvos e modos diferentes; não deduza equivalência só pelo nome do script. Não introduza CI, novo revisor, fila, chamada de IA ou ferramenta externa por causa desta Skill.",
    "Escreva testes de regressão que falhem no comportamento defeituoso e passem após a correção, quando reproduzível. Cubra entrada válida, inválida, limites, estados e falhas pertinentes. Preserve os critérios e a suíte existentes. Prefira comportamento observável a presença de palavras, arquivos, mocks sem contrato ou snapshots vazios.",
    "Use ambiente autorizado, fixtures sintéticas e dependências reais nos testes de integração pertinentes. Não use produção, credenciais reais ou efeitos externos sem autorização. Se o ambiente necessário não existir, mantenha os testes versionados, execute as verificações possíveis e declare a limitação; não apresente a etapa como funcionalmente validada.",
    "Distinga falha de código de falha de ambiente, versão, dependência, credencial, serviço indisponível ou timeout. Preserve o primeiro erro causal e o comando efetivamente executado, com dados sensíveis sanitizados; não repita a mesma tentativa sem mudança pertinente.",
    "Não declare sucesso sem evidência: registre quais verificações foram executadas, seus resultados e as não executadas. Use a mesma sessão produtiva e a conferência do backend conforme os contratos existentes; não transfira ao usuário tarefas que o sistema já pode executar.",
  ].join('\n'),
};

type Focus="sintaxe"|"tipagem"|"compilacao"|"unitarios"|"integracao"|"regressao"|"ambiente";
type Facet={id:Focus;match:RegExp;rule:string};
const FACETS:readonly Facet[]=[
  {id:"sintaxe",match:/\b(?:sintaxe|syntax|lint\w*|eslint|prettier|ruff|formatac\w*|parser|parse error)\b/,rule:"Sintaxe e análise estática: leia a configuração vigente e corrija a causa no código. Não desabilite lint, regras ou diagnósticos para obter sucesso; formatação não comprova comportamento."},
  {id:"tipagem",match:/\b(?:tipagem|typecheck\w*|type check|type error|erro de tipo|tsc|ts\d{4}|typescript strict|mypy|pyright|generics?|tipos? incompat\w*)\b/,rule:"Tipagem: siga o tsconfig ou equivalente, contratos e tipos dos consumidores. Corrija a origem do erro; não use any, casts arbitrários, ts-ignore ou exclusões para mascarar incompatibilidade."},
  {id:"compilacao",match:/\b(?:compil\w*|builds?|bundl\w*|linker|transpil\w*|webpack|vite|rollup|geracao de codigo|codegen|prisma generate)\b/,rule:"Build: confirme scripts, diretório, versão do runtime, configuração, geração de código e dependências reais. Diferencie erro de compilador, instalação, configuração e infraestrutura. Não repita um build já executado pelo script de testes, se o alvo e o modo forem equivalentes."},
  {id:"unitarios",match:/\b(?:unitarios?|unit tests?|jest|vitest|pytest|junit|mock\w*|stubs?|fixtures?)\b/,rule:"Testes unitários: cubra decisões e limites observáveis com fixtures sintéticas, determinismo e asserções de comportamento. Mocks representam o contrato real e não provam integração ou execução externa."},
  {id:"integracao",match:/\b(?:testes? de integracao|integration tests?|end to end|e2e|playwright|cypress|supertest|smoke tests?|testes? de aceitacao|testes? de contrato|contract tests?|testes? com banco)\b/,rule:"Integração e aceitação: exercite fronteiras e consumidores reais em ambiente autorizado; valide persistência, resposta e efeitos conforme o critério. Não use produção como substituto de ambiente de teste. Declare precisamente o cenário não exercitado."},
  {id:"regressao",match:/\b(?:regressao|regression|cobertura|coverage|flaky|intermit\w*|reprodut\w*|reproduc\w*|caso limite|edge cases?|testes? falh\w*)\b/,rule:"Regressão: reproduza o defeito com entrada representativa, preserve critérios existentes e acrescente teste que distingue comportamento anterior do corrigido. Cobertura numérica, grep e existência de arquivo não substituem uma asserção funcional."},
  {id:"ambiente",match:/\b(?:lockfiles?|package-lock|pnpm-lock|yarn.lock|npm ci|npm install|dependencias?|dependencies|ambiente de teste|test environment|timeout|exit code|codigo de saida|ci|pipeline)\b/,rule:"Ambiente e evidência: siga gerenciador, lockfile, scripts e serviços autorizados. Separe falha do código, ferramenta ou infraestrutura; preserve comando efetivo, código de saída e erro útil sanitizado. Não invente resultado ou repita tentativa idêntica sem corrigir a causa."},
];
const normalize=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/_/g,' ');
const INTENT:readonly RegExp[]=[
  /\b(?:testes?|testar|testing|tests?|jest|pytest|vitest|junit|lint\w*|eslint|ruff|typecheck\w*|type check|tipagem|compil\w*|builds?|regressao|regression|ts\d{4}|tsc|sintaxe|syntax|cobertura|coverage|e2e|smoke tests?|flaky|mypy|pyright|codegen|prisma generate)\b/,
  /\b[\w./-]+\.(?:spec|test)\.[cm]?[jt]sx?\b/,
  /\b(?:tsconfig(?:\.[\w-]+)?\.json|jest\.config\.[\w]+|vitest\.config\.[\w]+|pytest\.ini|conftest\.py)\b/,
  /(?:^|[\s/])(?:test|tests|__tests__)\/[\w./-]+\.(?:py|[cm]?[jt]sx?)\b/,
];

/** Select guidance, never infer successful validation or available infrastructure. */
export function qualityIntent(text:string):boolean{
  const t=normalize(text);
  return INTENT.some(r=>r.test(t));
}
export function qualityFocus(text:string):Focus[]{
  const t=normalize(text);
  return FACETS.filter(f=>f.match.test(t)).map(f=>f.id);
}
export function qualityEngineeringContext(phase:'planner'|'execution',text:string):string[]{
  const ids=new Set(qualityFocus(text));
  return [
    '## Engenharia de qualidade — validação e evidências reais',
    phase==='planner'
      ? "No plano, leia os scripts e configurações reais, escolha verificações proporcionais aos critérios e declare as dependências de ambiente. Encadeie comandos sem repetir a mesma compilação e preserve todas as verificações independentes."
      : "Na etapa atual, leia o erro, contrato, configuração e testes pertinentes; corrija a causa, preserve critérios e acrescente regressão quando necessária. O executor existente realiza a conferência; não crie outro ciclo de validação por IA.",
    ...FACETS.filter(f=>ids.has(f.id)).map(f=>'- '+f.rule),
    "Diferencie inspeção, compilação, teste e execução real. Não declare sucesso não observado, nem relaxe critérios para passar. Use a conferência técnica existente e ambientes autorizados; informe verificações que não puderam ser executadas.",
  ];
}
