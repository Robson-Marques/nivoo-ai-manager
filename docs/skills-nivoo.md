# Skills Nivoo — primeira implantação

Banco interno versionado e integrado ao planejador e ao contexto do executor. As competências são selecionadas pela solicitação atual ou pela etapa atual; executores determinísticos não recebem prompt. As orientações detalhadas ficam em contexto/skills-nivoo/<id>/SKILL.md, no diretório descartável da sessão. O backend não instala scripts, hooks, modelos, pacotes ou APIs externas. Não é uma instalação nativa de skills no CODEX_HOME ou Claude Code.

Retomada usa dados do banco, worktree, checkpoints e notas existentes. contexto/estado-etapa.md é uma projeção por sessão, não uma nova memória autoritativa. O histórico exclui a tentativa corrente. O registro do prompt e dos logs permite avaliar seleção e consumo; não há redução medida ainda.

## Referências

Orientações originais do Nivoo inspiradas em NVIDIA Agent Skills (Apache-2.0 nos cabeçalhos consultados), versão 71e61c7209cb4ca64cba247a7d20a5438b30aef5, NVIDIA Corporation e colaboradores:
- https://github.com/NVIDIA/skills/tree/71e61c7209cb4ca64cba247a7d20a5438b30aef5/skills/nemo-rl-session-memory
- https://github.com/NVIDIA/skills/tree/71e61c7209cb4ca64cba247a7d20a5438b30aef5/skills/tao-token-efficient-execution
- https://github.com/NVIDIA/skills/tree/71e61c7209cb4ca64cba247a7d20a5438b30aef5/skills/nemo-relay-debug-runtime-integration

Não importamos código ou scripts upstream. O catálogo completo continua externo. As competências de arte, motion, locução e código são próprias, adequadas aos contratos Nivoo. Não prometemos os resultados de benchmarks TAO para o Nivoo. APIs de trial não são autorizadas para produção por esta mudança.

## Implantação por frentes

1. Catálogo, seleção por etapa, materialização protegida, metadados e logs (esta versão).
2. Continuidade: estado real, checkpoints, notas, recuperação e contexto de trabalho.
3. Código e arquivos: contratos de ferramentas, leitura, escrita e edição, binários, publicação, isolamento.
4. Ferramentas e executores: parâmetros reais, dependências, roteamento, responsabilidades.
5. Diagnóstico e recuperação: causa comprovada, evitar repetir falhas, preservar resultado.
6. Contexto e tokens: carregar apenas instruções necessárias, medir por tipo de etapa; não multiplicar sessões.
7. Mídia: autoria, geração visual, Motion, áudio e entrega, com motores existentes.
8. Integração: compatibilidade dos provedores, testes focados e atualização pelo fluxo normal do servidor.

Cada frente é uma alteração verificável no mesmo branch. Não abrir CI/PR adicional ou instalar novas APIs. Não confundir seleção de skills com suporte nativo de uma ferramenta; a skill não concede recursos ou permissões. A frente 1 inclui a orientação inicial de arquivos; a auditoria da implementação de gravação vem na frente 3. Nenhuma economia de tokens ou qualidade artística foi medida ainda.

## Frente 2 — continuidade

As tentativas interrompidas recuperam notas válidas do worktree. Checkpoints também são registrados antes de reagendar falhas e após indisponibilidade de recurso. A conclusão de uma etapa e seu checkpoint são persistidos juntos quando o Git confirma o commit. Erros do Git não são tratados como commit confirmado. O estado de retomada distingue o último checkpoint do job do último checkpoint específico da etapa. Notas são validadas, deduplicadas e associadas à etapa e à tentativa; não importamos texto inválido como memória. A detecção de progresso usa conteúdo de arquivos em out/, em vez de horários de modificação. Não há novos serviços, APIs, chamadas de IA ou migração de banco.

Se o worker cair entre registrar SUCESSO e concluir a etapa, a retomada só finaliza automaticamente quando a tentativa mais recente pertence à execução atual e o hash do worktree coincide com o estado verificado. Caso contrário, preserva os arquivos e informa o impedimento. O caminho de recuperação de mídia continua separado e usa a proveniência dos artefatos. A comparação do hash é uma inspeção local de integridade, não uma nova conferência por IA.

## Frente 3 — ferramentas de código e arquivos

NVIDIA, OpenRouter e Groq usam o mesmo adaptador de texto, com listagem paginada, leitura UTF-8 por trechos, hash para edição condicional, substituição única, gravação atômica e proteção de links. Skills e estado de retomada ficam disponíveis por leitura; registro de notas tem ferramenta própria. Claude, Codex e Gemini mantêm suas ferramentas nativas e políticas. Arquivos binários continuam responsabilidade de executores especializados; nenhum novo endpoint externo. Alterações reais são contadas separadamente de gravações idênticas. A proteção e publicação de artefatos são tratadas na mesma frente.

O contrato das ferramentas de texto não depende mais do provedor NVIDIA: OpenRouter e Groq consomem diretamente o mesmo módulo. O catálogo de artefatos publica arquivos por conteúdo em área temporária no filesystem de destino, valida o hash antes de disponibilizar um blob novo e não sobrescreve um blob já existente. Links não são seguidos na coleta de entregas. Não é uma validação artística ou uma chamada de IA. A correção de movimentações destrutivas, permissões e roteamento fica na frente 4.

## Frente 4 — contratos e executores

Etapas adicionadas a jobs existentes passam pela compilação e validação dos contratos, associam dependências físicas aos produtores já persistidos e validam o grafo completo antes de inserir. Não reescrevem comandos ou dependências de etapas anteriores. As operações de arquivos têm caminhos protegidos em qualquer nível, recusam sobreposição, links, destinos existentes e movimentação entre discos; validam o lote antes de executar. Operações sobre mídia durável ou out/ exigem aprovação explícita, inclusive nos jobs antigos; o diário da IA não pode executar essas operações. A rotina normal de código continua sem segunda confirmação. Os contratos de mídia vinculam referências e entradas aos produtores, aceitam cenas estruturadas e rejeitam entrada igual à saída. Sem novos provedores ou chamadas de IA.
