# Capability — Produção audiovisual local

- id: nivoo.capability.media-production
- nome: Produzir e entregar vídeo a partir de uma intenção audiovisual
- estado: in-progress
- referência metodológica: [Capability Contract v1.0.0](../../../apps/backend/modelos-prontos/studio-workflow/capability-contract.md)
- arquitetura: [Blueprint Motion](../modules/motion.md), [Baseline](../../architecture-baseline.md)

## Escopo e resultado

O operador descreve o resultado e aprova o plano. A especialidade produz as fontes editáveis, o executor local renderiza e, quando solicitado, conecta locução, trilha, cortes e montagem. O arquivo final deve ficar disponível ao usuário, sem exigir instruções de programação nem repetir uma composição aprovada. Revisão artística é decisão humana.

Entradas: objetivo, perfil da área, ativos autorizados, duração/resolução, fontes novas ou existentes, referências de áudio. Saídas: composição versionada, MP4 (ou MP3 quando solicitado), artefato identificado, logs de resultado e possibilidade de retomada.

## Fronteiras e rastreabilidade

| Regra/capacidade | Fonte real | Evidência |
|---|---|---|
| Seleção pela área configurada, não por palavras em projetos de software | scope.ts, compile-plan.ts, planner/approval | specialty-boundaries.spec.ts |
| Autoria e render conectados por fonte/dependência | jobs/motion/workflow.ts, command.ts | motion-core-wiring-smoke.cjs, media-operation-contract.spec.ts |
| Geometria e render declarativo com interfaces independentes | bin/motion/graphics/, bin/motion/scene/ | motion-scene-core-smoke.cjs, motion-production.spec.ts |
| Captura e exportação, retomada de quadros, proteção de saída | bin/motion-offline-render.js, CLI | motion-offline-render-smoke.cjs, motion-production.spec.ts |
| Inspeção MP4 e tratamento de falhas | native-video-result.ts, media/failure-policy.ts | media-operation-contract.spec.ts |
| Locução e montagem independentes de Gemini Omni | media/audio-planner.ts, assembly-planner.ts; provedores existentes | specialty-boundaries.spec.ts (planejamento; não prova áudio real) |
| Publicação, fila, checkpoint, permissões e retomada | worker, orquestrador, Prisma, ArtifactStore e API existentes | aceitação de ponta a ponta ainda pendente |

Caminhos relativos a apps/backend/src, bin ou test conforme o componente. Detalhes arquiteturais e consumidores estão no Blueprint, não são duplicados aqui.

## Aceitação integrada

1. Build completo do branch candidato e execução das regressões existentes.
2. Render real em Chromium/FFmpeg com cena declarativa e geometria 3D + foto: 25 quadros, duração e dimensões corretas, conteúdo visível, movimento temporal e ausência de duplicação de ativos.
3. Fluxo de autoria/render/montagem e locução local quando solicitados, com dependências reais, sem chamadas extras de IA.
4. Publicação de artefato, retomada e preservação de arquivos anteriores; regressão de workflows não audiovisuais.
5. Uso no ambiente de destino e aceite do resultado pelo responsável.

Os testes isolados de equivalência, escopo e descritores são Validation During Construction. Não equivalem a Capability Acceptance. O teste de browser/MP4 está versionado, mas sua execução e a compilação integral ainda não foram comprovadas; não há acesso direto ao POCOU neste ambiente. O contrato permanece in-progress. A persistência tipada e o executor específico de Motion ainda são lacunas. Não há mudança de schema nem de permissão nesta frente.

Fora de escopo: novos geradores de mídia, novos provedores, migração automática de regras personalizadas, revisor de IA obrigatório, reescrita geral de outros domínios, certificação estética automática.
