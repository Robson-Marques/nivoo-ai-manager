# Avaliação do ECC (github.com/affaan-m/ECC, v2.2.3, MIT) — 2026-10-31

> **Registro histórico.** Partes deste documento se referem ao módulo Mercado (WIN/WDO, datasets,
> hipóteses, experimentos, critérios permanentes, política financeira), removido por completo em
> 2026-11-14 (ADR-041). O estado atual está em [`ESTADO.md`](ESTADO.md).

**Decisão:** não instalar o ECC no Nivoo. Reimplementar apenas as ideias úteis, do jeito do Nivoo
(estado no PostgreSQL, verificação pelo backend, tudo auditável e isolado por projeto).

## Por que não instalar

* Os mais de 25 hooks do plugin rodam scripts em cada ferramenta e em cada início e fim de sessão. Ficam
  fora das permissões do worker (o Bash negado não se aplica a hooks).
* Memória paralela em `~/.local/share/ecc-homunculus` e `~/.claude/sessions`, com "instintos" que mudam
  sozinhos: quebra isolamento entre projetos, reprodutibilidade e a auditoria do prompt.
* O ECC confia no agente para se governar; o Nivoo deliberadamente não confia (ADR-008).
* 111 MB, um mantenedor, releases a cada 2–3 semanas: risco de cadeia de suprimentos num worker de pesquisa.

## O que foi trazido (ideia de origem → implementação no Nivoo)

| Ideia no ECC | No Nivoo | Prova |
|---|---|---|
| Hooks/plugins carregados pelo harness (análise de risco) | **Imunidade do harness**: Claude Code com `--restricted --strict-mcp-config`; arquivos `.claude/`, `CLAUDE.md`, `AGENTS.md`, `.codex/`, `.mcp.json`… removidos do workspace antes e depois de cada sessão; Codex com `project_doc_max_bytes=0` | `real-05` (Claude real: hook plantado não executa, `CLAUDE.md` ignorado); `acceptance/11` |
| `context-budget`, `strategic-compact`, `iterative-retrieval` | **Orçamento de contexto**: seções obrigatórias sempre; memória por prioridade (decisões > restrições > especificação > lições > hipóteses rejeitadas > resultados > hipóteses > evidências > pendências); omissões declaradas; memória íntegra em `.nivoo/memoria.md` para leitura sob demanda (fora do git); estatísticas em `Attempt.contextStats` | `unit/context-builder`, `acceptance/11` |
| `continuous-learning` (instintos) | **Lições de falha por projeto**, determinísticas: quando uma etapa é bloqueada por repetição/política ou esgota tentativas/sessões, a memória do projeto recebe o que foi tentado, com IDs das tentativas; entram com alta prioridade nas sessões seguintes do mesmo projeto, nunca de outro | `acceptance/06`, `acceptance/11` |
| `eval-harness` (evals de regressão) | **Critérios permanentes do projeto** (`/projects/:id/invariants`): verificáveis, copiados para todo job novo; desativar não altera jobs existentes | `acceptance/11` |
| `cost-tracker`, `cost-aware-llm-pipeline` | **Orçamento de custo do projeto** (`PATCH /projects/:id/budget`): soma dos jobs; bloqueio `LIMITE_ORCAMENTO_PROJETO` | `acceptance/11` |
| `operator-approval-loop` (rascunhos com hash) | **Aprovação presa ao conteúdo** (`Approval.subjectHash`): ação destrutiva, critério subjetivo e liberação de dados reservados só valem para o conteúdo exato aprovado | `acceptance/11` |

## O que não foi trazido

Agentes e skills genéricos por linguagem, ciclos autônomos dentro da sessão (o Nivoo já orquestra
fora do agente), notificações de desktop, formatação automática no fim da sessão, integrações pagas.
A skill `llm-trading-agent-security` trata de carteiras cripto/DeFi; operação real já é proibida no Nivoo.
