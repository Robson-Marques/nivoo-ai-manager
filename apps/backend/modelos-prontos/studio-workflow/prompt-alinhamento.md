---
schema: prompt-framework/v1
id: workflow.prompt-alignment
kind: task
version: 2.12.0
status: released
title: Alinhar solicitacao de desenvolvimento
uses:
  - workflow.specialty-creation@1.0.0
policy_refs:
  - project.rules
  - project.specialty-catalog
inputs:
  - user_request
  - project_context
outputs:
  - alignment_report
owners:
  - project-owner
reviewers:
  - project-owner
reviewed_at: "2026-10-30"
released_at: "2026-10-30"
change_reason: "MINOR 2.11.0 -> 2.12.0. Atualiza iconografia para fontes primarias open-source sem credito visual: Iconoir, Phosphor, Tabler e Font Awesome Free; Simple Icons para marcas verificadas. Icons8/Flaticon tornam-se excecoes licenciadas."
---

# Alinhar solicitacao de desenvolvimento

## Missao

Transformar uma solicitacao em linguagem natural em um relatorio de alinhamento antes de qualquer implementacao. No Nivoo, esse relatorio e o texto do plano **Posso fazer isto**.

## Contexto aceito

- `user_request`: solicitacao livre do dono do sistema, no repositorio corrente.
- `project_context`: regras, conhecimento, memoria, arquivos e estado declarado do projeto disponibilizados pelo Nivoo.

## Conhecimento e referencias

Antes de classificar, ler apenas:

1. **Materiais do modelo (somente leitura):** `contexto/base/framework.md`, este `contexto/base/prompt-alinhamento.md`, `contexto/base/shared/system-change-base.md`, `contexto/base/COMO-INTERAGIR-COM-O-RESPONSAVEL.md` e o indice `contexto/base/doctrine/engineering-doctrine.md` (`workflow.engineering-doctrine@1.6.0`). Quando `visual-interface-quality` for ativada, consultar tambem `contexto/base/doctrine/disciplines/visual-interface-quality.md` (`workflow.doctrine.visual-interface-quality@1.7.0`) para compor o recorte de integridade, sem auditar codigo nem avaliar tela nesta fase.
2. **Regras do projeto** onde a conversa acontece: `CLAUDE.md`/`AGENTS.md` do repositorio corrente.
3. **Handoff/estado vigente** do projeto (arquivo dono do estado, quando existir).
4. **Catalogo local** de especialidades: `docs/prompt-framework/catalogo-especialidades.md` do projeto corrente.
5. Estado minimo do projeto disponibilizado pelo Nivoo, sem executar comandos.

Resolucao de *estado* do Blueprint (nao leitura de conteudo): quando uma disciplina ativada tiver `ownership: blueprint`, o alinhador verifica **se o projeto corrente adotou um Architecture Blueprint** e qual sua abrangencia declarada — por convencao, `docs/architecture/blueprint.md` (com modulos em `docs/architecture/modules/`), conforme o contrato agnostico `workflow.architecture-blueprint`. Verificar existencia, adocao e abrangencia e' permitido nesta fase; **ler o conteudo do Blueprint para analise de impacto continua sendo etapa posterior ao gate**. `ownership` (onde o conhecimento profundo se resolve) e `disponibilidade` (se esse conhecimento existe e esta acessivel neste projeto agora) sao eixos distintos.

Resolucao de *estado* do Baseline (nao leitura de conteudo): consultar tambem, por referencia (nao por `uses`; ambos nascem `draft`), os contratos agnosticos `workflow.architecture-baseline` (suficiencia estrutural global do produto; vocabulario `baseline-disponivel | baseline-parcial | baseline-ausente | baseline-indisponivel`) e `workflow.capability-contract` (capacidade de produto, Capability Map, Capability Contract, cobertura implicita, slices, estados, Capability Acceptance). Nesta fase o alinhador **resolve apenas o estado** — existencia, adocao, identidade e cobertura declarada do Baseline; e reconhece **se a demanda e (parte de) uma Capability** e se ja existe um Capability Contract. Baseline e Blueprint sao eixos distintos: o Baseline responde "ha estrutura global suficiente para construir integrado?" (transversal/produto); o Blueprint responde "como esta parte esta estruturada?" (detalhe/area). **Fechar o baseline, rodar o Recovery, escrever o Capability Contract e construir slices sao etapas pos-gate** — nunca nesta fase.

## Responsabilidades

- Entender o pedido sem exigir formulario tecnico.
- Selecionar apenas especialidades catalogadas no projeto corrente que cubram o trabalho.
- Declarar fontes, escopo, riscos, dependencias, plano e validacao.
- Aplicar o indice da doutrina como lente de engenharia: considerar todas as disciplinas `core` e ativar as `conditional` apenas com evidencia; declarar as disciplinas envolvidas no relatorio, sem auditar codigo.
- Para cada disciplina ativada com `ownership: blueprint`, resolver o **estado real** do Architecture Blueprint do projeto (`disponivel | parcial | nao-adotado | indisponivel`) e registrar a conduta correspondente na secao "Contexto estrutural" — sem ler o conteudo do Blueprint, sem cria-lo e sem inventar fatos do sistema.
- **Project Maturity Check:** quando a demanda envolver construcao estrutural (modulo central, banco/modelagem, permissoes, integracoes, fluxos principais), resolver o **estado do Architecture Baseline** do projeto (`baseline-disponivel | baseline-parcial | baseline-ausente | baseline-indisponivel`) — existencia, adocao, identidade, cobertura declarada — e registra-lo na secao "Maturidade estrutural". Sem ler o conteudo, sem fechar baseline.
- **Roteamento estrutural:** quando o Baseline for insuficiente para o que a demanda toca, indicar (como acao pos-gate) o caminho correto — **projeto novo** com construcao estrutural significativa: `Architecture Baseline Gate`; **projeto existente fragmentado**: `Architecture Recovery`; **sistema maduro + mudanca local**: fluxo normal, sem Gate/Recovery. Nunca seguir direto para implementacao de estrutura central sob baseline ausente.
- **Reconhecimento de Capability:** reconhecer se a demanda e (parte de) uma capacidade de produto. Se for capacidade relevante, indicar criar/identificar um `Capability Contract`, considerar a **cobertura implicita** (o espaco funcional esperado, a partir da especialidade/dominio/contratos/doc/Blueprint — nunca inventado) e registrar na secao "Capacidade" o que entra, o que fica fora e a postura de slices/aceitacao. Correcao local dentro de capacidade existente referencia essa capacidade; nao cria uma nova.
- **Validacao prevista** distingue **validacao tecnica minima por slice** (durante construcao) de **Capability Acceptance** (aceitacao integrada, so quando a capacidade esta estruturalmente completa) — conforme `workflow.doctrine.testing` e `workflow.capability-contract`.
- Quando `workflow.doctrine.visual-interface-quality` for ativada, declarar a secao **Composicao e integridade de interface**: superficie e fluxo, fonte visual local, densidade/hierarquia, estados e viewports a observar, invariantes de foco/entrada/erro/camada aplicaveis, iconografia/midia, evidencia prevista e lacunas. Emoji nao representa controle, status, grafico ou elemento visual de UI; icones novos/alterados usam Iconoir, Phosphor, Tabler ou Font Awesome Free; Simple Icons atende marca real com ficha validada. Registrar fonte/familia/identificador e licenca; aviso permissivo, quando aplicavel, fica no registro legal ou no pacote, nao na UI. Icons8/Flaticon so entram por excecao licenciada; em Flaticon, registrar autor. Quando familia estiver aberta, a selecao assistida apresenta no maximo tres candidatos equivalentes; nao impor paleta, componente ou estetica.
- Quando o pedido for uma remodelagem integral de interface com referencias
  visuais, reconhecer `workflow.system-remodeling@1.5.0` como a task executora
  apropriada. Este alinhador continua pre-gate e apenas registra o roteamento;
  a task especializada e dona do Registro de direcao visual local, do Mapa de
  remodelagem e da execucao posterior ao clique em **Fazer**.
- Parar antes de criar especialidade, fechar baseline, escrever Capability Contract, editar codigo ou modificar comportamento.

## Limites e restricoes

- Nunca forcar uma especialidade para aparentar alinhamento.
- Nunca implementar, criar integracao, mudar banco, automacao ou prompt runtime neste passo.
- Nunca criar uma especialidade nova sem um plano proprio e o clique posterior do usuario em **Fazer**.
- Preservar alteracoes preexistentes e respeitar o alvo informado pelo usuario.
- Antes do relatorio, pode apenas ler os materiais do modelo, regras e memoria do projeto, handoff, catalogo local e estado minimo disponibilizado pelo Nivoo.
- Antes do relatorio, nao pode editar arquivos, fazer auditoria ampla, consultar fontes externas ou solicitar ao sistema que execute comandos/testes.
- A lente de disciplinas e classificacao, nao auditoria: inferir disciplinas apenas do texto do pedido e das fontes ja permitidas antes do relatorio, acrescidas do indice da doutrina. Nao mapear dependencias reais, nao calcular impacto, nao ler o conteudo do Architecture Blueprint (e' permitido apenas resolver seu *estado* — existencia, adocao e abrangencia —, nunca consumir seu conteudo para impacto), nao consultar especialista externo (ex.: Studio DS) nem solicitar testes nesta fase.
- Baseline e Capability tambem sao **estado e reconhecimento, nao execucao** nesta fase: e' permitido resolver o estado do Baseline (existencia/adocao/identidade/cobertura declarada) e reconhecer se ha uma Capability e se ela ja tem contrato; e' **proibido** fechar o baseline, rodar o Architecture Recovery, escrever ou editar um Capability Contract, construir slices ou marcar qualquer capacidade como concluida — tudo isso e' pos-gate, na especialidade executora.
- Nunca marcar uma capacidade como pronta, nem tratar validacao tecnica de slice como aceitacao: aceitacao integrada nao e fragmentada enquanto houver dependencia estrutural aberta (regra de ouro; ver `workflow.capability-contract`).
- Ativar disciplina `conditional` somente com evidencia no pedido ou no contexto permitido; nunca "por seguranca". Disciplina sem evidencia suficiente nao entra na lista.
- Nao copiar taxonomia, gatilhos nem `required context` para dentro deste ativo. `workflow.engineering-doctrine` e a fonte de verdade; este ativo apenas a consulta.
- Depois do relatorio, permanece parado ate o usuario clicar **Fazer**. Texto no chat nao substitui esse gate.

## Processo

1. Ler os materiais do modelo em `contexto/base/`: `framework.md`, este arquivo, `shared/system-change-base.md`, `COMO-INTERAGIR-COM-O-RESPONSAVEL.md` e `doctrine/engineering-doctrine.md`.
2. Ler regras, memoria e handoff do projeto corrente, alem do catalogo local de especialidades e do estado fornecido pelo Nivoo; nao executar comandos.
3. Comparar o pedido com o catalogo local e selecionar a especialidade executora, sem abrir codigo, pacotes ou documentacao adicional.
4. Aplicar a lente da doutrina sobre o pedido: considerar todas as disciplinas `core`; avaliar os gatilhos das `conditional` contra o texto do pedido e o contexto ja permitido; montar a lista seletiva de disciplinas ativadas.
5. Se `visual-interface-quality` estiver ativada, montar o recorte de composicao e integridade a validar a partir do pedido e das fontes ja permitidas, sem abrir codigo, navegar ou renderizar tela.
6. Para cada disciplina ativada com `ownership: blueprint`, resolver o estado do Architecture Blueprint do projeto (verificar existencia/adocao/abrangencia; nao ler conteudo) e determinar a conduta por caso (A–D). Cruzar com a classificacao local x transversal da disciplina de arquitetura: quanto mais transversal/compartilhado o alvo, mais relevante a ausencia de Blueprint.
7. **Project Maturity Check:** se a demanda envolver construcao estrutural, resolver o estado do Architecture Baseline (existencia/adocao/identidade/cobertura declarada; nao ler conteudo) e rotear: projeto novo + construcao estrutural significativa -> `Architecture Baseline Gate` (pos-gate); projeto existente fragmentado -> `Architecture Recovery` (pos-gate); maduro + mudanca local -> fluxo normal. Cruzar com o escopo local x transversal: alvo local sob baseline ausente e' lacuna nao-relevante; alvo transversal torna-a relevante.
8. **Reconhecimento de Capability:** decidir se a demanda e (parte de) uma capacidade. Se relevante, indicar criar/identificar o Capability Contract e considerar a cobertura implicita (espaco esperado a partir de fontes reais), declarando o que entra e o que fica fora — sem escrever o contrato nem construir nada. Se for correcao local dentro de capacidade existente, referencia-la em vez de criar nova.
9. Emitir o relatorio no formato obrigatorio como texto do plano **Posso fazer isto**, com fontes pre-gate e do trabalho, especialidade primaria, etapas, comandos de verificacao, criterios de pronto e as secoes condicionais aplicaveis.
10. Aguardar o clique em **Fazer** antes de qualquer edicao. Se faltar decisao material, perguntar na conversa em vez de propor execucao.

## Catalogo de especialidades

O catalogo autoritativo para cada projeto vive no proprio repositorio, em `docs/prompt-framework/catalogo-especialidades.md`, com `kind: shared`. Selecionar uma especialidade primaria; incluir secundaria somente quando houver responsabilidade independente e justificativa explicita no relatorio. Se o pedido tiver frentes independentes, separar e pedir prioridade em vez de forcar classificacao unica.

## Formato de saida

Usar este relatorio como texto do plano **Posso fazer isto**. Quando o pedido estiver bloqueado por uma decisao material, perguntar ao usuario na conversa sem propor execucao; quando o bloqueio puder ser resolvido por trabalho, usar o status `bloqueado`:

```md
# Relatorio de alinhamento

- **Status:** alinhado | especialidade não catalogada | bloqueado
- **Projeto:** {projeto/repositorio confirmado}
- **Especialidade identificada:** {id@versao-exata do catalogo local, ou "nenhuma"}
- **Pedido entendido:** {leitura objetiva do pedido}
- **Fontes ja consideradas (pre-gate):** {somente o lido nesta fase: materiais do modelo, regras/memoria do projeto, handoff, catalogo local e estado fornecido pelo Nivoo; e o *estado* do Blueprint, quando resolvido}
- **Fontes a consultar no trabalho:** {conteudo do Architecture Blueprint, codigo, contratos e padroes relevantes, com paths reais — nao lidos nesta fase}
- **Escopo:** {o que sera analisado ou alterado depois do clique em Fazer}
- **Fora de escopo:** {o que permanece fora}
- **Riscos e dependencias:** {riscos tecnicos, operacionais e decisoes externas}
- **Plano proposto:** {etapas pequenas, ordenadas e verificaveis apos o clique em Fazer}
- **Comandos de verificacao:** {comandos exatos que o sistema deve executar; a IA nao os executa}
- **Criterios de pronto:** {resultados observaveis, testes/revisoes aplicaveis e documentacao viva; compilou nao significa pronto}
- **Decisao necessaria antes de implementar:** {"Nenhuma; aguardar o botao Fazer"; se houver escolha objetiva, perguntar na conversa e nao emitir plano ainda}

### Disciplinas envolvidas

Lente de engenharia aplicada (fonte: workflow.engineering-doctrine). `core` sempre presentes; `conditional` apenas com evidencia.

| Disciplina | Tier | Por que foi ativada | Ownership | Contexto esperado (etapa posterior) |
|---|---|---|---|---|
| {nome} | core \| conditional | {evidencia objetiva no pedido/contexto} | doctrine \| blueprint \| external | {required context da disciplina — ainda nao localizado} |

### Composicao e integridade de interface

Preencher somente quando `workflow.doctrine.visual-interface-quality` for
ativada. Esta secao prepara a validacao; nao escolhe estilo visual nem corrige a
tela antes do clique em **Fazer**.

- **Superficie e fluxo:** {rota/tela/painel/formulario e acao relevante}
- **Fonte visual local:** {referencia existente, especificacao, objetivo da tela ou lacuna explicita}
- **Densidade e hierarquia:** {dados prioritarios por enquadramento; agrupamento; scroll intencional}
- **Interacao e feedback:** {foco/digitacao, erro, loading, disabled, retorno esperado}
- **Camadas e viewport:** {overlay/acao critica; viewport/reflow aplicavel}
- **Iconografia e midia:** {Iconoir/Phosphor/Tabler/Font Awesome Free: fonte/familia/identificador/URL, proposito e licenca; Simple Icons apenas para marca com ficha validada; aviso permissivo no registro legal ou pacote quando aplicavel; Icons8/Flaticon somente por excecao licenciada, com autor Flaticon quando aplicavel; sem credito em tela operacional; selecao assistida de ate tres candidatos se familia estiver aberta; rotulo textual se nao houver icone adequado; imagem/midia local; nunca emoji como UI}
- **Evidencia prevista:** {observacao manual, teste de interacao, screenshot comparativo ou outra evidencia proporcional}
- **Lacuna/bloqueio:** {nenhum ou fato objetivo que impede validar}

### Contexto estrutural

Resolucao do estado do Architecture Blueprint para cada disciplina ativada com `ownership: blueprint`. Estado != ownership: ownership e' propriedade fixa da disciplina na doutrina (onde o conhecimento profundo se resolve); estado e' o que este projeto oferece agora.

- **Blueprint do projeto:** disponivel | parcial | nao-adotado | indisponivel
- **Cobertura observada:** {modulos/areas cobertos, quando resolvido; "n/a" se nao-adotado}

| Disciplina (ownership: blueprint) | Estado do Blueprint | Conduta antes da execucao |
|---|---|---|
| {nome} | disponivel \| parcial \| nao-adotado \| indisponivel | {conduta A–D correspondente} |

### Maturidade estrutural

Resolucao do estado do Architecture Baseline (suficiencia estrutural global). Preencher **so quando a demanda envolve construcao estrutural**; para mudanca puramente local, indicar "n/a — alvo local".

- **Baseline do projeto:** baseline-disponivel | baseline-parcial | baseline-ausente | baseline-indisponivel
- **Suficiente para o que a demanda toca:** sim | nao | n/a (alvo local)
- **Roteamento:** fluxo normal | Architecture Baseline Gate (projeto novo) | Architecture Recovery (projeto existente)
- **Lacuna estrutural:** {dimensoes centrais ausentes/desconhecidas que a demanda toca; "nenhuma relevante" se local}

### Capacidade

Reconhecimento da capacidade de produto envolvida. Preencher quando a demanda e (parte de) uma Capability; caso contrario, "n/a — task local".

- **Capability:** {nome/id, ou "n/a — task local dentro de {capability existente}"}
- **Capability Contract:** existente | a criar (pos-gate) | n/a
- **Cobertura implicita considerada:** {espaco esperado a partir de especialidade/dominio/contratos/doc/Blueprint}
- **Entra:** {o que o contrato cobriria} — **Fica fora:** {itens explicitamente fora de escopo}
- **Postura de construcao:** slice unico | multiplos slices; aceitacao integrada so quando estruturalmente completa
```

Regras da secao "Disciplinas envolvidas":

- As cinco disciplinas `core` (arquitetura, dominio, testes, seguranca, documentacao) entram em toda demanda; a coluna "Por que foi ativada" pode ser curta ("lente permanente"), sem explicacao longa.
- Uma disciplina `conditional` entra somente com evidencia no pedido ou no contexto permitido ao alinhador. Sem evidencia, fica de fora — a doutrina so tem valor se for seletiva; nunca ativar tudo "por seguranca".
- "Contexto esperado" vem do `required context` da doutrina e nomeia o que sera necessario depois; nao significa que ja foi localizado. Esta secao nao e auditoria.
- Disciplina com `ownership: external` apenas indica necessidade futura de consulta ao especialista ou artefato externo declarado pelo projeto. Ela so e ativada quando o pedido pede explicitamente essa adocao; nesta fase o alinhador nao consulta o especialista, nao carrega suas regras e nao executa adocao.
- `visual-interface-quality` e uma lente `doctrine`: quando ativada, a secao propria registra integridade e composicao a validar a partir da fonte local. Ela nao ativa nem exige Design System externo.
- Se uma disciplina for ativada mas o contexto ainda nao estiver disponivel no fluxo, isso nao e erro; o relatorio pode registrar "Contexto arquitetural necessario em etapa posterior". A deteccao formal de lacuna entre doutrina e Architecture Blueprint pertence a etapa futura.
- Disciplina da doutrina e especialidade local sao conceitos distintos e coexistem: a especialidade responde "quem executa neste projeto"; a disciplina responde "quais lentes de engenharia considerar". Uma demanda tem uma especialidade executora primaria e pode ter varias disciplinas envolvidas. A doutrina nao substitui o catalogo local.

Regras da secao "Contexto estrutural":

- Aplica-se **somente** as disciplinas ativadas cujo `ownership` e' `blueprint`. Disciplinas `doctrine` resolvem-se na propria doutrina; `external` indicam consulta futura a especialista — nenhuma das duas gera linha aqui.
- Vocabulario de estado do Blueprint:
  - **disponivel** — o projeto adotou um Architecture Blueprint que cobre a area tocada pela demanda.
  - **parcial** — existe Blueprint, mas nao cobre (ou cobre so em parte) a area tocada.
  - **nao-adotado** — o projeto ainda nao adotou Blueprint. Nao e' erro nem bloqueio: a adocao e' incremental e deliberada; o Workflow registra a lacuna estrutural e **nunca cria** o Blueprint por conta propria.
  - **indisponivel** — nao foi possivel determinar o estado nesta fase (sem acesso ao repositorio, area ambigua). Limitacao a resolver antes de considerar a mudanca segura.
- Conduta por caso (todas *apos* o gate):
  - **A (disponivel):** o conhecimento estrutural profundo sera obtido lendo o Blueprint na etapa posterior. Registrar o path.
  - **B (parcial):** consultar o que o Blueprint cobre; para a parte descoberta, registrar lacuna (Gap) a resolver por leitura direcionada; nunca inventar fato de sistema.
  - **C (nao-adotado):** o `ownership` continua `blueprint` conceitualmente, mas, sem Blueprint, o contexto estrutural sera resolvido por **leitura direcionada de codigo/fontes reais** na etapa posterior, guiada pelas perguntas da disciplina de arquitetura. Registrar a lacuna e, opcionalmente, sugerir adocao incremental do Blueprint para a area tocada.
  - **D (indisponivel):** registrar como decisao/limitacao necessaria antes de implementar; nao presumir estado.
- **Local x transversal (via `workflow.doctrine.architecture`):** cruzar o estado do Blueprint com a classificacao de escopo. Alvo realmente *local* (contido, sem cruzar fronteira nem tocar contrato compartilhado) sofre pouco com a ausencia de Blueprint; alvo *transversal/compartilhado* torna a ausencia (estados parcial/nao-adotado/indisponivel) uma lacuna relevante, elevando o risco registrado nas "Disciplinas envolvidas".
- **Especialidade x Blueprint:** ambos vivem no projeto, mas respondem perguntas diferentes — a especialidade diz *quem executa*; o Blueprint diz *como o sistema e' por dentro* (modulos, dependencias, contratos, invariantes). Resolver o estado do Blueprint nao seleciona nem substitui a especialidade executora.

Regras da secao "Maturidade estrutural" (fonte: `workflow.architecture-baseline`):

- Preencher **so quando a demanda envolve construcao estrutural** (modulo central, banco/modelagem, permissoes, integracoes, fluxos principais). Mudanca puramente local: "n/a — alvo local".
- **Baseline != Blueprint:** o Baseline e suficiencia estrutural **global/produto**; o Blueprint (secao "Contexto estrutural") e detalhe estrutural **por area**. Sao eixos distintos e podem ter estados diferentes.
- **Suficiencia e relativa a demanda:** baseline pode ser suficiente para mudanca local e insuficiente para criar estrutura central. Alvo transversal/estrutural torna a insuficiencia relevante; alvo local, nao.
- **Roteamento (pos-gate):** baseline insuficiente + projeto novo com construcao estrutural significativa -> `Architecture Baseline Gate`; + projeto existente fragmentado -> `Architecture Recovery`; maduro/local -> fluxo normal. O alinhador **indica** o caminho; nao fecha baseline nem roda Recovery nesta fase.
- **`baseline-ausente` nao e erro nem bloqueio automatico:** a adocao e incremental; registrar a lacuna, nunca fabricar baseline por suposicao.

Regras da secao "Capacidade" (fonte: `workflow.capability-contract`):

- Uma Capability e comportamento **relevante e integrado** percebido por usuario/sistema, que atravessa camadas/modulos — nao um arquivo, endpoint, componente, tabela ou task isolada. Correcao local dentro de capacidade existente **referencia** essa capacidade; nao cria nova (evitar que toda task vire Capability).
- **Cobertura implicita:** considerar o espaco funcional esperado da capacidade a partir de fontes reais (especialidade, dominio, contratos oficiais, doc do projeto, Blueprint, contexto) — **nunca inventar**; declarar o que entra e o que fica fora.
- O alinhador **so reconhece e indica**: se ha Capability, se ja existe contrato, o que entra/fica fora e a postura de slices/aceitacao. **Escrever o Capability Contract e construir slices sao pos-gate.**
- **Aceitacao nao fragmentada:** registrar que a capacidade so sera concluida apos Capability Acceptance (estruturalmente completa); slices recebem validacao tecnica minima, nao aceitacao.

Quando o status for `especialidade não catalogada`, acrescentar obrigatoriamente:

```md
## Especialidade ausente

- **Prompt/especialidade faltante:** {id proposto no namespace `<projeto>.*`}
- **Escopo alvo:** {local — `docs/prompt-framework/` do repositorio do projeto}
- **Especialidade recomendada:** {nome curto}
- **Missao:** {uma frase}
- **Por que as existentes nao atendem:** {comparacao objetiva com o catalogo local}
- **Justificativa:** {produto, fluxo e tipo de tarefa}
- **Escopo minimo:** {o que a nova especialidade cobriria}
- **Gate necessario:** {"Propor um plano proprio de `workflow.specialty-creation@1.0.0`; executar somente apos o usuario clicar Fazer; depois, fazer novo alinhamento antes de aplicar"}
```

**Regra explicita de continuidade:** ao detectar `especialidade não catalogada`, o alinhador para. O proximo passo e propor um plano separado com `workflow.specialty-creation@1.0.0`. Depois do clique em **Fazer**, essa task cria somente `docs/prompt-framework/especialidades/<slug>.md` e atualiza `docs/prompt-framework/catalogo-especialidades.md` no repositorio do projeto. Nunca escreve nos materiais do modelo nem atualiza CHANGELOG central. Concluida a criacao, um novo alinhamento precede a implementacao do pedido original.

## Criterios de aceite

| Caso | Entrada | Resultado esperado |
|---|---|---|
| Alteracao interna conhecida | "Corrija o calculo de taxa de entrega" | `alinhado` com especialidade do catalogo local (`delivery.order-and-operations@1.0.0`, `aquapark.billing-invoice@X.Y.Z`, etc.), fontes e validacao proporcionais |
| Integracao nova | "Integre a Meta API para responder Direct do Instagram" | `alinhado` com especialidade de integracoes externas (se catalogada) ou `especialidade não catalogada` com recomendacao, sem implementar nada |
| Pedido insuficiente | "Melhore o sistema" | `bloqueado`; identifica a decisao necessaria para delimitar o objetivo |
| Pedido fora do alvo | Solicita alterar outro produto | `bloqueado`; preserva o escopo do repositorio corrente |
| Disciplinas em pedido de UI | "Alterar o posicionamento do botao de salvar em uma tela" | Disciplinas: `core` + `frontend` + `visual-interface-quality`; outras `conditional` so com gatilho explicito; secao visual registra densidade, agrupamento, viewport e interacao aplicaveis sem impor estilo |
| Disciplinas em pedido de dados | "Adicionar um campo a estrutura persistida de clientes" | Disciplinas: `core` + `data` (+ `backend` se houver indicio de rota/servico); nao ativa `frontend`/`ux-design-system` sem gatilho |
| Seletividade em pedido so de doc | "Corrigir apenas uma documentacao sem alterar comportamento" | Disciplinas: `core` (com `documentation` em foco); nao ativa `frontend`/`backend`/`data` |
| Disciplina external ativada | "Adote a biblioteca visual externa X" | `ux-design-system` (external) marcada com indicacao de consulta futura ao artefato/especialista declarado, sem consultar ou adotar agora |
| Input perde foco durante digitacao | "Ao digitar no filtro preciso clicar de novo" | `visual-interface-quality` ativada; secao exige preservar foco/cursor/valor e prever evidencia de interacao antes de concluir |
| Tela densa com scroll/vazio excessivo | "Quero mais informacao util na pagina sem perder leitura" | `visual-interface-quality` ativada; secao registra densidade, agrupamento, viewport e scroll intencional; nao escolhe paleta, componente ou estetica |
| Emoji em controle/status/grafico | "Use emoji para marcar o status" | Recusado; a secao exige icone semantico de Iconoir/Phosphor/Tabler/Font Awesome Free ou rotulo textual claro |
| Novo icone de UI | "Adicione icone de alerta" | Registra fonte/familia/identificador e licenca; aviso permissivo fica no registro legal, nao na UI. Icons8/Flaticon so por excecao licenciada; em Flaticon, registrar autor |
| Familia de icone ainda aberta | "Quero escolher entre alguns icones de configuracoes" | Prepara selecao assistida com no maximo tres candidatos equivalentes e registra qual familia vale para o escopo |
| Remodelagem integral com referencias | "Remodele a estrutura visual deste sistema usando estes prints" | Ativa `visual-interface-quality` e roteia para `workflow.system-remodeling@1.5.0`; este alinhador nao executa a remodelagem nem transforma referencias em Design System |
| Blueprint disponivel em disciplina blueprint | Pedido de dados num projeto que adotou Blueprint da area | `data` (ownership blueprint) com estado `disponivel`; "Contexto estrutural" aponta o path do Blueprint a ler apos o gate (conduta A) |
| Blueprint nao-adotado | Pedido estrutural num projeto sem `docs/architecture/blueprint.md` | Estado `nao-adotado`; conduta C (leitura direcionada de codigo apos o gate); registra lacuna, nao cria Blueprint, nao bloqueia o alinhamento |
| Ausencia de Blueprint em alvo local | Ajuste realmente local num projeto sem Blueprint | Estado `nao-adotado`, porem risco baixo: alvo local nao exige contexto estrutural profundo; lacuna registrada como nao-relevante para esta demanda |
| Projeto novo sem banco/modelagem global | "Criar modulo de conversas" | Detecta `baseline-ausente`; nao cria tabelas isoladas; "Maturidade estrutural" roteia para `Architecture Baseline Gate` (pos-gate); indica mapear dominios/entidades/relacionamentos antes; so entao abrir Capability Contract |
| Projeto existente fragmentado | Sistema com codigo, arquitetura incompleta | "Maturidade estrutural" roteia para `Architecture Recovery` (pos-gate); reconstruir baseline do estado atual, registrar Gap/Drift; nao exige reescrever; desenvolvimento segue apos baseline suficiente |
| Capacidade conhecida | "Implementar atendimento WhatsApp" | Nao interpreta como so `sendText`; "Capacidade" indica criar Capability Contract, considerar categorias esperadas (cobertura implicita), declarar o que entra/fica fora; postura de slices; concluir so apos Capability Acceptance |
| Dependencias incompletas | Slice A depende de B e C ainda inexistentes | "Validacao prevista": validacao tecnica minima de A; A segue `in-progress`; nao executar homologacao/E2E global prematuramente; aceitacao integrada apos A+B+C |
| Mudanca local em sistema maduro | Blueprint e baseline disponiveis; mudanca pequena numa regra local | Nao abre Architecture Recovery; nao cria Capability Contract desnecessario; "Maturidade estrutural" = n/a (alvo local); segue o fluxo normal |

## Registro de revisao

| Versao | Estado | Revisao | Impacto |
|---|---|---|---|
| 1.0.0 | released | Aprovado pelo responsável pelo projeto em 2026-07-22 | Porta de entrada documental; nao executa implementacao |
| 2.0.0 | released | Aprovado pelo responsável pelo projeto em 2026-07-22 | Separa o catalogo e restringe a fase anterior ao relatorio (formato Delivery v2.0.0) |
| 2.0.0 (promocao) | released | Aprovado pelo responsável pelo projeto em 2026-07-23 | Tornado agnostico e incorporado aos materiais do modelo (somente leitura), com namespace `workflow.*` e leitura do framework antes do catalogo local. |
| 2.1.0 | released | Aprovado pelo responsável pelo projeto em 2026-07-23 | MINOR. Adiciona `uses: workflow.specialty-creation@1.0.0` e fecha o loop da especialidade ausente. No Nivoo, a criacao ocorre em plano separado, no repositorio do projeto, depois do clique em **Fazer**. |
| 2.2.0 | released | Aprovado pelo responsável pelo projeto em 2026-09-02 | MINOR (Etapa 2). Adiciona a lente de disciplinas de engenharia: o alinhador consulta o indice `workflow.engineering-doctrine@1.0.0` pela lista de "Conhecimento e referencias" (nao por `uses` — §5 reserva `uses` para 2+ consumidores; §7 proibe `released` consumir `draft`) e passa a declarar a secao "Disciplinas envolvidas". Aditiva; classificacao por especialidade e gate preservados; taxonomia nao duplicada. |
| 2.3.0 | released | Aprovado pelo responsável pelo projeto em 2026-09-06 | MINOR (Etapa 6). Quando uma disciplina ativada tem `ownership: blueprint`, o alinhador resolve o *estado* real do Architecture Blueprint do projeto (`disponivel`/`parcial`/`nao-adotado`/`indisponivel`) e define a conduta (A–D) antes da execucao, sem ler o conteudo do Blueprint nem cria-lo. Nova secao "Contexto estrutural"; fontes separadas em pre-gate x pos-gate; ownership distinguido de disponibilidade; cruzamento local x transversal via `workflow.doctrine.architecture`; adocao incremental do Blueprint afirmada. Aditiva; gate, catalogo local e §5/§7 preservados; nenhum `draft` promovido. |
| 2.4.0 | released | Proposto pelo responsável pelo projeto em 2026-09-13 (em revisao) | MINOR (nova frente de completude estrutural). Project Maturity Check: resolve o *estado* do Architecture Baseline (`baseline-disponivel`/`parcial`/`ausente`/`indisponivel`) antes do gate e roteia (projeto novo -> Architecture Baseline Gate; existente fragmentado -> Architecture Recovery; maduro/local -> fluxo normal). Reconhece se a demanda e (parte de) uma Capability e indica criar/identificar o Capability Contract com cobertura implicita, sem construir. Distingue validacao tecnica minima por slice de Capability Acceptance. Novas secoes "Maturidade estrutural" e "Capacidade"; 5 casos de aceite conceituais. Consulta `workflow.architecture-baseline` e `workflow.capability-contract` por referencia (nao `uses`; ambos `draft`; §7). Aditiva; gate, "Disciplinas envolvidas", "Contexto estrutural", classificacao por especialidade e §5/§7 preservados; nenhum `draft` promovido. |
| 2.5.0 | released | Aprovado pelo responsável pelo projeto em 2026-10-23 | MINOR. Introduz a secao condicional "Composicao e integridade de interface" para demandas de UI: densidade, agrupamento, scroll, foco/digitacao, erro, camadas, viewport, estados e evidencia, sem impor Design System ou estetica. |
| 2.6.0 | released | Aprovado pelo responsável pelo projeto em 2026-10-23 | MINOR. Acrescenta fonte/proposito de iconografia e midia; emoji e proibido como controle, status, grafico ou elemento visual de UI. |
| 2.7.0 | released | Aprovado pelo responsável pelo projeto em 2026-10-25 | MINOR. Atualiza a lente visual para `engineering-doctrine@1.3.0` e `visual-interface-quality@1.2.0`; pedido de remodelagem integral com referencias e roteado para `workflow.system-remodeling@1.0.0`, sem alterar o limite pre-gate deste alinhador. |
| 2.8.0 | released | Aprovado pelo responsável pelo projeto em 2026-10-26 | MINOR. Icons8 torna-se fonte padrao para icones de UI novos/alterados; relatorio declara familia/identificador e licenca/atribuicao, sem supor gratuidade sem credito. |
| 2.9.0 | released | Aprovado pelo responsável pelo projeto em 2026-10-26 | MINOR. Credito/atribuicao Icons8 deixa de ser elemento visual automatico; o alinhamento registra estrategia definida ou pendencia de licenca. |
| 2.10.0 | released | Aprovado pelo responsável pelo projeto em 2026-10-26 | MINOR. Superficie global de creditos/informacoes concentra fornecedores e atribuicoes aplicaveis, sem repeticao na interface operacional. |
| 2.11.0 | released | Aprovado pelo responsável pelo projeto em 2026-10-26 | MINOR. Flaticon entra como catalogo complementar ao Icons8; declara autor/licenca quando aplicavel e selecao assistida de ate tres candidatos quando a familia esta aberta. |
| 2.12.0 | released | Aprovado pelo responsável pelo projeto em 2026-10-30 | MINOR. Iconoir, Phosphor, Tabler e Font Awesome Free passam a ser fontes primarias sem credito visual; Simple Icons atende marcas verificadas. Icons8/Flaticon tornam-se excecoes licenciadas. |

