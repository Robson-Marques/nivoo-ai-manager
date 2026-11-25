# STUDIO-WORKFLOW para Nivoo

Pacote de materiais do modelo para orientar IAs em projetos de software sem
misturar regras do método com regras particulares de cada projeto.

## Como instalar no Nivoo

1. Use o conteúdo de `NIVOO-REGRAS.md` no campo **Como a IA deve funcionar**.
2. Adicione os demais arquivos deste pacote como materiais do modelo. No uso,
   eles estarão disponíveis em `contexto/base/<caminho relativo>` e serão
   somente leitura.
3. Mantenha regras, conhecimento, memória e arquivos específicos no próprio
   projeto. `CLAUDE.md`, `AGENTS.md` e `.claude/` continuam como regras do
   repositório do projeto.

O fluxo esperado é: conversa → resposta direta ou plano **Posso fazer isto** →
usuário clica **Fazer** → sistema executa etapas e comandos de verificação →
outra IA confere as mudanças. O Relatório de alinhamento é o texto do plano;
não há bloco para colar antes do pedido nem pedido de "ok" no chat.

## Índice dos materiais

| Consulte quando... | Material no Nivoo |
|---|---|
| precisar das regras permanentes do modelo | `NIVOO-REGRAS.md` (vai no campo **Como a IA deve funcionar**, não em `contexto/base/`) |
| precisar do formato completo do Relatório de alinhamento/plano e do roteamento por especialidade | `contexto/base/prompt-alinhamento.md` |
| precisar do schema de ativos, tipos, herança, versionamento e ciclo de vida | `contexto/base/framework.md` |
| precisar criar uma especialidade no repositório do projeto | `contexto/base/specialty-creation.md` |
| precisar executar mudança limitada, controlar progresso ou emitir checkpoint | `contexto/base/shared/system-change-base.md` |
| precisar adotar biblioteca, Design System ou outro artefato externo | `contexto/base/shared/consuming-system-adoption.md` |
| precisar classificar disciplinas core e condicionais | `contexto/base/doctrine/engineering-doctrine.md` |
| precisar avaliar arquitetura e impacto estrutural | `contexto/base/doctrine/disciplines/architecture.md` |
| precisar avaliar segurança | `contexto/base/doctrine/disciplines/security.md` |
| precisar planejar testes e evidências (compilou ≠ pronto) | `contexto/base/doctrine/disciplines/testing.md` |
| precisar localizar e preservar regras de negócio | `contexto/base/doctrine/disciplines/domain.md` |
| precisar avaliar qualidade visual/interativa | `contexto/base/doctrine/disciplines/visual-interface-quality.md` |
| precisar remodelar uma interface a partir de referências | `contexto/base/system-remodeling.md` |
| precisar representar estrutura e dependências do sistema | `contexto/base/architecture-blueprint.md` |
| precisar avaliar suficiência estrutural global | `contexto/base/architecture-baseline.md` |
| precisar definir uma Capability e sua aceitação integrada | `contexto/base/capability-contract.md` |
| precisar das regras universais de idioma, reancoragem, erro silencioso e documentação viva | `contexto/base/COMO-INTERAGIR-COM-O-RESPONSAVEL.md` |
| precisar entender as mudanças desta adaptação | `contexto/base/ADAPTACAO-NIVOO.md` |

## O que fica no projeto

O catálogo e as especialidades do domínio vivem em:

- `docs/prompt-framework/catalogo-especialidades.md`;
- `docs/prompt-framework/especialidades/<slug>.md`.

Uma especialidade nova é proposta em plano próprio e criada somente nesses
caminhos do projeto depois do clique em **Fazer**. Os materiais do modelo em
`contexto/base/` nunca são alterados.

## Limites do pacote

Este pacote não inclui executor, terminal, automação de Git/deploy, dados de
clientes, histórico central de versões nem arquivos de análise interna. A IA
declara comandos de verificação e critérios de pronto; o sistema os executa.

---

*Documento vivo. Ao adicionar, remover ou renomear material, atualize este índice na mesma leva.*

