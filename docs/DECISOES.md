# Registro de decisões (ADR)

| # | Data | Decisão | Motivo |
|---|---|---|---|
| 001 | 2026-10-27 | Monorepo npm workspaces: `apps/backend` (NestJS, API + worker) e `apps/web` (React/Vite) | Compartilhar Prisma/serviços entre API e worker sem duplicar código |
| 002 | 2026-10-27 | Fila persistente em PostgreSQL (`FOR UPDATE SKIP LOCKED` + lease/heartbeat) | Estado e fila na mesma transação; sem dependência extra (Redis); recuperação após queda por expiração de lease |
| 003 | 2026-10-27 | Prisma 6 (`prisma-client-js`) | Versão estável conhecida; migrações versionadas |
| 004 | 2026-10-27 | Tempo real via SSE com polling incremental de `LogEntry.seq` | Funciona entre processos (worker grava, API lê) sem broker |
| 005 | 2026-10-27 | Interrupção pelo usuário = `BLOQUEADO` com `blockedReason=INTERROMPIDO` | Usa somente os estados exigidos; motivo explícito |
| 006 | 2026-10-27 | Conector `local-shell` (executor determinístico, não IA) | Permite executar experimentos/scripts e testar o pipeline com conector real sem simulação |
| 007 | 2026-10-27 | Nenhum provedor simulado no código da aplicação; stubs de CLI só em `test/support/stubs` (TEST-ONLY) | Não apresentar mocks como integrações funcionais |
| 008 | 2026-10-27 | Conclusão do job só pelo `CompletionService`; saída da IA nunca altera status do job | Requisito 6 |
| 009 | 2026-10-27 | Operações financeiras reais bloqueadas por política (não aprováveis) | Requisito 7 |
| 010 | 2026-10-27 | Testes aplicam migrações com `prisma migrate deploy` e fazem TRUNCATE no banco de teste | `migrate reset` é destrutivo; evitar qualquer risco ao banco de desenvolvimento |
| 011 | 2026-10-27 | Tentativas registram pid/host; recuperação encerra grupo de processos órfão | Evitar execução duplicada após SIGKILL do worker |
| 012 | 2026-10-27 | Claude Code CLI roda com `--permission-mode acceptEdits` e sem Bash por padrão | Restringir acesso a diretórios autorizados sem bypass de permissões |
| 013 | 2026-10-27 | Não executar o Claude Code CLI real no contêiner de desenvolvimento em nuvem | O login visível ali é do próprio ambiente de desenvolvimento, não de um worker autorizado; integração real fica em teste opt-in |
| 014 | 2026-10-27 | **Substitui a 013.** Por pedido explícito do responsável, o contêiner de desenvolvimento foi usado como worker autorizado: o Claude Code CLI já tinha login OAuth oficial da conta do responsável; o Nivoo apenas invoca o binário oficial (sem ler/copiar credenciais) | Comprovar a integração real; o mecanismo é o oficial e a conta é do próprio responsável |
| 015 | 2026-10-27 | Nova classificação de tentativa `SESSAO_ENCERRADA`: o agente terminou a sessão (limite de turnos ou fim normal) sem a verificação da etapa passar → continuação automática em nova sessão, limitada por `maxSessionsPerStep` e detecção de falta de progresso | Distinguir fim de sessão de falha, limite do provedor e conclusão; eliminar comandos manuais de continuação |
| 016 | 2026-10-27 | Etapas de IA exigem `verifyCommand` | O agente não encerra a etapa sozinho |
| 017 | 2026-10-27 | Claude Code sem regras de permissão genéricas (`--allowedTools Write` liberava escrita fora do workspace — achado em execução real) + Bash/WebFetch/WebSearch negados + detecção de alteração no diretório de dados | Isolamento comprovado com o executor real |
| 018 | 2026-10-27 | Progresso de sessão = mudança no trabalho (git + out/), excluindo `.nivoo/` | Notas do agente sozinhas não são progresso (achado em execução real: agente anotava "não consigo" a cada sessão) |
| 019 | 2026-10-27 | Hipóteses com regra de decisão pré-registrada; decisão aplicada pelo sistema; regra imutável após início de qualquer experimento que possa decidi-la | Aceitação/rejeição por critério predefinido, não por julgamento posterior |
| 020 | 2026-10-27 | Saída `stream-json` do Claude Code: cada ferramenta usada e cada permissão negada vão para o log do job | Observabilidade do que cada sessão fez |
| 021 | 2026-10-28 | Instalação de produção: `deploy/install-debian.sh` (root, idempotente), Node oficial em `/opt/nivoo/node`, usuário `nivoo`, systemd endurecido, API em 127.0.0.1 + túnel SSH, comando `nivoo` | Servidor Debian do responsável, sem sudo; isolamento em nível de SO |
| 022 | 2026-10-28 | Conclusão do job, atualização do experimento e evidência na memória na mesma transação | Corrida observada: job CONCLUIDO com experimento ainda sem métricas |
| 023 | 2026-10-28 | Na interrupção, checkpoint antes de liberar a etapa | Etapa retomável só com estado salvo |
| 024 | 2026-10-31 | Não instalar o ECC; reimplementar ideias selecionadas (ver `docs/AVALIACAO-ECC.md`) | Hooks fora do modelo de permissões, memória paralela entre projetos, risco de cadeia de suprimentos |
| 025 | 2026-10-31 | Claude Code com `--restricted --strict-mcp-config` e limpeza de arquivos de harness no workspace; Codex com `project_doc_max_bytes=0` | Achado real: hook em `.claude/settings.json` plantado no workspace executava shell e `CLAUDE.md` injetava instruções ocultas |
| 026 | 2026-10-31 | Orçamento de contexto por prioridade + memória completa em `.nivoo/memoria.md` | Saturação de contexto em pesquisas longas, sem resumo por IA |
| 027 | 2026-10-31 | Lições automáticas de falha na memória do projeto | Evitar repetir abordagens fracassadas entre jobs, de forma auditável |
| 028 | 2026-10-31 | Critérios permanentes do projeto | Regressão: nenhum job pode quebrar invariantes do projeto |
| 029 | 2026-10-31 | Orçamento de custo por projeto | Limite global além do limite por job |
| 030 | 2026-10-31 | Aprovação vinculada ao hash do conteúdo aprovado | Aprovar uma coisa não autoriza outra |
| 031 | 2026-11-02 | Código incorporado à `main` (avanço direto do histórico da branch de desenvolvimento, sem reescrita); CI roda em todos os pushes | Pedido do responsável: tudo versionado na `main` |
| 032 | 2026-11-02 | Retomada recusada enquanto o worker da sessão interrompida estiver vivo | Evitar duas sessões no mesmo workspace (revisão #2) |
| 033 | 2026-11-02 | O hash registrado do dataset só muda criando um novo dataset; validação e liberação conferem o arquivo real | Integridade científica (revisão #4) |
| 034 | 2026-11-02 | Custo de sessões encerradas à força estimado pelos tokens (`NIVOO_PRECO_ENTRADA_USD_MTOK`, `NIVOO_PRECO_SAIDA_USD_MTOK`) | Orçamento não pode ignorar gasto real (revisão #7) |
| 035 | 2026-11-02 | Decisão de hipótese é definitiva; limites contam a partir da retomada; fila conta só quedas | Revisão #5, #10, #8 |
| 036 | 2026-11-14 | Áreas (modelos): todo projeto pertence a uma área; instruções versionadas + base de conhecimento em git (`areas/<slug>/base`), copiada para `area/` em cada sessão; projetos em `areas/<slug>/projetos/<projeto>` | Especializar a IA por contexto persistente (não é fine-tuning) sem prendê-la a um assunto |
| 037 | 2026-11-14 | A pasta principal (`main`) do projeto acumula o trabalho: job sincroniza com a `main`, é verificado e incorporado por avanço rápido sob trava; conflito → BLOQUEADO `CONFLITO_INCORPORACAO` | Continuidade entre trabalhos; nada se perde entre jobs |
| 038 | 2026-11-14 | Conversa (chat) é a tela principal. A IA da conversa roda no worker sobre uma cópia descartável; só propõe plano; o plano vira job apenas com aprovação humana e passa pelas mesmas regras (critérios, verificador) | Interface simples para o usuário final sem abrir mão da verificação |
| 039 | 2026-11-14 | Memória automática da conversa: a IA devolve `memoria` (DECISAO/PREFERENCIA/FATO/PENDENCIA), gravada com hash para não duplicar; o usuário pode "esquecer" | Nada do que foi combinado se perde; base de conhecimento total do projeto |
| 040 | 2026-11-14 | Importação de pasta de padrões para o modelo (1 commit, ignora node_modules/.git, 10 MB por arquivo, corpo JSON até `NIVOO_BODY_LIMIT`=60 MB). Arquivos de agente da base (`.claude/`, `CLAUDE.md`, `AGENTS.md`...) chegam à sessão renomeados (`_claude/`, `_CLAUDE.md`): legíveis como padrões, inertes como configuração | O usuário traz o próprio fluxo (ex.: STUDIO-WORKFLOW) sem abrir brecha para hooks |
