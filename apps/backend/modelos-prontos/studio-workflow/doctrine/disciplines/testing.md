---
schema: prompt-framework/v1
id: workflow.doctrine.testing
kind: domain
version: 1.1.0
status: reviewed
title: Disciplina de testes e validacao (lente agnostica de evidencia)
policy_refs:
  - workflow.framework-spec
  - project.source-of-truth
owners:
  - project-owner
reviewers:
  - project-owner
reviewed_at: "2026-09-13"
change_reason: "MINOR 1.0.0 -> 1.1.0 (nova frente de completude estrutural). Aditiva: acrescenta a lente que distingue *validacao durante construcao* (tecnica, minima, proporcional, por slice) de *aceitacao integrada* (Capability Acceptance, so quando a capacidade esta estruturalmente completa), bloqueia o anti-padrao de aceitacao prematura/repetitiva e afirma que testes uteis persistem como regressao. A mecanica da aceitacao (gate no contrato, Definition of Done) pertence ao `workflow.capability-contract`; esta disciplina fornece so a lente de evidencia e a distincao. Nenhuma dimensao existente muda; segue draft. Base 1.0.0 (Etapa 3.3): lente agnostica de evidencia — que prova e necessaria para demonstrar que a mudanca esta correta, que o comportamento foi preservado e que o risco foi validado de forma proporcional; nao escreve testes, nao roda suite, nao abre codigo, nao impoe metodologia (TDD, piramide) nem meta de cobertura, nao contem fato de projeto."
---

# Disciplina de testes e validacao

## Missao

Fornecer a lente agnostica de validacao: dada qualquer mudanca, determinar que
evidencia e necessaria para demonstrar que ela esta correta, que o comportamento
esperado foi preservado e que o risco introduzido foi validado — de forma
proporcional, em qualquer projeto, stack, linguagem ou nivel de maturidade de
testes.

Testes/validacao nao e apenas "escrever testes automatizados". O ponto de partida
e o antipadrao a bloquear: **uma mudanca nao esta correta so porque compilou, nao
deu erro, passou lint, a tela abriu ou um teste isolado passou**. A validacao
deve ser proporcional ao comportamento alterado e ao risco; a IA identifica o que
precisa ser comprovado — sem exigir uma suite enorme para toda alteracao.

Esta disciplina e uma lente de engenharia: determina *qual evidencia buscar*; nao
escreve testes, nao roda suite, nao abre codigo.

## Contexto aceito

- A demanda em linguagem natural e o contexto que o alinhador ja pode ler antes
  do gate (regras e memoria do projeto, handoff, catalogo local e estado fornecido pelo Nivoo).
- Ativada pelo `workflow.engineering-doctrine` como disciplina `core` (entra em
  toda demanda) sempre que houver comportamento a validar.

## Conhecimento e referencias

- `workflow.framework-spec` (`framework.md`): contrato do ativo e composicao;
  `framework.md §8` ja normatiza casos de avaliacao (normal, limite, conflito,
  falha) — esta disciplina se apoia nessa ideia, nao a duplica.
- `workflow.engineering-doctrine@1.0.0`: indice que declara esta disciplina
  (`workflow.doctrine.testing`, `tier: core`) e seu `required context` (risco da
  mudanca, cobertura existente, criterio de aceite, evidencia esperada). Corpo
  profundo daquela entrada; nao redefine o indice.
- `workflow.doctrine.architecture@1.0.0` e `workflow.doctrine.security@1.0.0`:
  disciplinas irmas; fornecem o risco estrutural e o risco de seguranca que esta
  lente usa para dimensionar a validacao. Mesmo formato (dimensoes, escala
  qualitativa, checklist, fronteira com o Blueprint).
- `workflow.system-change-base@2.0.0` e `contexto/base/COMO-INTERAGIR-COM-O-RESPONSAVEL.md`: regras de
  execucao (validacao proporcional ao risco; "desconfiar de erro silencioso" —
  confirmar que um numero "que parece certo" e o certo). Esta lente as informa;
  nao as repete.
- `project.source-of-truth`: onde os criterios reais e a cobertura existente de
  cada projeto sao resolvidos; futuramente especializado pelo Blueprint.

## Responsabilidades

Induzir a IA a determinar, quando aplicavel: (1) o que mudou; (2) qual
comportamento deveria mudar; (3) qual deveria permanecer igual; (4) qual risco foi
introduzido; (5) que evidencia e necessaria; (6) qual nivel de validacao e
proporcional; (7) quais cenarios positivos e negativos sao relevantes; (8) quais
regressoes plausiveis verificar; (9) se ha consumidores ou fluxos afetados; (10)
se a evidencia obtida realmente prova o criterio de aceite.

No Nivoo, essa determinacao aparece no plano como **comandos de verificacao**
que o sistema executara e **criterios de pronto** observaveis. A IA nao executa
os comandos. **Compilou nao significa pronto**: compilacao pode ser uma
verificacao, nunca a unica prova quando ha comportamento, contrato, seguranca,
persistencia, interface ou regressao a validar.

## Limites e restricoes

- **Nao executa.** Nesta etapa a disciplina so **determina que evidencia buscar**
  e como declara-la no plano. O sistema executa os comandos de verificacao
  depois do clique em **Fazer**.
- **Agnostica de metodologia.** Nao impor Test Pyramid, Trophy, TDD, BDD nem
  qualquer estrategia como regra universal; nao definir meta/percentual de
  cobertura. A validacao e escolhida pela natureza da mudanca, arquitetura real e
  risco.
- **Nao inventa criterio.** Criterio de aceite de negocio ausente e registrado
  como pendencia, nao suposto.
- **Nao confunde execucao com prova.** "Executamos algo" nao e "provamos o
  comportamento"; "nao consegui testar" nunca e sucesso.
- **Nao contem fato de projeto.** Nenhum teste, suite ou modulo concreto — isso
  pertence ao Blueprint/projeto.
- **Nao duplica execucao** (`system-change-base`) nem absorve as disciplinas
  vizinhas (seguranca, dominio, UX/DS) — usa o risco que elas apontam.
- **Nao cria** Studio QA, Blueprint, framework de testes, nem altera o alinhador
  para carregar este arquivo (frente propria, se necessaria).

## Dimensoes de analise

Aplicar as que a demanda tornar relevantes; nao gerar cenarios artificiais.

1. **Comportamento alterado.** Que comportamento observavel mudou? Ha criterio
   claro para dizer que funciona? Da para distinguir resultado correto de
   aparentemente correto?
2. **Comportamento preservado.** O que nao deveria mudar? Ha funcionalidade
   adjacente que precisa continuar funcionando? A mudanca toca algo compartilhado?
   (Validacao tambem prova nao regressao, nao so o novo comportamento.)
3. **Criterio de aceite.** Qual condicao objetiva define sucesso? E verificavel?
   Ha ambiguidade a registrar antes da execucao?
4. **Risco.** Cruzar com Arquitetura e Seguranca: qual o risco estrutural? o de
   seguranca? a criticidade do comportamento alterado? Quanto maior o risco, que
   evidencia adicional se justifica? (Sem score universal.)
5. **Nivel de validacao.** Reconhecer formas de evidencia (exemplos, nao lista
   obrigatoria): inspecao estatica; typecheck/compilacao; lint; unitario;
   integracao; contrato; end-to-end; manual; validacao visual; comparacao
   antes/depois; ambiente controlado. Escolher o nivel proporcional a mudanca.
6. **Cenario positivo.** O caminho esperado funciona? O resultado corresponde ao
   criterio de aceite?
7. **Cenarios negativos e de limite.** Entrada invalida? Estado ausente? Permissao
   insuficiente? Falha externa? Valor de limite? Recurso inexistente? (So quando
   pertinente.)
8. **Regressao.** Que comportamento antigo pode quebrar? Ha componente, servico,
   contrato ou fluxo compartilhado? Algum consumidor precisa ser validado?
9. **Contratos e integracoes.** Ao tocar contrato: entrada continua compativel?
   saida continua compativel? produtor e consumidor concordam? o teste realmente
   valida o contrato? Ao tocar terceiro: o que pode ser simulado? o que depende de
   ambiente externo? que limitacoes explicitar?
10. **Estado e persistencia.** Estado foi persistido corretamente? Leitura
    posterior reflete a mudanca? Rollback/erro deixa estado inconsistente?
    Migracao ou alteracao de schema exige validacao especifica?
11. **Interface / UX.** Comportamento visual correto? Interacao funciona? Estados
    loading/erro/vazio coerentes? Responsividade a validar? (A disciplina aponta a
    necessidade; o padrao esperado pertence ao Studio DS.)
12. **Evidencia.** Pergunta final: que evidencia concreta demonstra que isso esta
    correto? Ex.: teste aprovado, saida comparada, screenshot, log controlado,
    resposta de endpoint, estado persistido, comportamento manual reproduzido.

## Estrategia de validacao (agnostica)

A lente nao adota uma metodologia fixa. Ela pergunta: o que pode ser comprovado
automaticamente? o que exige observacao humana? qual combinacao e proporcional ao
risco? Teste automatizado nao e a unica evidencia valida; "testei manualmente"
tampouco basta para qualquer mudanca.

"Cobertura existente" (do `required context` do indice) nao significa percentual:
representa testes existentes, cenarios ja protegidos, suite relacionada, contratos
testados ou validacoes atuais da area. Nao incentivar metas arbitrarias de
percentual.

## Classificacao qualitativa da validacao

Qualitativa, nao formula. Refinavel conforme a linguagem do repositorio.

- **basica** — mudanca local, baixo risco, sem contrato nem compartilhamento
  relevante.
- **ampliada** — mudanca compartilhada, comportamento relevante, integracao
  interna ou risco moderado.
- **rigorosa** — contrato, persistencia critica, seguranca, integracao externa,
  multiplos consumidores, alto risco estrutural ou comportamento critico.

## Perguntas obrigatorias

Checklist mental carregavel por uma IA antes de considerar a mudanca concluida:

1. O que exatamente deveria mudar?
2. O que precisa permanecer igual?
3. Qual e o criterio objetivo de aceite?
4. Qual e o risco da mudanca?
5. Qual nivel de validacao e proporcional?
6. Qual caminho positivo precisa ser comprovado?
7. Quais falhas ou limites sao realmente relevantes?
8. Que regressao plausivel pode ocorrer?
9. Existe contrato ou consumidor que precisa ser validado?
10. Existe estado/persistencia envolvido?
11. Existe comportamento visual/interativo que precisa ser observado?
12. Qual evidencia concreta provara que a mudanca esta correta?

Pergunta sem resposta nao e preenchida por invencao: registrar como contexto
pendente.

## Falhas de validacao

Distinguir, sem colapsar em "passou" nem bloquear tudo automaticamente: falha
real; validacao nao executavel no ambiente atual; contexto insuficiente; teste
inexistente; teste ja quebrado antes da mudanca; evidencia inconclusiva. "Nao
consegui testar" nunca vira sucesso — a limitacao e explicitada, nao escondida; e
nem toda limitacao bloqueia o alinhamento, mas toda limitacao aparece.

## Validacao durante construcao x aceitacao integrada

Extensao direta do antipadrao "compilou = pronto": alem de nao confundir
*execucao* com *prova*, a lente nao confunde *validacao tecnica intermediaria* com
*aceitacao integrada*. Quando uma mudanca e parte de uma **capacidade maior**
(ver `workflow.capability-contract`), ha dois momentos distintos de validacao, e
misturar os dois gera tanto lacuna (aceitar cedo demais) quanto desperdicio
(re-homologar a cada passo).

- **Validacao durante construcao (por slice).** Proporcional e **minima**: prova
  que o slice nao esta tecnicamente quebrado nem introduz erro obvio (formas de
  evidencia da dimensao 5, ex.: typecheck, lint, unitario especifico, schema,
  contrato local, execucao minima). Nao e homologacao completa; **nao exige E2E
  global a cada pequena etapa** quando o fluxo ainda esta incompleto.

- **Aceitacao integrada (Capability Acceptance).** Prova que a **capacidade
  integrada** esta pronta para uso; roda **so quando a capacidade esta
  estruturalmente completa**. A lente indica *que evidencia* a aceitacao exige
  (integracao, E2E, contratos, permissoes, erros, fallbacks, cenarios
  alternativos, UX/responsividade/acessibilidade quando ha interface, seguranca,
  observabilidade, dados, regressao dos fluxos relacionados). A **mecanica** da
  aceitacao — o gate no contrato e a Definition of Done — pertence ao
  `workflow.capability-contract`; aqui fica so a evidencia.

**Regra de ouro (do lado da validacao):** implementacao pode ser incremental;
aceitacao nao deve ser fragmentada enquanto a capacidade tiver dependencias
estruturais abertas. Nao validar como produto pronto o que ainda esta sendo
construido como parte de uma capacidade maior.

**Evitar validacao prematura repetitiva.** Se A depende de B e C ainda
inexistentes: validar o minimo tecnico de A, manter A em construcao e executar a
aceitacao pelo sistema so quando A+B+C formarem a capacidade — em vez de homologar A isolado,
depois A+B, depois A+B+C e de novo na conclusao. O que se evita e a **repeticao de
aceitacao prematura**, nao o teste: a politica nao e "nao testar ate o final".

**Testes persistem como regressao.** Testes uteis criados durante os slices nao
sao descartados; compoem a suite futura. Validacao intermediaria e aceitacao
integrada sao momentos diferentes do mesmo esforco, nao alternativas.

## Fronteiras com outras disciplinas

| Disciplina | Ela determina | Testes determina |
|---|---|---|
| `workflow.doctrine.architecture` | estrutura, compartilhamento, contratos, risco estrutural | como validar os efeitos dessa mudanca |
| `workflow.doctrine.security` | os riscos de seguranca relevantes | que evidencia prova que o comportamento de seguranca esperado continua valido (sem virar auditoria) |
| `workflow.doctrine.domain` | qual e a regra de negocio correta | que a implementacao respeita essa regra |
| `workflow.doctrine.ux-design-system` (Studio DS, futuro) | o comportamento/padrao esperado de interface | como comprovar que a implementacao respeitou esse comportamento |
| Architecture Blueprint (futuro) | modulos, consumidores, contratos, fluxos, testes existentes, pontos compartilhados, criterios estruturais | que evidencia deve ser buscada |

## Contexto esperado do Blueprint

Refina (nao altera) o `required context` do indice. Tipos que a disciplina podera
esperar: comportamento alterado; comportamento preservado; criterio de aceite;
risco estrutural; risco de seguranca; testes existentes; consumidores; contratos;
fluxos afetados; estado/persistencia; ambiente disponivel para validacao;
evidencia esperada. O formato do Blueprint nao e definido aqui (etapa futura);
enquanto ele nao existir, a disciplina pergunta e sinaliza a lacuna.

## Formato de saida

Quando aplicada num alinhamento, a contribuicao desta lente alimenta a linha
`testing` da secao *Disciplinas envolvidas* do relatorio
(`workflow.prompt-alignment`): tier `core`, ownership `doctrine`, contexto
esperado conforme acima, e — quando houver — o nivel de validacao proporcional, a
evidencia esperada e as lacunas de contexto a obter depois. Nao escreve teste nem
produz relatorio proprio separado.

## Criterios de aceite

| Caso | Resultado esperado |
|---|---|
| Mudanca "compilou / tela abriu" apresentada como pronta | Recusada como prova; exige evidencia proporcional ao comportamento e risco |
| Mudanca local trivial | Validacao `basica`; sem exigir suite enorme |
| Mudanca em contrato/persistencia/seguranca | Validacao `rigorosa`; regressao e consumidores considerados |
| Tentativa de impor TDD/piramide/percentual de cobertura | Recusada; a lente e agnostica de metodologia |
| Criterio de aceite de negocio ausente | Registrado como pendencia; nao suposto |
| "Nao consegui testar" | Explicitado como limitacao; nunca interpretado como sucesso |
| Regra de negocio detalhada / auditoria de seguranca | Deferida as disciplinas de dominio / seguranca |
| Slice de uma capacidade maior apresentado como pronto | Validacao tecnica minima aceita para o slice; aceitacao (E2E/integrada) deferida ate a capacidade ficar estruturalmente completa |
| Exigencia de E2E global a cada slice com fluxo incompleto | Recusada; validacao proporcional durante construcao, aceitacao integrada uma vez, quando a capacidade se fecha |
| Descarte de testes de slice apos o slice | Recusado; testes uteis persistem como regressao |

## Registro de revisao

| Versao | Estado | Revisao | Impacto |
|---|---|---|---|
| 1.0.0 | draft | Proposto pelo responsável pelo projeto em 2026-09-02 | Etapa 3.3. Terceiro corpo profundo de disciplina da doutrina: lente agnostica de testes/validacao orientada a evidencia (12 dimensoes, estrategia agnostica de metodologia, classificacao qualitativa basica/ampliada/rigorosa, checklist de 12 perguntas, tratamento de regressao/contratos/evidencia/falhas de validacao, fronteiras com arquitetura/seguranca/dominio/UX-DS e Blueprint futuro). Bloqueia o padrao "compilou = pronto". Sem fato de projeto, sem metodologia imposta, sem execucao, sem integracao com o alinhador. Permanece `draft`; promocao e ligacao ao fluxo sao etapas posteriores. |
| 1.1.0 | reviewed | Revisado pelo responsável pelo projeto em 2026-09-13 (revisao §8/§10; lente de validacao nos materiais do modelo, somente leitura) | MINOR (nova frente de completude estrutural). Aditiva: nova secao "Validacao durante construcao x aceitacao integrada" — distingue validacao tecnica minima por slice de aceitacao integrada (Capability Acceptance), afirma a regra de ouro (aceitacao nao fragmentada enquanto ha dependencia estrutural aberta), bloqueia a validacao prematura repetitiva e afirma que testes uteis persistem como regressao. Tres casos de aceite novos. A mecanica da aceitacao (gate no contrato, Definition of Done) fica no `workflow.capability-contract`, referenciado; esta lente fornece so a evidencia. Nenhuma dimensao/regra existente foi alterada. Permanece `draft`. |

