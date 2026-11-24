# Recuperação arquitetural — PR #48

Escopo fechado para a entrega: sete frentes, um PR, sem mudança de CI, sem novo gate de execução, sem migração de dados arbitrária. Seguir Blueprint, Baseline e Capability Contract existentes. Cada frente entrega código; a aceitação da capacidade integrada ocorre na frente final, não em cada alteração isolada.

| Frente | Estado | Entrega |
|---|---|---|
| 1. Consolidação arquitetural | implementada | Interfaces dos módulos já extraídos; fonte/modo único de Motion, cache separado, compatibilidade e regressões. |
| 2. Planejador | implementada | Separar construção de contexto, interpretação e seleção das capacidades. |
| 3. Workflow e contratos | pendente | Consolidar contratos das operações, dependências, produção e saídas, sem duplicação de interpretação. |
| 4. Executor | pendente | Separar despacho, contexto e execução específica de ferramentas do ciclo de vida do trabalho. |
| 5. Recuperação | pendente | Organizar falhas, retomada e reutilização sem misturar autoria rejeitada com recursos aprovados. |
| 6. Audiovisual | pendente | Integrar composição, movimento, render, áudio e montagem com contratos reais. |
| 7. Consolidação final | pendente | Revisar instalação, interfaces, regressões, entrega e integrar o PR #48. |

## Frente 1

Decisão: preservar as fachadas existentes e o esquema de dados. O workflow define o modo de uma autoria nova; o adaptador de CLI traduz esse modo e o seletor de fonte do motor é a referência para render e inspeção. O cache não mistura HTML independente com composição híbrida. Nenhuma nova etapa de IA.

Arquivos proprietários: `apps/backend/src/jobs/motion/source.ts`, `workflow.ts`, `apps/backend/bin/motion/scene/source.js`, fachada `motion-scene-core.js`, CLI `nivoo-renderizar-motion`, `motion-offline-render.js`. Regressões nos smoke tests existentes.

Testes diretos: 8 combinações de fonte, 5 fontes incompatíveis/ausentes, 6 conversões de modo e 6 cenários de autoria/retomada/refação. Regressões versionadas. A compilação integral e o teste de produção não são afirmados nesta frente. A interpretação de comandos legados e a coerência do contrato de verificação da autoria serão consolidadas na frente 3, sem criar outra frente.

## Frente 2

Planejador separado em módulos `worker/planner/types.ts` (contrato de entrada), `context.ts` (fatos e histórico), `capabilities.ts` (seleção por área), `contract.ts` (protocolo), `prompt.ts` (composição), `response.ts` (interpretação), `validated-job.ts` (validação inicial e reparo pela mesma interface). `providers/project-model.ts` remove a dependência do planejador em relação ao executor. `PlannerService` mantém fila, sessão e persistência; as exportações legadas continuam compatíveis. O serviço passou de 866 para 523 linhas. Regras de interface (roteiros, fotos, prévia e banco de teste) são ativadas em software/Studio Workflow e projetos gerais, não em vídeo/atendimento; mídia é ativada conforme a área configurada. Projetos desconhecidos não audiovisuais mantêm as ferramentas de software; gerais mantêm compatibilidade. A correção de vírgulas JSON não altera comandos ou textos dentro de strings. O protocolo exige leitura do componente proprietário, seus contratos e consumidores. Sem chamadas de IA adicionais, sem alteração de CI.

Evidência: 14 cenários de interpretação, capacidades e validação/anexos, mais dois cenários de contexto (conversa e entrega), executados diretamente com o código adaptado de TS para JS e dependências simuladas. Regressões versionadas em `test/unit/planner-boundaries.spec.ts`. Build e suíte integral ficam na frente 7. A fronteira do executor e recuperação permanecem nas frentes 4 e 5.
