# Adaptação do STUDIO-WORKFLOW para o Nivoo

## Objetivo

Preservar o significado do método e ajustar somente os pontos incompatíveis com
o funcionamento do Nivoo: materiais somente leitura, gate pelo botão **Fazer**,
IA sem terminal e operações de Git/entrega executadas pelo sistema.

## Mudanças por arquivo

| Arquivo | O que mudou | Por quê |
|---|---|---|
| `NIVOO-REGRAS.md` | Criado com hierarquia, Relatório de alinhamento condensado, gate **Fazer**, disciplinas core/condicionais, interação universal e índice `contexto/base/`. | É o texto permanente de “Como a IA deve funcionar”; precisa ser autocontido e ter menos de 8.000 caracteres. |
| `README.md` | Refeito como índice de instalação e consulta dos materiais no Nivoo. | O pacote deixou de ser um repositório central consumido por caminhos locais e passou a ser um Modelo. |
| `prompt-alinhamento.md` | O relatório passou a ser o texto do plano **Posso fazer isto**; “ok” virou clique em **Fazer**; estado do projeto vem do Nivoo; foram adicionados comandos de verificação e critérios de pronto. | Reproduzir o gate e a execução do Nivoo sem mudar a classificação, as disciplinas nem o formato essencial do relatório. |
| `specialty-creation.md` | Especialidade nova agora é criada somente em `docs/prompt-framework/` do projeto (`catalogo-especialidades.md` + `especialidades/<slug>.md`), por plano próprio; removidos escrita no pacote e CHANGELOG central. | Materiais do modelo são somente leitura e o domínio pertence ao projeto. |
| `shared/system-change-base.md` | Gate unificado em **Fazer**; removida autorização integrada; IA declara comandos/critérios e só edita arquivos; Progress Model e checkpoints preservados. | A IA não tem terminal e nenhuma execução pode contornar o gate do Nivoo. |
| `shared/consuming-system-adoption.md` | Adoção faseada preservada; cada família usa plano/gate; busca e validação são declaradas para o sistema; Git/deploy não são feitos pela IA. | Adequar piloto, coexistência e rollout ao executor do Nivoo. |
| `COMO-INTERAGIR-COM-O-RESPONSAVEL.md` | Renomeado e generalizado; removidas preferências pessoais, PowerShell, ambiente, e-mail, tag e deploy; mantidos idioma, reancoragem, erro silencioso, docs vivos, governança e tom. | O Modelo deve servir a qualquer usuário; preferências pessoais ficam nas regras do projeto. |
| `framework.md` | Referências pessoais generalizadas e estrutura local de especialidades ajustada. | O schema continua agnóstico; os ativos de projeto vivem no próprio projeto. |
| `doctrine/engineering-doctrine.md` | Documentação deixou de exigir CHANGELOG central; entrega agora descreve critérios/rollback e explicita que o Nivoo executa operações. | Preservar as disciplinas sem instruir a IA a publicar ou operar Git. |
| `doctrine/disciplines/testing.md` | Mantida a regra “compilou ≠ pronto” e convertida em comandos de verificação + critérios de pronto no plano; sistema executa. | Separar planejamento/evidência da execução de testes. |
| `doctrine/disciplines/architecture.md` | “Git mínimo” pré-gate virou estado fornecido pelo Nivoo; referências pessoais generalizadas. | A IA não executa terminal. |
| `doctrine/disciplines/security.md` | “Git mínimo” pré-gate virou estado fornecido pelo Nivoo; referências pessoais generalizadas. | A IA não executa terminal. |
| `doctrine/disciplines/domain.md` | “Git mínimo” pré-gate virou estado fornecido pelo Nivoo; referências pessoais generalizadas. | A IA não executa terminal. |
| `doctrine/disciplines/visual-interface-quality.md` | Referências pessoais generalizadas; lente visual e regras de licença preservadas. | Tornar o material reutilizável sem alterar o método. |
| `system-remodeling.md` | Removida autorização integrada; alinhamento virou plano; edições só após **Fazer**; comandos/testes/entrega ficam com o sistema; paradas pedem confirmação. | O gate do Nivoo é obrigatório em toda mudança. |
| `architecture-blueprint.md` | Referência a ambiente/deploy pessoal foi substituída por regras do projeto e operações do Nivoo; referências pessoais generalizadas. | Ambiente e entrega variam por projeto. |
| `architecture-baseline.md` | Referências pessoais generalizadas e gates históricos descritos como plano + **Fazer**. | Tornar o contrato portátil e coerente com o Nivoo. |
| `capability-contract.md` | Referências pessoais generalizadas e gates históricos descritos como plano + **Fazer**. | Preservar slices/Acceptance sem gate paralelo. |

## Itens removidos ou excluídos do pacote final

| Item | Tratamento | Motivo |
|---|---|---|
| `execution/` | Excluído integralmente. | Runner aposentado; o Nivoo executa etapas e verificações. |
| `CLOUD-USAGE.md` | Excluído. | Fluxo de uso direto em outras ferramentas conflita com o Modelo do Nivoo. |
| `.git/`, `.worktrees/`, `__pycache__/` | Excluídos. | Metadados/runtime local, não materiais do modelo. |
| `Claude outputs/` | Excluído. | Contém planilha com dados de clientes. |
| `CHANGELOG.md` | Excluído. | Histórico central não faz parte do Modelo. |
| `analise-doutrina-engenharia.md` | Excluído. | Análise interna, explicitamente fora do pacote. |
| `architecture-review.md` | Excluído. | ADR histórico contém arquitetura de consumo anterior, caminhos locais e premissas superadas; sua exclusão foi autorizada. |
| `.gitignore`, `.gitattributes` | Excluídos. | Não são necessários como materiais do Modelo. |

## Conflitos não resolvidos

Nenhum. A aparente tensão entre a antiga “autorização integrada” de uma task e o
gate absoluto do Nivoo foi resolvida em favor do fato de plataforma: toda edição
exige **Fazer**. Isso altera apenas o mecanismo de autorização, não a missão, o
escopo, os critérios ou a progressão do método.
