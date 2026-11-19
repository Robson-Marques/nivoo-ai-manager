# Integração futura do SSOT documental no Nivoo (PREPARAÇÃO INATIVA)

## Objetivo

O Nivoo deverá consultar o SSOT documental versionado, mantido separadamente em
`Robson-Marques/STUDIO-UX`, antes de planejar, escrever ou revisar interfaces e
estruturas de software. A governança externa define **regras e contratos**; não
fornece uma dependência de runtime obrigatória.

Este documento descreve a integração **ainda não ativada**. O arquivo
`config/workflow-ssot.json` é apenas um contrato para implementação futura; o
código atual do Nivoo **não** o carrega, sincroniza ou aplica.

## Fronteiras obrigatórias

1. **SSOT**: o Git externo é a fonte autoritativa dos documentos, preservados
   com revisão e histórico. A atualização do SSOT é feita por outro responsável.
2. **Nivoo**: consumidor/orquestrador. Nunca edita, republica ou sobrescreve a
   documentação oficial nem assume que o diretório `packages/*` seja doutrina.
3. **Projetos**: implementam suas próprias telas/componentes, com identidade
   e linguagem do produto, obedecendo aos contratos documentais aplicáveis.
4. **Studio X / @studio-ux-ds/***: dependência legada a ser inventariada e
   retirada por módulo, **somente depois de paridade funcional validada**.
5. **Studio Workflow incluído no Nivoo**:
   `apps/backend/modelos-prontos/studio-workflow` já é um pacote local de
   materiais de modelo. Não tratá-lo como espelho sincronizado ou equivalente
   automático do repositório oficial.

## Ativação futura: requisitos de segurança

- Confirmar com o responsável que a atualização do SSOT foi concluída.
- Resolver e fixar um SHA de commit imutável; registrar repositório, SHA,
  arquivos incluídos, hashes SHA-256 e hora da sincronização.
- Buscar apenas documentação em uma **lista permitida**; rejeitar symlinks,
  caminhos relativos perigosos, tamanho excessivo e conteúdo não autenticado.
- Criar snapshot de leitura local por versão, em área fora da pasta mutável do
  projeto. Nunca depender de GitHub online durante execução.
- Integrar snapshot **nas três etapas**: planejamento, execução e conferência
  independente; o arquivo de perfil de projeto já reúne regras da base e do
  projeto, mas isso **não prova** adesão ao SSOT externo.
- Em caso de ausência, versão incompatível, leitura parcial ou falha de
  validação, **bloquear o trabalho dependente dessas regras** com erro
  visível. Não usar fallback silencioso para instruções antigas.
- Fazer checagem automática de violações objetivas (imports legados,
  componentes proibidos, regras estruturais) e conferir evidências de renderização
  e testes de comportamento. **Um prompt isolado não garante conformidade**.
- Respeitar os gates de aprovação já existentes: a IA planeja; o Nivoo autoriza,
  executa verificações e coordena a revisão. Não contornar o botão Fazer.
- Ativar apenas em piloto isolado, mantendo os sistemas legados funcionando.
  Migração de cada módulo deve possuir inventário, cobertura de testes,
  rollback e critérios explícitos para retirar as dependências do Studio X.
- Proibir que atualizações de código do Git externo entrem automaticamente no
  build do Nivoo: consumir **documentos por versão**, não instalar
  `@studio-ux-ds/*`.

## Contrato para a migração "substituir Studio X"

**Entrada**: projeto, escopo/módulo, versão pinada do SSOT, inventário de
componentes usados, regras locais do repositório.

**Saída de planejamento**: mapa de callsites, tabela legado → implementação
local, conjunto de normas do SSOT com referência a arquivo e seção, plano por
etapas, testes e rollback.

**Saída de execução**: arquivos alterados no projeto; nenhum arquivo do SSOT
externo alterado; decisões e exceções justificadas.

**Saída de validação**: versão/hash do SSOT, regras verificadas, erros e avisos,
testes funcionais e visuais, evidências de acessibilidade e regressão.

**Critério de liberação**: todas as regras obrigatórias aplicáveis atendidas,
sem regressão observada nas telas migradas, com revisão independente. Apenas
depois é permitido desinstalar os pacotes legados correspondentes.

## Implementação planejada no Nivoo

- Serviço de snapshot: sincronização manual, pin SHA, manifesto e validação
  de integridade; endpoint administrativo de estado/atualização.
- Leitura de contexto: injeção de normas aplicáveis ao planejamento, à execução
  e à revisão, via snapshot fixado. Exibir versão e fontes utilizadas.
- Gate de conformidade: checagens determinísticas e relatório estruturado,
  acoplado ao verificador de passos, além de verificação visual.
- UI: página interna mostra fonte, revisão do SSOT, status de sincronização,
  documentação por categoria e migração por módulo. Não hospeda DS duplicado.
- Piloto: aplicar em uma tela sem dependência crítica, comparar antes/depois,
  testar e somente então expandir.

**Status atual:** preparado em documentação, sem qualquer ativação de runtime.
