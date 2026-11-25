# Inventário técnico das skills — Frente 2 / PR #72

Base instalada: 8cf4c5363229cdca9ee9d219b24d7c7bc1c0702f. Branch de correção: fix/skills-integracao-operacional.

Este inventário é um registro de desenvolvimento, não uma etapa de execução do produto. Não é inserido nos prompts, não gera sessões, gates ou conferências adicionais. Uma orientação selecionada, um arquivo SKILL.md materializado e uma ferramenta efetivamente executada são fatos diferentes. Nenhum item abaixo tem validação de runtime nesta frente.

## Cobertura e classificação

Foram consultados o catálogo das 27 skills locais, seus módulos de software, os pontos de composição do planner e executor, o roteamento, a materialização, o fluxo Goldfish e as fontes originais fixadas no código (19 documentos upstream recuperados, incluindo resolve/drift/review-loop). Classificação da implementação, não certificação de completude:

- L: orientação local; a aplicação depende do agente.
- A: adaptação textual de fonte externa; não equivale à instalação/execução do produto de origem.
- P: integração operacional parcial identificada no código; faltam cobertura ou validação real.
- C: capacidade condicional a ferramenta/conexão; disponibilidade não comprovada.
- M: rota manual, não executada automaticamente no fluxo normal.

| # | Skill | Fonte / implementação atual | Estado | Lacuna ou trabalho necessário |
|---|---|---|---|---|
| 1 | retomada | NeMo RL session-memory; stage-card, checkpoints, histórico do executor | P | Comparar estado persistido e arquivos após interrupção; evitar reexecução de etapas e histórico excessivo. Original usa sessão persistente própria; não copiar segundo mecanismo sem necessidade. |
| 2 | execucao-enxuta | TAO token-efficient-execution; orçamento, arquivo de memória e contexto enxuto | P | TAO original compila cards reutilizáveis e usa driver/harness. Nivoo não implementa essa compilação/reuso equivalente; medir tokens reais e preparação, não caracteres como tokens. |
| 3 | diagnostico | NeMo Relay runtime debug; texto local e classificação em verification/recovery | A/P | Original diagnostica Relay instalado. Nivoo não instala Relay. Corrigir diagnóstico causal e separação do erro de ferramenta, servidor e produto. |
| 4 | direcao-artistica | Local; orientação e mediaAuthorRules, integração de ativos nativos | P/C | Conferir caminho ativo de imagem e referência por provedor, uso real do briefing e preservação de identidade. |
| 5 | motion | Local; contrato de autoria e renderização Nivoo | P | Conferir parâmetros, recursos, camadas e reuso; renderer e evidência final não validados aqui. |
| 6 | locucao | Local; orientação remete a gerar-narracao/juntar-videos | C | Rastrear escolha do executor, voz, pronúncia e contrato de áudio; não confundir seleção da skill com geração. |
| 7 | montagem | Local; orientação remete a juntar-videos | C | Conferir preservação de mídia, FPS, trilha, dependências e saída real. |
| 8 | arquivos | Local; escrita em workspace e mecanismo autorizado de operações | P | Conferir capacidade de escrita/binários por provedor, caminhos e persistência sem duplicação. |
| 9 | codigo | Local; leitura de contratos e arquitetura | P | Roteamento funcional, mapa real, consumidores, build/testes existentes; qualidade do resultado ainda não demonstrada. |
| 10 | software-arquitetura | FastGen develop adaptado; architectureContext via codigo | A/P | FastGen original disciplina desenvolvimento de sua própria biblioteca. Confirmar mapa e dependências reais; não chamar de integração FastGen. |
| 11 | software-backend | FastGen develop adaptado; backendEngineeringContext | A | Orientação por facetas; comprovar aplicação em contratos, serviços, filas e efeitos. |
| 12 | software-frontend | FastGen develop adaptado; frontendEngineeringContext | A | Seleção omitia pedidos funcionais de apresentação; corrigida nesta frente. Testar fluxo e integração real de componentes. |
| 13 | software-dados | Local; dataEngineeringContext e disponibilidade de banco de teste | P | Comando aprovado passa a contribuir para seleção; conferir isolamento/migração/consulta e ambiente PostgreSQL. |
| 14 | software-integracoes | NeMo Relay typed wrappers; integrationEngineeringContext | A | Original implementa tipos/codecs do Relay; Nivoo fornece orientação geral. Verificar adaptadores reais e contratos, não instalar Relay por um webhook genérico. |
| 15 | software-seguranca | Local; securityEngineeringContext | L | Controles executáveis e permissões são responsabilidade dos módulos reais; orientação não certifica segurança. |
| 16 | software-qualidade | Megatron mcore-testing adaptado; qualityEngineeringContext e conferência existente | A/P | Original cobre pytest, receitas YAML e golden values do Megatron; não é suíte genérica. Roteamento pelo teste aprovado corrigido; recuperar falha sem diminuir cobertura. |
| 17 | software-manutencao | NeMo Relay plugin observability adaptado; maintenanceEngineeringContext | A | Original configura exportadores/subscribers Relay; Nivoo não os instala. Conferir origem e custo de retries e telemetria existente. |
| 18 | software-requisitos | EGM brainstorm; requirementsEngineeringContext | A | Original faz ideação interativa, lentes independentes e síntese; Nivoo injeta orientação. Frente 1 ampliou seleção; integração da metodologia pendente. |
| 19 | software-especificacao | EGM draft; specificationEngineeringContext | A | Original constrói documento vivo por seções a partir de requisitos; Nivoo usa plano existente, sem o fluxo original de revisão/decisão. |
| 20 | software-contexto-arquitetural | EGM bootstrap/drift; architecturalKnowledgeContext | A | Original documenta árvore bottom-up e detecta divergências; Nivoo oferece leitura de contexto/mapa. Atualização e drift verificáveis pendentes. |
| 21 | software-revisao-independente | EGM review; goldfish.ts e planner.service.ts | M/P | matches sempre false; /goldfish, revisão única, snapshot main, sem cinco fases originais. Codex excluído. Resolve/review-loop não possuem rota equivalente identificada. |
| 22 | software-refinamento-visual | Unslop; visualRefinementContext | A | Original tem sequência de refinamento (direção, espaço, cor, ícones, texto, tipografia, layout, detalhes, imagem e motion); adaptação textual, sem pacote/checklist original operacional demonstrado. |
| 23 | software-direcao-artistica | Design Taste Frontend; artDirectionContext | A | Original inclui ativos, regras por tipo de site, starter e checker/gate; Nivoo explicitamente não importa esses recursos. Adoção parcial. |
| 24 | software-composicao-interface | Taste layout-v4; interfaceCompositionContext | A | Original referencia system.css, layout.css/js, heroes e checker; adaptação não usa os ativos originais. |
| 25 | software-microinteracoes | Taste motion; interfaceMotionContext | A | Original exige camada motion.css/js e interações reais nas páginas aplicáveis; Nivoo explicitamente não importa. Não confundir com motion audiovisual. |
| 26 | software-biblioteca-componentes | 21st-ui; componentLibraryContext, MCP autorizado | C | Original opera catálogo HTTP MCP. Confirmar disponibilidade e operações de busca/obtenção/geração por conector e integração do resultado; sem chave não declarar execução. |
| 27 | software-liquid-glass | Liqui Design; liquidGlassContext, template engine e registry | P | Núcleo e 38 componentes fornecidos pelo código; aceitação/inventário nativos existem. Adoção integral em callsites e comportamento nos projetos existentes ainda não validada; não equivale à galeria visual. |

## Fontes consultadas

- NVIDIA/skills @ 71e61c7209cb4ca64cba247a7d20a5438b30aef5: nemo-rl-session-memory, tao-token-efficient-execution, nemo-relay-debug-runtime-integration, fastgen-develop, nemo-relay-instrument-typed-wrappers, mcore-testing, nemo-relay-plugin-observability (SKILL.md).
- google/elephant-goldfish-model @ 63e239d8d4c3ddc6774faf533b4997405f78c549: egm-brainstorm, egm-draft, egm-bootstrap, egm-review, egm-resolve, egm-drift-report, egm-review-loop (SKILL.md).
- Leonxlnx/taste-skill @ d1a2bb41d927083ac7118f60cfc9cdf711810ea0: SKILL.md, references/layout-v4.md, references/motion.md.
- heydamir/unslop @ 620163eedb3529d9cd23a3994ed8d287d06f760d: skills/unslop/SKILL.md.
- 21st-dev/magic-mcp @ 6b5299e8a83ceffa73d4fc4e148905bb3eeeeb55: skills/21st-ui/SKILL.md.
- Liqui Design @ 27fea1b66069fcb8dcce133486c6fe5f49744db9: identificação e pacote fornecido no código local (não foi auditado arquivo a arquivo contra upstream nesta frente).

## Correção de roteamento realizada

O executor passa o verifyCommand aprovado à seleção. Comandos reconhecidos de testes/build/roteiros ativam qualidade; quando indicam banco concreto, também dados. Não executa comandos nem transforma logs em gatilhos. Pedidos de apresentação de linhas/colunas/controles recebem orientação frontend mesmo sem vocabulário técnico; saídas explícitas de terminal são excluídas desse novo gatilho. Mantém isolamento de mídia, executores determinísticos e pre-gate. Testes unitários adicionados, não executados.

## Frentes restantes e condições

3. EGM integral: confrontar os sete fluxos originais e dependências referenciadas, integração com o ciclo já aprovado, Goldfish em contexto independente e resolução/drift com escopo proporcional, sem disfarçar uma revisão única como cinco fases.
4. Provedores e ferramentas: isolamento efetivo, suporte a arquivos e MCP, operação de mídia, pacote original dos recursos de frontend quando adotados. Separar ferramentas especializadas NVIDIA de adaptações locais; não habilitar produtos ou credenciais sem necessidade/autorização.
5. Recuperação de falhas: diagnosticar erro causal, preservar resultados e evitar sessões genéricas desnecessárias.
6. Eficiência: medir fila, preparação de contexto, cópia de acervo, tokens reais, reuso e custo.
7. Observabilidade e conclusão: evidência por capacidade, distinguir seleção/execução, não declarar completude sem teste.
8. Integração final: compatibilidade, retomada dos trabalhos existentes, compilação e validação no fluxo de atualização acordado.

Pendências explícitas: não foram auditados integralmente todos os consumidores de mídia, MCP, renderer, referências/scripts upstream, registry Liqui, ou o runtime dos 27 itens; não foi executado build ou teste. Esta frente inventaria e corrige uma lacuna de roteamento; não encerra a adoção de nenhuma fonte externa.
