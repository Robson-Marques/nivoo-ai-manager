---
schema: prompt-framework/v1
id: workflow.doctrine.security
kind: domain
version: 1.0.0
status: draft
title: Disciplina de seguranca (lente agnostica de risco)
policy_refs:
  - workflow.framework-spec
  - project.source-of-truth
owners:
  - project-owner
reviewers:
  - project-owner
change_reason: Etapa 3.2 da Project Engineering Doctrine. Corpo profundo da disciplina `core` de seguranca do indice. Define a lente agnostica de risco de seguranca — que riscos uma demanda pode introduzir, ampliar ou alterar, e que informacoes precisam ser conhecidas antes de considerar a mudanca segura. Nao implementa seguranca, nao audita vulnerabilidades, nao roda scanner nem pentest, nao impoe threat model ou OWASP como checklist universal e nao contem fato de projeto.
---

# Disciplina de seguranca

## Missao

Fornecer a lente agnostica de seguranca: dada qualquer mudanca de software,
identificar que riscos de seguranca ela pode introduzir, ampliar ou alterar, e
que informacoes precisam ser conhecidas antes de considera-la segura — em
qualquer projeto, independente de stack, framework ou produto.

O ponto de partida da disciplina: **uma alteracao pode aumentar a superficie de
risco mesmo quando sua finalidade principal nao e "seguranca"**. Criar um
endpoint, mudar uma permissao, adicionar upload, alterar armazenamento,
introduzir webhook, expor um campo em tela, mudar autenticacao, registrar algo em
log ou consumir API externa — todos carregam dimensao de seguranca. A IA deve
perceber isso automaticamente, sem que o pedido mencione seguranca.

Esta disciplina e uma **lente de engenharia**, nao execucao: pergunta e
classifica; nao implementa protecao, nao audita, nao roda scanner nem pentest.

## Contexto aceito

- A demanda em linguagem natural e o contexto que o alinhador ja pode ler antes
  do gate (regras e memoria do projeto, handoff, catalogo local e estado fornecido pelo Nivoo).
- Ativada pelo `workflow.engineering-doctrine` como disciplina `core` (entra em
  toda demanda), sempre que houver dimensao de risco a ponderar.

## Conhecimento e referencias

- `workflow.framework-spec` (`framework.md`): contrato do ativo e composicao.
- `workflow.engineering-doctrine@1.0.0`: indice que declara esta disciplina
  (`workflow.doctrine.security`, `tier: core`) e seu `required context`
  (superficie exposta, dado sensivel, credencial/segredo, permissao tocada). Esta
  disciplina e o corpo profundo daquela entrada; nao redefine o indice.
- `workflow.doctrine.architecture@1.0.0`: disciplina irma; compartilha o formato
  (dimensoes, escala de risco qualitativa, checklist, fronteira com o Blueprint).
- `workflow.system-change-base@2.0.0` e `contexto/base/COMO-INTERAGIR-COM-O-RESPONSAVEL.md`: regras de
  execucao (menor mudanca coesa, nao inventar estado de producao, nao expor
  segredo/token, falhar de forma visivel — "desconfiar de erro silencioso").
  Esta disciplina nao as repete; fornece a lente que as informa.
- `project.source-of-truth`: onde as regras de seguranca reais de cada projeto
  (classificacao de dados, modelo de permissao) sao resolvidas pelo consumidor;
  futuramente especializado pelo Architecture Blueprint.

## Responsabilidades

- Obrigar as perguntas de risco de seguranca abaixo, quando aplicaveis, antes de
  a mudanca ser considerada segura.
- Ajudar a classificar o risco de seguranca da demanda (qualitativo).
- Declarar qual contexto de seguranca sera necessario em etapa posterior, sem
  localiza-lo agora.
- Sinalizar, e nao improvisar, quando o contexto necessario ainda nao existir
  (lacuna a resolver no Blueprint ou na disciplina/especialista correspondente).

## Limites e restricoes

- **Nao e auditoria.** Nao abrir codigo, nao rodar scanner, nao procurar CVEs,
  nao executar pentest, nao calcular exploracao real. Nesta etapa a disciplina so
  **obriga a pergunta**.
- **Agnostica.** Nao impor um threat model especifico nem OWASP (ou qualquer
  catalogo) como checklist obrigatorio universal. Sem preferencia de stack.
- **Nao inventa politica.** Nenhuma classificacao legal/regulatoria sem fonte do
  projeto; nenhuma protecao afirmada sem comprovacao ("nao inventar protecao que
  nao esteja comprovada").
- **Nao contem fato de projeto.** Nenhum papel, escopo, endpoint ou segredo
  concreto — isso pertence ao Blueprint/projeto.
- **Nunca registra segredo real** (token, senha, key, certificado) no ativo, nos
  exemplos ou no relatorio.
- **Nao duplica execucao** (`system-change-base`) nem absorve as disciplinas
  vizinhas de autenticacao, autorizacao, integracoes ou observabilidade — apenas
  trata a interseccao de risco.
- **Nao cria** Studio Security, Blueprint, scanner, nem altera o alinhador para
  carregar este arquivo (frente propria, se necessaria).

## Dimensoes de analise

Aplicar as que a demanda tornar relevantes; nao forcar todas.

1. **Superficie exposta.** A mudanca cria ou amplia ponto de entrada (rota,
   webhook, formulario, upload, socket, callback, integracao, endpoint)? Algo
   antes interno ficou acessivel externamente? Ha mudanca de confianca entre
   zonas do sistema?
2. **Dados.** Que dados entram, saem, sao armazenados, exibidos ou registrados?
   Ha dados sensiveis ou restritos? A mudanca aumenta a exposicao? Ha necessidade
   de minimizar dados? Algum dado pode vazar por retorno, erro, log ou interface?
3. **Identidade e autenticacao.** Quem realiza a acao? A identidade e conhecida e
   validada? A mudanca altera login, sessao, token ou confianca de identidade? Ha
   caminho alternativo que contorne autenticacao? (Mecanismo profundo fica na
   disciplina `workflow.doctrine.authentication`.)
4. **Autorizacao e permissoes.** Quem pode executar a acao? Quem pode visualizar
   o recurso? A permissao e aplicada no ponto correto? Ha diferenca entre
   esconder na interface e realmente impedir a acao? A mudanca cria acesso
   indevido entre usuarios, organizacoes, workspaces, contas ou escopos?
   (Modelo de papeis fica em `workflow.doctrine.authorization`.)
5. **Segredos e credenciais.** A mudanca usa ou expoe token, senha, API key,
   certificado ou segredo? Onde esse segredo deve existir? Ha risco de coloca-lo
   em codigo, frontend, log ou repositorio? Muda configuracao sensivel?
6. **Entrada nao confiavel.** Alguma entrada vem de usuario, terceiro ou sistema
   externo? E validada? Pode ser interpretada alem de sua finalidade? O sistema
   assume confianca que nao deveria?
7. **Saida e exposicao.** O retorno contem apenas o necessario? Erros podem
   revelar detalhes internos? Logs ou mensagens podem expor dados ou segredos?
   Campos adicionais sao entregues sem necessidade?
8. **Integracoes externas.** Ha confianca em terceiro? Como a origem e
   autenticada/verificada? O terceiro pode enviar dados inesperados? Como falhas
   externas afetam seguranca? Ha replay, duplicidade ou chamada indevida a
   considerar? (O contrato fica em `workflow.doctrine.integrations`; aqui, o
   risco.)
9. **Estado e persistencia.** A mudanca permite alteracao de estado antes
   impossivel? Ha risco de modificacao fora do escopo correto? Operacoes
   sensiveis precisam ser rastreaveis? Dados persistidos carregam risco adicional?
10. **Observabilidade segura.** A mudanca precisa gerar evidencia auditavel? O log
    necessario pode conter o que nao deveria ser registrado? Uma falha de
    seguranca seria detectavel? (Interseccao com
    `workflow.doctrine.observability`, sem absorve-la.)

## Principios de seguranca

Aplicar de forma agnostica e operacional quando relevantes: menor privilegio;
confianca explicita, nao presumida; validacao nas fronteiras; minimizacao de
exposicao; nunca expor segredo; autorizacao no lado que realmente controla a acao
(nao confiar so em restricao visual); falhar de forma segura; nao afirmar
protecao que nao esteja comprovada.

## Escala de risco de seguranca

Avaliacao qualitativa, nao score. O risco cresce com: nova superficie externa;
dado sensivel envolvido; alteracao de autenticacao; alteracao de autorizacao;
segredo/credencial; entrada nao confiavel; acao destrutiva ou privilegiada;
ampliacao de escopo.

- **baixo** — sem nova superficie externa, sem dado sensivel, sem segredo, sem
  mudanca de identidade/permissao.
- **moderado** — toca dado sensivel, entrada externa ou permissao, mas sem nova
  superficie externa nem mudanca de autenticacao/privilegio.
- **alto** — nova superficie externa, mudanca de autenticacao/autorizacao,
  segredo exposto, acao destrutiva/privilegiada ou ampliacao de escopo.

## Perguntas obrigatorias

Checklist mental carregavel por uma IA quando a demanda tiver dimensao de
seguranca:

1. A mudanca cria ou amplia alguma superficie de entrada?
2. Quais dados sao envolvidos?
3. Existe dado sensivel ou exposicao adicional?
4. Quem e o ator?
5. Como sua identidade e estabelecida?
6. Quem pode executar ou visualizar isso?
7. Existe segredo ou credencial envolvido?
8. Alguma entrada e nao confiavel?
9. Alguma saida, erro ou log pode revelar informacao indevida?
10. Existe terceiro ou fronteira de confianca envolvida?
11. A alteracao muda estado ou privilegio?
12. Como uma falha relevante seria percebida?

Pergunta sem resposta disponivel no fluxo atual nao e erro: registrar como
contexto a obter em etapa posterior (ex.: "modelo de autorizacao deste modulo nao
disponivel no contexto atual").

## Fronteiras com outras disciplinas

| Disciplina | Ela resolve | Seguranca trata |
|---|---|---|
| `workflow.doctrine.architecture` | onde estao fronteiras, dependencias, contratos | que risco surge ao atravessar/modificar essas fronteiras |
| `workflow.doctrine.authentication` | o mecanismo de identidade/login | que identidade esta envolvida e se ha contorno |
| `workflow.doctrine.authorization` | o modelo de papeis, escopos e ACL do projeto | o risco de acesso indevido |
| `workflow.doctrine.integrations` | o contrato e o funcionamento da comunicacao externa | confianca e exposicao no terceiro |
| Architecture Blueprint (futuro) | como este sistema implementa fronteiras, permissoes, superficies e contratos | que informacoes de seguranca precisa conhecer |

## Contexto esperado do Blueprint

Refina (nao altera) o `required context` do indice. Tipos que a disciplina podera
esperar, quando o Blueprint existir: superficie exposta; origem da entrada; dados
envolvidos; classificacao de sensibilidade quando existir no projeto;
identidade/autenticacao aplicavel; autorizacao/permissao aplicavel;
segredos/configuracao envolvidos; fronteira de confianca; integracoes
relacionadas; logs/auditoria relacionados. O formato do Blueprint nao e definido
aqui (etapa futura). Enquanto ele nao existir, a disciplina pergunta e sinaliza a
lacuna; nao a preenche.

## Formato de saida

Quando aplicada num alinhamento, a contribuicao desta lente alimenta a linha
`security` da secao *Disciplinas envolvidas* do relatorio
(`workflow.prompt-alignment`): tier `core`, ownership `doctrine`, contexto
esperado conforme acima, e — quando houver — a classificacao de risco de
seguranca e as lacunas de contexto a obter depois. Nao produz alteracao de
codigo nem relatorio proprio separado.

## Criterios de aceite

| Caso | Resultado esperado |
|---|---|
| Demanda sem foco em seguranca (ex.: novo endpoint) | Dimensao de seguranca ativada mesmo assim (superficie/dados/autorizacao) |
| A lente e aplicada sem abrir codigo, scanner ou CVE | Apenas perguntas e classificacao; nenhuma auditoria |
| Tentativa de impor OWASP/threat model como checklist universal | Recusada; a lente e agnostica |
| Segredo real citado | Ausente; nunca registrar valores de segredo |
| Referencia a papel/escopo/endpoint concreto | Ausente; fato de projeto pertence ao Blueprint |
| Contexto de seguranca indisponivel no fluxo | Registrado como lacuna a obter depois; nao tratado como erro |
| Mecanismo de login ou modelo de ACL detalhado | Deferido as disciplinas de autenticacao/autorizacao |

## Registro de revisao

| Versao | Estado | Revisao | Impacto |
|---|---|---|---|
| 1.0.0 | draft | Proposto pelo responsável pelo projeto em 2026-09-02 | Etapa 3.2. Segundo corpo profundo de disciplina da doutrina: lente agnostica de risco de seguranca (10 dimensoes, principios operacionais, escala de risco qualitativa, checklist de 12 perguntas, fronteiras com arquitetura/autenticacao/autorizacao/integracoes/observabilidade e com o Blueprint futuro). Sem fato de projeto, sem auditoria, sem threat model imposto, sem integracao com o alinhador. Permanece `draft`; promocao e eventual ligacao ao fluxo sao etapas posteriores. |

