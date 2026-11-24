# Recuperação arquitetural — PR #48

Escopo fechado para a entrega: sete frentes, um PR, sem mudança de CI, sem novo gate de execução, sem migração de dados arbitrária. Seguir Blueprint, Baseline e Capability Contract existentes. Cada frente entrega código; a aceitação da capacidade integrada ocorre na frente final, não em cada alteração isolada.

| Frente | Estado | Entrega |
|---|---|---|
| 1. Consolidação arquitetural | implementada | Interfaces dos módulos já extraídos; fonte/modo único de Motion, cache separado, compatibilidade e regressões. |
| 2. Planejador | pendente | Separar construção de contexto, interpretação e seleção das capacidades. |
| 3. Workflow e contratos | pendente | Consolidar contratos das operações, dependências, produção e saídas, sem duplicação de interpretação. |
| 4. Executor | pendente | Separar despacho, contexto e execução específica de ferramentas do ciclo de vida do trabalho. |
| 5. Recuperação | pendente | Organizar falhas, retomada e reutilização sem misturar autoria rejeitada com recursos aprovados. |
| 6. Audiovisual | pendente | Integrar composição, movimento, render, áudio e montagem com contratos reais. |
| 7. Consolidação final | pendente | Revisar instalação, interfaces, regressões, entrega e integrar o PR #48. |

## Frente 1

Decisão: preservar as fachadas existentes e o esquema de dados. O workflow define o modo de uma autoria nova; o adaptador de CLI traduz esse modo e o seletor de fonte do motor é a referência para render e inspeção. O cache não mistura HTML independente com composição híbrida. Nenhuma nova etapa de IA.

Arquivos proprietários: `apps/backend/src/jobs/motion/source.ts`, `workflow.ts`, `apps/backend/bin/motion/scene/source.js`, fachada `motion-scene-core.js`, CLI `nivoo-renderizar-motion`, `motion-offline-render.js`. Regressões nos smoke tests existentes.

Testes diretos: 8 combinações de fonte, 5 fontes incompatíveis/ausentes, 6 conversões de modo e 6 cenários de autoria/retomada/refação. Regressões versionadas. A compilação integral e o teste de produção não são afirmados nesta frente. A interpretação de comandos legados e a coerência do contrato de verificação da autoria serão consolidadas na frente 3, sem criar outra frente.
