# Auditoria — continuidade com executores reais (2026-10-27)

Escopo: verificar se a V1 entregue resolve o problema central — executar trabalho real com
Claude Code/Codex, preservar contexto entre sessões e concluir pesquisas extensas sem comandos
manuais de continuação. Testes com stubs ou `local-shell` **não** foram aceitos como prova de
integração com IA.

## 1. Situação dos critérios da V1 antes desta etapa

| Critério | Prova existente | Avaliação |
|---|---|---|
| Execução por conector disponível | `local-shell` (não-IA) | **Não comprova IA.** Nenhuma execução real de Claude/Codex havia sido feita. |
| Interrupção/retomada, reinício do worker | `local-shell` com script retomável | Comprova a mecânica de fila/lease/checkpoint, **não** a continuidade de uma sessão de IA. |
| Bloqueio de conclusão sem evidências | `local-shell` imprimindo "concluído" | Comprova o verificador, mas não com um agente real. |
| Adaptadores CLI | stubs TEST-ONLY | Comprova apenas parsing. |

## 2. Lacunas encontradas no código

| # | Lacuna | Risco | Arquivo |
|---|---|---|---|
| L1 | Não existia conceito de **sessão**: cada tentativa era uma chamada isolada, sem `session_id`, motivo de término ou nº de turnos. | Impossível auditar quantas sessões um trabalho levou ou por que cada uma terminou. | `step-executor.service.ts`, `schema.prisma` |
| L2 | **Fim de sessão era confundido com sucesso ou falha.** Exit 0 do agente marcava a etapa como `CONCLUIDO` mesmo sem verificação; `error_max_turns` (sessão encerrada no meio do trabalho) virava `FALHA` e consumia tentativas. | Etapa de IA "concluída" porque o agente parou; trabalhos longos falhando por limite de turnos. | `step-executor.service.ts`, `claude-code-cli.provider.ts` |
| L3 | Etapas de IA podiam ser criadas **sem verificação determinística** — o agente decidia sozinho o fim da etapa. | Viola o requisito "a IA não marca sozinha como concluída" no nível da etapa. | `jobs.service.ts` |
| L4 | O contexto de uma nova sessão não incluía evidências, hipóteses em investigação, artefatos existentes nem notas deixadas pela sessão anterior; o agente não tinha canal estruturado para registrar progresso. | Perda de continuidade entre sessões. | `step-executor.service.ts#buildContext` |
| L5 | O prompt enviado a cada sessão não era guardado. | Impossível provar o que a sessão seguinte recebeu (objetivo íntegro, notas anteriores). | `step-executor.service.ts` |
| L6 | Dados do experimento (fora do worktree) não ficavam acessíveis ao Claude Code (que só escreve/lê no diretório de trabalho), e não havia verificação de integridade do dataset na execução. | Experimento real impossível ou não reprodutível. | `step-executor.service.ts` |
| L7 | Decisão de hipótese era manual (operador escreve conclusão); não havia **regra de decisão pré-registrada**. | Aceitação/rejeição subjetiva ou a posteriori. | `market.service.ts` |
| L8 | Pesquisa podia ser encerrada sem verificação de pendências (não havia controle). | Pesquisa incompleta marcada como encerrada. | `market.service.ts` |
| L9 | Codex CLI não instalado nem autenticado; Claude Code nunca exercitado. | Integração real não comprovada. | ambiente |

## 3. Correções desta etapa

Ver `docs/ESTADO.md` (seção "Etapa 2 — continuidade real") para o que foi implementado e as
evidências de execução.
