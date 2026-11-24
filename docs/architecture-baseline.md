# Architecture Recovery — Baseline do Nivoo

id: nivoo.architecture-baseline
versão: 0.1.0
estado: baseline-parcial
Escopo: recuperação inicial da arquitetura existente, sem reescrita. Referência metodológica: [Architecture Baseline](../apps/backend/modelos-prontos/studio-workflow/architecture-baseline.md) e [Blueprint](../apps/backend/modelos-prontos/studio-workflow/architecture-blueprint.md).

## Estrutura global confirmada

| Fronteira | Estado | Evidência |
|---|---|---|
| Interface / API | existente | `apps/web`, `app.module.ts`, `jobs.controller.ts` |
| Aplicação / persistência | existente, responsabilidades misturadas em serviços grandes | `jobs.service.ts`, `prisma/schema.prisma`, `core.module.ts` |
| Orquestração / fila durável | existente | `orchestrator.service.ts`, `worker-runner.service.ts`, `queue.service.ts` |
| Conectores | existente | `provider.interface.ts`, `provider-registry.service.ts` |
| Contexto / especialidades | parcial | `project-profile.service.ts`, `context-builder.ts`, `modelos-prontos/studio-workflow` |
| Ferramentas Motion | parcial, primeiras fronteiras extraídas | [Blueprint Motion](architecture/modules/motion.md) |
| Demais ferramentas e capacidades | desconhecido nesta recuperação | requer leitura dos módulos completos |

Caminhos backend relativos a `apps/backend/src/`, exceto modelo pronto e schema.

## Decisão de arquitetura

Preservar NestJS, React, Prisma, fila, registry e contratos existentes. Separar apresentação (controller e UI), aplicação (workflow/orquestração), domínio (responsabilidades e contratos) e infraestrutura (conectores, persistência, motores). MVC é útil na fronteira de apresentação; não substitui os contratos de workflow. UML é documentação de estrutura e fluxo, não uma camada runtime.

A fonte de verdade é o código completo do componente, seus contratos e consumidores; este mapa direciona a leitura. Um arquivo grande deve ser dividido por responsabilidade real, não por contagem arbitrária de linhas.

## Gaps e drift observados

1. Planejamento e criação de job duplicavam a sequência de transformações; extraído compilador compartilhado.
2. Biblioteca gráfica acumulava matemática, malhas, dois backends, instalação e instruções; separada em módulos com fachada compatível.
3. Motion fazia interpretação, autoria e tradução de comandos no mesmo arquivo; responsabilidades separadas.
4. Perfil padrão de design de vídeo ainda descreve 3D como capacidade futura em `areas/area-templates.ts`; política Motion atual declara disponibilidade. O conteúdo dos perfis existentes no banco do POCOU não foi inspecionado.
5. `PlannerService` e `StepExecutorService` ainda concentram múltiplas capacidades. Não foi realizada recuperação estrutural completa desses serviços.
6. Operações de Motion e reparo ainda podem ser inferidas de títulos e texto. A migração para contratos tipados persistidos e conectores específicos ainda não ocorreu.

## Estado de aceitação

A recuperação é **parcial**. Não afirmar prontidão global nem substituir arquitetura real por um índice. A frente inicial separa o Motion e unifica o compilador de novos jobs. Validação global e aceite do comportamento integrado ainda pendentes. O próximo recorte deve usar este mapa para ler contratos reais e consumidores antes de extrair responsabilidades, sem criar outro orquestrador concorrente.

## Isolamento por especialidade (implementado nesta frente)

A área configurada (`Area.template`, com fallback legado) determina se o contexto audiovisual entra no planejamento. Software, Studio Workflow e atendimento não recebem o contrato de mídia nem suas heurísticas de roteamento. Projetos gerais preservam compatibilidade; operações nativas explicitamente selecionadas em um projeto não audiovisual conservam seus contratos de execução e dependências por arquivo, sem reclassificar as demais etapas.

- `src/specialties/media/scope.ts`: seleção da capacidade pela configuração real; invocação explícita de ferramentas legadas.
- `src/specialties/media/context.ts`: catálogo e preferências de mídia, consultados apenas quando aplicáveis.
- `src/specialties/media/planner-contract.ts`: composição dos contratos de planejamento; cada ferramenta tem seu próprio módulo (`motion-planner.ts`, `audio-planner.ts`, `assembly-planner.ts`, `generation-planner.ts`). Locução local e montagem não dependem da disponibilidade do Gemini Omni.
- `src/jobs/workflow/compile-plan.ts`: fronteira compartilhada de planejamento, aprovação e criação; não interpreta regras de mídia em software/atendimento. `PlannerService`, `ConversationsService`, `JobsService` e `StepExecutorService` usam a mesma configuração de área.
- `test/unit/specialty-boundaries.spec.ts`: regressões de isolamento, workflows mistos, dependências, refação visual e disponibilidade independente.

Nove cenários isolados executados a partir das funções do branch com remoção de tipos TS para o ambiente JS e dependências externas simuladas; todos passaram. Ainda não houve execução da suíte Jest, compilação completa, deploy ou aceitação no POCOU. Não confundir essa fronteira parcial com recuperação completa de todos os domínios, nem com um executor Motion tipado novo.
