# Documentação do Nivoo AI Manager — comece aqui

Um documento por assunto. Leia na ordem indicada para o seu papel.

## Ordem de leitura

**Quem vai conhecer o projeto (gestor, novo responsável):**
1. [`../README.md`](../README.md) — o que é, para que serve, componentes.
2. [`ESTADO.md`](ESTADO.md) — o que está pronto, o que foi provado (com executor real ou simulado) e o que está bloqueado.
3. [`DECISOES.md`](DECISOES.md) — por que cada escolha foi feita (ADR-001 a 040).

**Quem vai instalar e operar o servidor:**
1. [`INSTALACAO-DEBIAN.md`](INSTALACAO-DEBIAN.md) — instalação em Debian como root, passo a passo para copiar e colar.
   (ou entregue [`PROMPT-INSTALACAO-AGENTE.md`](PROMPT-INSTALACAO-AGENTE.md) a um agente de IA com acesso ao servidor)
2. [`OPERACAO.md`](OPERACAO.md) — fluxo de trabalho, critérios, estados, variáveis de ambiente, limitações.
3. [`PROCEDIMENTO-CLI.md`](PROCEDIMENTO-CLI.md) — login oficial do Claude Code e do Codex e as provas reais.

**Quem vai desenvolver:**
1. [`GUIA-DESENVOLVEDOR.md`](GUIA-DESENVOLVEDOR.md) — mapa do código, ciclo de vida de um job, como rodar, testar e estender.
2. [`ARQUITETURA.md`](ARQUITETURA.md) — desenho do sistema: fila, execução durável, sessões de IA, memória, segurança.
3. [`API.md`](API.md) — todas as rotas da API com exemplos.
4. [`DECISOES.md`](DECISOES.md) — antes de mudar algo estrutural, veja se já existe decisão sobre isso.

## Todos os documentos

| Documento | Em uma linha |
|---|---|
| [`../README.md`](../README.md) | Visão geral, componentes, instalação rápida e testes. |
| [`ESTADO.md`](ESTADO.md) | Situação atual com evidências; ponto de retomada para quem continua o trabalho. |
| [`ARQUITETURA.md`](ARQUITETURA.md) | Como o sistema funciona por dentro. |
| [`GUIA-DESENVOLVEDOR.md`](GUIA-DESENVOLVEDOR.md) | Onde fica cada coisa no código e como trabalhar nele. |
| [`API.md`](API.md) | Referência das rotas HTTP. |
| [`DECISOES.md`](DECISOES.md) | Registro de decisões de arquitetura (ADR), com data e motivo. |
| [`OPERACAO.md`](OPERACAO.md) | Uso do dia a dia, configuração e limitações conhecidas. |
| [`INSTALACAO-DEBIAN.md`](INSTALACAO-DEBIAN.md) | Instalação de produção em Debian, como root, sem sudo. |
| [`PROMPT-INSTALACAO-AGENTE.md`](PROMPT-INSTALACAO-AGENTE.md) | Prompt pronto para um agente de IA instalar o Nivoo num servidor Linux. |
| [`PROCEDIMENTO-CLI.md`](PROCEDIMENTO-CLI.md) | Login oficial dos executores de IA e como rodar as provas reais. |
| [`AUDITORIA.md`](AUDITORIA.md) | Lacunas encontradas na V1 que motivaram a etapa de continuidade real. |
| [`REVISAO-2026-11-02.md`](REVISAO-2026-11-02.md) | Revisão independente do código: 10 problemas, correções e testes. |
| [`AVALIACAO-ECC.md`](AVALIACAO-ECC.md) | Avaliação do projeto ECC: o que foi aproveitado, o que foi rejeitado e por quê. |
| [`evidencias/`](evidencias/) | Dados brutos das execuções reais (sessões, prompts, critérios, relatórios), por data. |

## Onde está o código

Tudo está na branch **`main`**, versionado. O histórico de desenvolvimento (branch
`claude/lucid-lamport-z7zup1`) foi incorporado à `main` sem reescrever commits.
