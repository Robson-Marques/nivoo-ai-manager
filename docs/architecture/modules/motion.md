# Blueprint — módulo de Motion

id: nivoo.module.motion
estado: parcial (fronteiras implementadas; aceitação integrada pendente)
Fonte metodológica: [Architecture Blueprint](../../../apps/backend/modelos-prontos/studio-workflow/architecture-blueprint.md). Referência metodológica, sem declarar liberação de ativo draft.

## Responsabilidade e limites

Transformar uma intenção audiovisual em composição e renderização conectadas por fonte e dependências. A autoria responde pela criação; a ferramenta responde pela geometria, renderização e publicação técnica. Não pertence ao módulo: credenciais de IA, fila, ciclo de vida do job, armazenamento geral, revisão artística humana ou regras de outros especialistas.

## Componentes e conectores

| Componente | Responsabilidade | Fonte real |
|---|---|---|
| Fachada de aplicação | Interface pública existente do Motion | `src/jobs/motion-core-routing.ts` |
| Workflow | Liga autor e executor; ordem e dependências | `src/jobs/motion/workflow.ts` |
| Intenção | Compatibilidade com briefings legados em texto | `src/jobs/motion/intent.ts` |
| Conector de fonte | Tradução para entrada do CLI e seleção da fonte | `src/jobs/motion/source.ts` |
| Contrato de autoria | Formato de autoria e saída por modalidade | `src/jobs/motion/authoring.ts` |
| Tipos | Vocabulário interno | `src/jobs/motion/types.ts` |
| Fachada gráfica | API browser estável e serialização de módulos instalados | `bin/motion-graphics.js` |
| Geometria | Malhas e primitivas, independentes de backend | `bin/motion/graphics/geometry.js` |
| Matemática | Vetores, câmera, cores e interpolação | `bin/motion/graphics/math.js` |
| WebGL | Backend de desenho acelerado | `bin/motion/graphics/webgl.js` |
| Software | Backend de projeção e desenho por CPU | `bin/motion/graphics/software.js` |
| Composition root | Composição das dependências e API comum dos backends | `bin/motion/graphics/runtime.js` |
| Contrato gráfico | Instruções das operações reais de autoria | `bin/motion/graphics/authoring.js` |
| Captura/exportação | Relógio, quadros, cache, FFmpeg | `bin/motion-offline-render.js` |
| Entrada CLI | Compatibilidade com jobs existentes, carrega fontes e overlays | `bin/nivoo-renderizar-motion` |
| Fachada 2D | API pública compatível | `bin/motion-scene-core.js` |
| Normalização | Unidades, dimensões e timeline | `bin/motion/scene/normalization.js` |
| Schema | Validação de cena | `bin/motion/scene/schema.js` |
| Assets | Leitura confinada de imagens e identificação de recursos obrigatórios | `bin/motion/scene/assets.js` |
| Autoria 2D | Exemplo e contrato declarativo | `bin/motion/scene/authoring.js` |
| Desenho | Runtime Canvas e timeline | `bin/motion/scene/runtime.js` |
| Browser | HTML e overlay transparentes | `bin/motion/scene/browser.js` |
| Fonte | Resolução única de entrada e modo, usada pelo render e inspeção legada | `bin/motion/scene/source.js` |
| Adaptador operacional | Descritor tipado de chamadas CLI literais | `src/jobs/motion/command.ts` |
| Falhas | Classificação de erros de mídia independente da persistência do worker | `src/specialties/media/failure-policy.ts` |

Caminhos da tabela são relativos a `apps/backend/`. Leia **o arquivo completo dono da responsabilidade**, o contrato que ele usa e consumidores relevantes antes de editar; busca textual serve para localização, não para substituir leitura. Não editar o motor gráfico para corrigir um problema de planejamento, nem o workflow para corrigir uma malha.

## Dependências e consumidores

- `JobsService.validatePlan/create` → `workflow/compile-plan.ts` → `motion-core-routing.ts` → `motion/workflow.ts` → intenção, fonte, autoria.
- Autor → contrato de autoria → fachadas gráfica e de cena (ainda acopladas ao bin instalado por compatibilidade).
- CLI de render e prévia → fachada gráfica → composição runtime → matemática, geometria e backend selecionado.
- `motion-offline-render.js` → versões de todos os módulos gráficos e declarativos na chave de cache.
- `PlannerService` e `StepExecutorService` → contrato gráfico; não dependem de shaders ou malhas diretamente.

## UML — sequência do fluxo produtivo

```mermaid
sequenceDiagram
    participant P as Planner
    participant C as JobsService / WorkflowCompiler
    participant D as Job / Step (Prisma)
    participant O as Orchestrator
    participant A as Conector IA
    participant R as Conector local / Motion CLI
    participant G as Runtime gráfico
    participant F as Captura / FFmpeg
    P->>C: Plano + objetivo
    C->>C: Resolver intenção, fonte, contrato e dependências
    C->>D: Persistir etapas
    O->>A: Autoria
    A-->>O: Fontes + saída da etapa
    O->>R: Render após autoria
    R->>G: Carregar cena e desenhar
    R->>F: Capturar quadros e codificar
    F-->>R: MP4
    R-->>O: Resultado técnico
```

## Contratos e invariantes

- `AiProvider`: `src/providers/provider.interface.ts`. A fila e os provedores continuam existentes.
- `Job/Step`: `prisma/schema.prisma` (sem migração nesta frente).
- API gráfica: `bin/motion/graphics/runtime.js`, `geometry.js`. Mesmas fábricas no namespace e no renderer, ambos os backends.
- Composição declarativa: `bin/motion-scene-core.js`.
- Nenhuma nova sessão de revisão ou gate foi criada. A autoria adicionada quando o plano a omite recebe o contrato de saída que a criação de job já exige.
- Render só depende do autor quando identificado pelo workflow. Jobs antigos continuam compatíveis.
- Alterar módulo gráfico ou declarativo invalida quadros antigos pelo fingerprint do motor. O adaptador de operação é compartilhado por dependências, seleção de fonte e inspeção do MP4.

## Testes e lacunas

Fonte dos testes: `test/motion-core-wiring-smoke.cjs`, `test/motion-offline-render-smoke.cjs`, `test/unit/motion-render-route.spec.ts`. Comparação direta da lógica anterior com a modularizada cobriu 15 cenários; as cinco fábricas de geometria e os traces de desenho foram comparados (WebGL simulado, não render real). Build global e execução integrada no POCOU não comprovados nesta frente.

Lacunas: definição persistida de operações tipadas (hoje ainda existe interpretação de texto/CLI), executor Motion dedicado, ciclo de reparo do worker e migração de materiais antigos dos perfis persistidos. A divisão declarativa foi concluída, e a frase padrão de capacidade 3D foi corrigida em memória sem sobrescrever regras personalizadas. O catálogo de especialidades e a aceitação de capacidades precisam de ligação explícita ao runtime, não apenas novos textos. Esses itens não estão declarados prontos.

## Evidência adicional desta frente

Três cenas representativas produziram exatamente a mesma normalização, HTML e script de overlay depois da extração de módulos. Cinco cenários isolados adicionais do adaptador operacional, dependências múltiplas, política de falhas e perfil legado passaram (execução JS adaptada de TS, não build). Testes reais integrados de Chromium/FFmpeg, movimento e imagem visível foram adicionados em `test/integration/motion-production.spec.ts`; não executados neste ambiente. Não há aceite de produção.

## Consolidação arquitetural — frente 1/7

Novas autorias selecionam explicitamente `scene`, `hybrid` ou `html`. A composição e o executor recebem o mesmo modo; uma retomada sem autoria preserva o comando original. A resolução de fonte no motor é compartilhada entre CLI e inspeção legada, sem executar uma conferência adicional. `html` ignora overlays antigos, `hybrid` exige seu arquivo, e uma fonte explícita não é substituída por um `scene.json` vizinho. A assinatura de cache inclui o modo efetivo, além de versão do código, fonte e parâmetros.

Evidência desta frente: 8 combinações de seleção e inspeção, 5 rejeições de fonte/mode incompatível ou ausente, 6 conversões de modo e 6 cenários do workflow (incluindo retomada, refação e idempotência), executados diretamente com código do branch e dependências de filesystem simuladas quando necessário. Testes de regressão existentes atualizados; a suíte integral e o aceite integrado permanecem para consolidação final.
