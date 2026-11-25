---
schema: prompt-framework/v1
id: workflow.architecture-baseline
kind: shared
version: 1.0.0
status: reviewed
title: Contrato agnostico do Architecture Baseline (suficiencia estrutural global)
policy_refs:
  - workflow.framework-spec
owners:
  - project-owner
reviewers:
  - project-owner
reviewed_at: "2026-09-13"
change_reason: "Nova frente (completude estrutural). Cria o contrato agnostico do Architecture Baseline: determina se um projeto possui estrutura arquitetural GLOBAL suficiente para que capacidades relevantes sejam construidas de forma integrada, sem descoberta estrutural tardia excessiva. Formaliza a diferenca Baseline (transversal/global) x Blueprint (estrutural/vivo/incremental), o vocabulario de maturidade estrutural, o Architecture Recovery (reconstruir o baseline atual de um sistema existente sem reescrita) e o Architecture Baseline Gate (projeto novo). E contrato, nao instancia: nao contem fato de nenhum projeto, nao implanta baseline, nao altera projeto consumidor. Nasce draft."
---

# Contrato do Architecture Baseline

## Missao

Determinar se um projeto possui **estrutura arquitetural global suficiente** para
que funcionalidades relevantes sejam implementadas de forma integrada, sem
descoberta estrutural tardia excessiva. O Baseline responde uma pergunta de
suficiencia sobre o **sistema como produto**; ele nao e documentacao exaustiva
nem exige definir antecipadamente todos os detalhes futuros.

Este ativo e o **contrato** dos Architecture Baselines — o que um baseline
precisa cobrir e quando ele e "suficiente". Ele nao e um baseline, nao contem
fato de nenhum projeto e nao substitui o `workflow.architecture-blueprint`.

## Problema que o Baseline resolve

Em projetos novos ou estruturalmente incompletos, o Workflow consegue alinhar
mudancas individualmente, mas isso ainda permite **desenvolvimento fragmentado**:
um modulo e implementado e validado isolado; depois outro; o primeiro passa a
depender do segundo; o conjunto e revisitado; surge nova dependencia; o conjunto
e revisto de novo; partes sao marcadas como "funcionando" enquanto a capacidade
maior segue incompleta; ao final faltam recursos obvios, fluxos nao integrados,
telas sem comportamento completo e testes E2E.

O Baseline nao impede implementacao incremental. Ele impede que **modulos
centrais, banco, permissoes, integracoes e fluxos principais** sejam criados sem
uma estrutura global minima que os relacione — a raiz da fragmentacao.

## O que o Baseline e / nao e

**E:** a visao estrutural transversal do produto; o esqueleto necessario para
construir integrado; uma leitura de **suficiencia** (ha estrutura bastante para
comecar/continuar?), nao de completude; agnostico de stack; incremental o
bastante para nao travar o projeto; capaz de **referenciar** fontes autoritativas
(inclusive o Blueprint) sem copia-las.

**Nao e:** documentacao exaustiva; definicao antecipada de todo detalhe futuro;
dump de codigo; wiki narrativa; copia do Blueprint; substituto do Blueprint;
manual de regras de negocio; um prompt. Representa o **esqueleto estrutural
necessario**, nao a descricao completa do sistema.

## Cobertura minima conceitual

Um Baseline suficiente responde, no nivel **global do produto** (nao por linha de
codigo), as dimensoes abaixo. Cada uma pode estar `existente`, `parcial`,
`planejado`, `ausente`, `desconhecido` ou `nao-se-aplica` (vocabulario herdado do
`workflow.architecture-blueprint`, *Convencoes transversais*). Referenciar a
fonte autoritativa quando ela existir; nao copiar.

- visao do sistema (proposito, escopo, limites);
- dominios;
- glossario;
- modulos e suas responsabilidades;
- limites entre modulos;
- entidades principais;
- relacionamentos;
- modelo logico de dados / ERD;
- estados principais;
- invariantes principais;
- autenticacao;
- autorizacao;
- matriz de permissoes em nivel arquitetural;
- integracoes externas;
- eventos / assincrono, quando aplicavel;
- fluxos criticos;
- contratos principais;
- superficies de interface;
- auditoria;
- seguranca;
- retencao;
- observabilidade;
- dependencias estruturais;
- consumidores relevantes;
- estrategia de testes;
- **mapa de capacidades do produto** (ver `workflow.capability-contract`).

A cobertura e conceitual: o Baseline declara o **estado** de cada dimensao e
aponta onde a resposta real vive; nao precisa detalha-la. Uma dimensao
`nao-se-aplica` e uma resposta valida (ex.: sistema sem eventos assincronos).

## Suficiencia (o criterio central)

O Baseline nao exige que toda dimensao esteja `existente`. Ele e **suficiente**
quando a estrutura global permite construir a proxima capacidade relevante sem
descoberta estrutural tardia excessiva. Julgamento qualitativo, proporcional ao
que a demanda vai tocar:

| Grau | Significado | Conduta |
|---|---|---|
| suficiente | as dimensoes que a demanda toca estao resolvidas o bastante para construir integrado | seguir para Capability Map / Contract |
| insuficiente | dimensoes estruturais centrais (modulos, dados, permissoes, integracoes, fluxos) que a demanda toca estao ausentes/desconhecidas | fechar o baseline dessas dimensoes antes (Baseline Gate ou Recovery) |

A suficiencia e **relativa a demanda**: um baseline pode ser suficiente para uma
mudanca local e insuficiente para criar um modulo central. Cruzar sempre com a
classificacao local x transversal da disciplina de arquitetura
(`workflow.doctrine.architecture`): alvo realmente local sofre pouco com baseline
incompleto; alvo transversal/estrutural torna a insuficiencia relevante.

## Vocabulario de maturidade estrutural

Estado do Baseline de um projeto, resolvido pelo alinhador **antes do gate** (sem
ler o conteudo em profundidade):

| estado | significado |
|---|---|
| `baseline-disponivel` | o projeto adotou um Baseline que cobre a area tocada pela demanda, no grau suficiente |
| `baseline-parcial` | existe Baseline, mas nao cobre (ou cobre so em parte) a area tocada |
| `baseline-ausente` | o projeto ainda nao adotou Baseline. Nao e erro: a adocao e incremental; o Workflow registra a lacuna e nunca fabrica um baseline por suposicao |
| `baseline-indisponivel` | nao foi possivel determinar o estado nesta fase (sem acesso, area ambigua). Limitacao a resolver antes de considerar a mudanca segura |

Este vocabulario espelha, de proposito, o dos estados do Blueprint no
`workflow.prompt-alignment` (secao "Contexto estrutural") — sao eixos distintos
(um e global/produto, o outro e estrutural/por-area), mas resolvidos com a mesma
disciplina pre-gate: existencia, adocao, identidade e cobertura declarada; leitura
profunda continua pos-gate.

## Architecture Baseline != Architecture Blueprint

Nao fundir os dois conceitos.

| | Architecture Baseline | Architecture Blueprint |
|---|---|---|
| Pergunta | "O sistema, como produto, tem estrutura global suficiente para comecarmos/continuarmos construcao integrada?" | "Como as partes reais deste projeto estao estruturalmente organizadas e relacionadas?" |
| Natureza | transversal / global; leitura de suficiencia | estrutural, vivo, incremental; leitura de detalhe |
| Granularidade | sistema-produto | modulo / entidade / fluxo |
| Papel | precondicao para construir integrado | fonte de verdade arquitetural da area tocada |
| Evolucao | fecha o esqueleto necessario e depois se mantem | cresce continuamente com o sistema |

Relacoes:

- O Baseline **pode usar o Blueprint como evidencia**: onde o Blueprint ja cobre
  uma dimensao, o Baseline a referencia como `existente` apontando o path, sem
  redescrever.
- O Blueprint **pode crescer depois do Baseline**: fechar o baseline nao exige
  Blueprint completo; o Blueprint detalha, sob demanda, o que o Baseline apenas
  situou.
- Um mesmo projeto pode ter Baseline suficiente e Blueprint parcial (comum) ou
  vice-versa. Sao artefatos complementares, nao substitutos.

## Architecture Recovery (sistema existente)

**Missao:** reconstruir o estado arquitetural **real** de um sistema ja existente
sem exigir reescrita nem paralisacao total. E o modo que produz um Baseline
**atual** para um projeto que ja tem codigo mas arquitetura incompleta ou
implicita.

O Recovery mapeia, de forma **progressiva** (nao de uma vez, nao o sistema
inteiro), classificando cada achado com o vocabulario de estado:

- o que **existe**;
- o que e **parcial**;
- o que e **planejado**;
- o que esta **ausente**;
- o que esta **desconhecido**;
- **Gap** (lacuna) e **Drift** (divergencia entre fontes/estados que existem) —
  mesma distincao do `workflow.architecture-blueprint`;
- contratos;
- dados;
- fluxos;
- consumidores;
- interfaces;
- testes existentes.

Regras:

- **Nao reconstruir a historia inteira do sistema.** Registrar o **estado atual**,
  nao a arqueologia de como se chegou nele.
- **Nao exigir reescrita nem parada.** O desenvolvimento continua apos o baseline
  ficar suficiente para a area tocada; o Recovery e incremental por area/demanda.
- **Reutilizar o vocabulario do Blueprint** quando adequado (entidades, estados,
  Gap/Drift) — Recovery e leitura estrutural, nao um formato novo.
- **Nunca inventar.** Ausencia e Gap explicito; divergencia e Drift; nada e
  preenchido por suposicao.
- Ao final, o projeto **passa a ter um Architecture Baseline atual** — a saida do
  Recovery e um Baseline, nao um artefato separado.

## Architecture Baseline Gate (projeto novo)

Quando o projeto **ainda nao possui Baseline suficiente** e a demanda inicia
construcao estrutural significativa (modulo central, banco/modelagem global,
permissoes, integracoes, fluxos principais), **nao seguir direto para
implementacao**. Entrar no **Architecture Baseline Gate**: fechar primeiro um
baseline arquitetural suficiente para a area que sera construida.

Regras:

- **Nao modelar cada detalhe futuro.** O Gate fecha o esqueleto necessario, nao a
  especificacao completa do produto.
- **Nao permitir** que modulos centrais, banco, permissoes, integracoes e fluxos
  principais nasçam sem estrutura global minima que os relacione.
- **Proporcional a demanda:** o Gate fecha as dimensoes que a construcao vai
  tocar, no grau suficiente — nao um baseline exaustivo antes de qualquer linha.
- **Alvo realmente local** em projeto sem baseline: registrar a lacuna como
  nao-relevante para a demanda e seguir; o Gate e para construcao estrutural
  significativa, nao para todo ajuste.
- Fechar um baseline e **decisao de produto** — passa por gate humano (ver
  *Gates*).

## Fluxo (posicao no Workflow)

O Baseline e resolvido logo apos o Project Maturity Check do alinhador:

```text
DEMANDA
  -> PROMPT ALIGNMENT
    -> PROJECT MATURITY CHECK (estado do Baseline: disponivel/parcial/ausente/indisponivel)
      -> Baseline suficiente para o que a demanda toca?
           NAO, projeto novo      -> ARCHITECTURE BASELINE GATE
           NAO, projeto existente -> ARCHITECTURE RECOVERY -> Baseline atual
           SIM                    -> segue
  -> BASELINE OK
  -> CAPABILITY MAP / CAPABILITY CONTRACT  (workflow.capability-contract)
  -> implementacao em slices ...
```

O alinhador **resolve o estado** do Baseline antes do plano (existencia, adocao,
identidade, cobertura declarada); a leitura profunda e o fechamento do baseline
ocorrem somente depois do clique em **Fazer**. Ver `workflow.prompt-alignment`.

## Gates

Preferir gate humano em: decisao de produto; **definicao/fechamento de um
Baseline**; inclusao/exclusao importante de dimensao estrutural; conflito de
regra; risco alto; bloqueio real. Evitar checkpoint vazio: depois do clique em
**Fazer**, se nao houver decisao humana nova, seguir dentro do escopo aprovado
(`COMO-INTERAGIR §5/§6`).

## Relacao com o Blueprint existente (preservada)

As regras ja criadas para o Blueprint permanecem: estados `disponivel`/`parcial`/
`nao-adotado`/`indisponivel`, adocao incremental, leitura seletiva, reconhecimento
dirigido. O Baseline **nao substitui** o Blueprint; o Workflow usa os dois de
forma complementar (Baseline = suficiencia global; Blueprint = detalhe estrutural
da area).

## Relacao com especialidades e especialistas externos

- **Especialidades** (catalogo local do projeto) dizem *quem executa*; o Baseline
  diz *se ha estrutura global para executar integrado*. Nao se substituem.
- **Especialistas externos** (ex.: Studio DS) permanecem donos do seu
  conhecimento; o Baseline os **referencia** (nunca copia) quando uma dimensao e
  governada por eles. Dependencia de especialista externo e ownership externo, via
  `workflow.consuming-system-adoption` quando houver adocao real.

## Lifecycle e adocao

- **SemVer do contrato** (`framework.md §7`); ciclo `draft -> reviewed -> released
  -> deprecated`. Este ativo nasce `draft`.
- Um Baseline de projeto e um artefato no namespace do projeto (ex.:
  `<projeto>.architecture-baseline`) que **declara conformidade** a este contrato
  por `policy_refs: [workflow.architecture-baseline@<versao>]` — conformidade por
  referencia com versao fixada, nao por `extends`. Convivencia com o Blueprint do
  projeto: o Baseline referencia o Blueprint como evidencia; nao o duplica.
- MAJOR do contrato exige migracao explicita dos Baselines existentes; MINOR
  acrescenta dimensoes/campos opcionais compativeis.

## Criterios de aceite do contrato

| Caso | Resultado esperado |
|---|---|
| Projeto novo, demanda inicia construcao estrutural significativa sem baseline | Estado `baseline-ausente`; entra no Architecture Baseline Gate antes de implementar; fecha esqueleto suficiente da area, nao o produto inteiro |
| Sistema existente, codigo presente, arquitetura incompleta | Architecture Recovery; reconstroi o baseline do estado atual (existe/parcial/planejado/ausente/desconhecido, Gap/Drift); nao exige reescrita; nao reconstroi a historia |
| Alvo realmente local em projeto sem baseline | Lacuna registrada como nao-relevante; segue o fluxo normal sem abrir Gate/Recovery |
| Baseline suficiente para a area tocada | Segue para Capability Map / Capability Contract |
| Tentativa de exigir baseline exaustivo antes de qualquer linha | Recusada; o Baseline e esqueleto suficiente proporcional a demanda, nao especificacao completa |
| Fusao de Baseline com Blueprint | Recusada; sao conceitos distintos e complementares |
| Baseline copiando conteudo do Blueprint ou de doc externa | Recusado; o Baseline referencia a fonte autoritativa, nao a duplica |
| Dimensao sem informacao suficiente | Registrada como `desconhecido`/Gap; nunca inventada |

## Registro de revisao

| Versao | Estado | Revisao | Impacto |
|---|---|---|---|
| 1.0.0 | reviewed | Revisado pelo responsável pelo projeto em 2026-09-13 (revisao §8/§10; sem duplicacao apos correcao) | Nova frente (completude estrutural). Contrato agnostico do Architecture Baseline (`kind: shared`): pergunta de suficiencia estrutural global, cobertura minima conceitual, criterio de suficiencia relativo a demanda, vocabulario de maturidade (`baseline-disponivel`/`parcial`/`ausente`/`indisponivel`), distincao formal Baseline x Blueprint, Architecture Recovery (reconstruir o baseline atual de sistema existente sem reescrita nem historia) e Architecture Baseline Gate (projeto novo). Reutiliza o vocabulario de estado/Gap/Drift do `workflow.architecture-blueprint`. Nao implanta baseline, nao contem fato de projeto, nao integra Studio DS, nao altera o alinhador nem projetos consumidores. Permanece `draft`; promocao e ligacao ao fluxo sao etapas com plano proprio e gate **Fazer**. |


